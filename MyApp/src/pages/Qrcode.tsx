import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  StatusBar,
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  ScrollView,
  RefreshControl,
  Modal,
} from 'react-native';
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../components/GlobalAlert';
import { launchImageLibrary, Asset } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { BASE_HOST } from './config.ts';

type QrResponse = {
  userId?: string;
  id: string;
  amount: number;
  payload: string;
  url?: string;
  filename?: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  expiresInSeconds?: number;
  expiresAfterMinutes?: number;
};

interface PaymentScreenProps {
  darkMode: boolean;
  onBack?: () => void;
}

export function getBaseUrl() {
  return BASE_HOST;
}

const USER_ID = 'user002';
const AMOUNT_KEY = 'qr_amount';
const INTENT_KEY = 'qr_intent_id';
const INSTALLMENT_KEY = 'qr_installment_id';

function buildQrStorageKey(
  installmentId: string | null,
  intentId: string | null,
  amount: number | null,
) {
  const amountPart = Number.isFinite(amount as number) ? Number(amount).toFixed(2) : 'none';
  return `qr_cache:${installmentId || 'none'}:${intentId || 'none'}:${amountPart}`;
}

function normalizeQrUrl(rawUrl?: string) {
  if (!rawUrl) return undefined;
  const base = getBaseUrl();
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const src = new URL(trimmed);
      const dst = new URL(base);
      if (src.host !== dst.host) {
        return `${dst.protocol}//${dst.host}${src.pathname}${src.search}`;
      }
    } catch {
      // keep original below
    }
    return trimmed;
  }

  return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

function parseQrExpiryMs(qr?: QrResponse | null) {
  if (!qr) return null;
  const raw = (qr.expiresAt || '').trim();
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

function formatSecondsToMmSs(totalSeconds: number) {
  const sec = Math.max(0, Number(totalSeconds || 0));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default function PaymentScreen({ darkMode, onBack }: PaymentScreenProps) {
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<QrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [autoRefreshing, setAutoRefreshing] = useState<boolean>(false);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [receiptModalVisible, setReceiptModalVisible] = useState<boolean>(false);
  const [receiptDownloading, setReceiptDownloading] = useState<boolean>(false);

  const [initAmount, setInitAmount] = useState<number | null>(null);
  const [amountReady, setAmountReady] = useState(false);

  const [installmentId, setInstallmentId] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);

  const storageKey = useMemo(
    () => buildQrStorageKey(installmentId, intentId, initAmount),
    [installmentId, intentId, initAmount],
  );

  const colors = {
    bg: darkMode ? '#121212' : '#fff',
    text: darkMode ? '#FFFFFF' : '#333',
    subtext: darkMode ? '#CCCCCC' : '#666',
    cardBg: darkMode ? '#1E1E1E' : '#F5F5F5',
    border: darkMode ? '#333333' : '#E0E0E0',
    primary: '#1976D2',
    success: '#16AD53FF',
    danger: '#FF4444',
    info: '#007AFF',
    disabled: '#CCCCCC',
  };

  const bootFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      if (!raw) return false;
      const cached = JSON.parse(raw) as QrResponse & { expires_at?: string; expires_in_seconds?: number };
      const normalizedCached: QrResponse = {
        ...cached,
        url: normalizeQrUrl(cached.url),
        expiresAt: cached.expiresAt || cached.expires_at || null,
        expiresInSeconds: Number.isFinite(Number(cached.expiresInSeconds))
          ? Number(cached.expiresInSeconds)
          : (Number.isFinite(Number(cached.expires_in_seconds)) ? Number(cached.expires_in_seconds) : undefined),
      };

      const expiresAtMs = parseQrExpiryMs(normalizedCached);
      if (!expiresAtMs || Date.now() >= expiresAtMs) {
        await AsyncStorage.removeItem(storageKey);
        return false;
      }

      setQr(normalizedCached);
      setLoading(false);
      return true;
    } catch {
      return false;
    }
  }, [storageKey]);

  useEffect(() => {
    (async () => {
      try {
        const rawAmt = await AsyncStorage.getItem(AMOUNT_KEY);
        if (rawAmt != null && !Number.isNaN(Number(rawAmt))) {
          setInitAmount(Number(rawAmt));
        }

        const iid = await AsyncStorage.getItem(INSTALLMENT_KEY);
        if (iid) setInstallmentId(iid);

        const intent = await AsyncStorage.getItem(INTENT_KEY);
        if (intent) setIntentId(intent);
      } finally {
        setAmountReady(true);
      }
    })();
  }, []);

  const fetchQR = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const baseUrl = getBaseUrl();
      const token = await AsyncStorage.getItem('token');
      let url: string;
      if (installmentId) {
        const qs = new URLSearchParams();
        if (intentId) qs.set('intentId', intentId);
        if (forceRefresh) qs.set('refresh', '1');
        url = `${baseUrl}/promptpay-qr/installment/${encodeURIComponent(installmentId)}${qs.toString() ? `?${qs}` : ''}`;
      } else {
        const qs = new URLSearchParams();
        if (typeof initAmount === 'number') qs.set('amount', String(initAmount));
        if (intentId) qs.set('intentId', intentId);
        if (forceRefresh) qs.set('refresh', '1');
        url = `${baseUrl}/promptpay-qr/user/${USER_ID}${qs.toString() ? `?${qs}` : ''}`;
      }

      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      const json = (await res.json()) as QrResponse & {
        message?: string;
        expires_at?: string;
        expires_in_seconds?: number;
      };
      if (!res.ok) throw new Error(json?.message || 'อัปโหลดไม่สำเร็จ');

      const normalized: QrResponse = {
        ...json,
        url: normalizeQrUrl(json.url),
        expiresAt: json.expiresAt || json.expires_at || null,
        expiresInSeconds: Number.isFinite(Number(json.expiresInSeconds))
          ? Number(json.expiresInSeconds)
          : (Number.isFinite(Number(json.expires_in_seconds)) ? Number(json.expires_in_seconds) : undefined),
      };

      setQr(normalized);
      await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch (e: any) {
      setError(e?.message || 'ไม่สามารถโหลดข้อมูล QR ได้');
    } finally {
      setLoading(false);
    }
  }, [installmentId, intentId, initAmount, storageKey]);

  useEffect(() => {
    if (!amountReady) return;
    (async () => {
      const ok = await bootFromStorage();
      if (!ok) await fetchQR();
    })();
  }, [amountReady, bootFromStorage, fetchQR]);

  useEffect(() => {
    const updateLeft = () => {
      const expiresAtMs = parseQrExpiryMs(qr);
      if (!expiresAtMs) {
        setSecondsLeft(null);
        return;
      }
      const left = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setSecondsLeft(left);
    };

    updateLeft();
    const timer = setInterval(updateLeft, 1000);
    return () => clearInterval(timer);
  }, [qr]);

  useEffect(() => {
    if (secondsLeft !== 0) return;
    if (autoRefreshing || loading) return;

    (async () => {
      setAutoRefreshing(true);
      try {
        await fetchQR(true);
      } finally {
        setAutoRefreshing(false);
      }
    })();
  }, [secondsLeft, autoRefreshing, loading, fetchQR]);

  const ensureGalleryPermission = useCallback(async () => {
    if (Platform.OS === 'android') {
      if (Platform.Version <= 28) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: 'ต้องการสิทธิ์จัดเก็บข้อมูล',
            message: 'กรุณาอนุญาตเพื่อบันทึกรูปลงแกลเลอรี',
            buttonNeutral: 'ภายหลัง',
            buttonNegative: 'ยกเลิก',
            buttonPositive: 'อนุญาต',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      if (Platform.Version >= 33 && PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          {
            title: 'ต้องการสิทธิ์รูปภาพ',
            message: 'กรุณาอนุญาตเพื่อบันทึกรูปลงแกลเลอรี',
            buttonNeutral: 'ภายหลัง',
            buttonNegative: 'ยกเลิก',
            buttonPositive: 'อนุญาต',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  }, []);

  const downloadImageToGallery = useCallback(async (remoteUrl: string, filePrefix: string) => {
    const normalizedUrl = normalizeQrUrl(remoteUrl);
    if (!normalizedUrl) {
      throw new Error('IMAGE_URL_INVALID');
    }

    const hasPermission = await ensureGalleryPermission();
    if (!hasPermission) {
      throw new Error('STORAGE_PERMISSION_DENIED');
    }

    const token = await AsyncStorage.getItem('token');
    const filename = `${filePrefix}_${Date.now()}.png`;
    const filePath = `${RNFS.CachesDirectoryPath}/${filename}`;

    try {
      const download = await RNFS.downloadFile({
        fromUrl: normalizedUrl,
        toFile: filePath,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }).promise;

      if (!download || download.statusCode !== 200) {
        throw new Error('IMAGE_DOWNLOAD_FAILED');
      }

      const localPathForSave = Platform.OS === 'android' ? filePath : `file://${filePath}`;
      await CameraRoll.save(localPathForSave, { type: 'photo', album: 'MyApp' });
      return filename;
    } catch {
      await CameraRoll.save(normalizedUrl, { type: 'photo', album: 'MyApp' });
      return filename;
    }
  }, [ensureGalleryPermission]);

  const onConfirm = async () => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
      if (res.didCancel) return;
      if (res.errorCode) return showAlert('เลือกไฟล์ไม่สำเร็จ', res.errorMessage || res.errorCode);

      const asset = res.assets?.[0] as Asset | undefined;
      if (!asset?.uri) return showAlert('ไม่พบไฟล์สำหรับอัปโหลด');

      setUploading(true);
      const form = new FormData();
      form.append('file', {
        // @ts-ignore
        uri: asset.uri,
        name: asset.fileName || `slip_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      });
      if (intentId) form.append('intentId', String(intentId));
      if (qr?.amount != null && Number.isFinite(Number(qr.amount))) {
        form.append('amount', String(Number(qr.amount)));
      }
      if (qr?.filename) {
        form.append('qrFilename', String(qr.filename));
      }

      const response = await fetch(`${getBaseUrl()}/upload-and-check`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'multipart/form-data',
        },
        body: form,
      });

      const json = await response.json();
      if (!response.ok) {
        if (json?.code === 'INTENT_EXPIRED') {
          await fetchQR(true);
        }
        throw new Error(json?.message || 'อัปโหลดไม่สำเร็จ');
      }

      const receiptUrl = normalizeQrUrl(
        json?.receiptImage?.url || json?.receipt?.url || json?.receipt_image_url,
      );

      if (receiptUrl) {
        setReceiptImageUrl(receiptUrl);
        setReceiptModalVisible(true);

        try {
          setReceiptDownloading(true);
          await downloadImageToGallery(receiptUrl, 'bank_slip');
          showAlert('ชำระเงินสำเร็จ', 'ตรวจสอบสลิปแล้ว และบันทึกรูปใบเสร็จลงแกลเลอรีเรียบร้อย', [
            { text: 'ตกลง', onPress: () => {
              setReceiptModalVisible(false);
              if (onBack) onBack();
            }}
          ]);
        } catch (saveErr: any) {
          if (saveErr?.message === 'STORAGE_PERMISSION_DENIED') {
            showAlert('ชำระเงินสำเร็จ', 'ตรวจสอบสลิปแล้ว แต่ไม่สามารถบันทึกรูปได้เพราะไม่ได้รับสิทธิ์จัดเก็บข้อมูล');
          } else {
            showAlert('ชำระเงินสำเร็จ', 'ตรวจสอบสลิปแล้ว แต่บันทึกรูปอัตโนมัติไม่สำเร็จ กรุณากดดาวน์โหลดอีกครั้ง');
          }
        } finally {
          setReceiptDownloading(false);
        }
        return;
      }

      const providerResult = json?.slip2go ?? json?.slipok;
      const result =
        typeof providerResult === 'object'
          ? JSON.stringify(providerResult, null, 2)
          : String(providerResult);
      showAlert('อัปโหลดสำเร็จ', `ตรวจสอบสลิปแล้ว:\n${result}`, [
        { text: 'ตกลง', onPress: () => {
          if (onBack) onBack();
        }}
      ]);
    } catch (err: any) {
      showAlert('ผิดพลาด', err?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setUploading(false);
    }
  };

  const onSaveQr = async () => {
    const downloadUrl = normalizeQrUrl(qr?.url);
    if (!downloadUrl) {
      showAlert('ไม่พบ QR', 'ไม่พบรูป QR สำหรับบันทึก');
      return;
    }

    try {
      await downloadImageToGallery(downloadUrl, 'qrcode');
      showAlert('บันทึกสำเร็จ', 'บันทึกรูป QR ลงแกลเลอรีแล้ว');
    } catch (err: any) {
      if (err?.message === 'STORAGE_PERMISSION_DENIED') {
        showAlert('ไม่ได้รับสิทธิ์', 'ต้องอนุญาตสิทธิ์จัดเก็บข้อมูลเพื่อบันทึกรูป');
        return;
      }
      showAlert('ผิดพลาด', err?.message || 'เกิดข้อผิดพลาด');
    }
  };

  const onSaveReceipt = useCallback(async () => {
    if (!receiptImageUrl || receiptDownloading) return;
    try {
      setReceiptDownloading(true);
      await downloadImageToGallery(receiptImageUrl, 'bank_slip');
      showAlert('บันทึกสำเร็จ', 'บันทึกรูปใบเสร็จลงแกลเลอรีแล้ว', [
        { text: 'ตกลง', onPress: () => {
          setReceiptModalVisible(false);
          if (onBack) onBack();
        }}
      ]);
    } catch (err: any) {
      if (err?.message === 'STORAGE_PERMISSION_DENIED') {
        showAlert('ไม่ได้รับสิทธิ์', 'ต้องอนุญาตสิทธิ์จัดเก็บข้อมูลเพื่อบันทึกรูป');
        return;
      }
      showAlert('ผิดพลาด', err?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setReceiptDownloading(false);
    }
  }, [receiptImageUrl, receiptDownloading, downloadImageToGallery, onBack]);

  const expiryText = useMemo(() => {
    if (secondsLeft == null) return '-';
    return formatSecondsToMmSs(secondsLeft);
  }, [secondsLeft]);

  const canManualRefresh = useMemo(() => {
    if (secondsLeft == null) return false;
    return secondsLeft < 60;
  }, [secondsLeft]);

  const onRefresh = useCallback(async () => {
    if (!canManualRefresh) {
      return;
    }

    setRefreshing(true);
    try {
      await fetchQR(true);
    } finally {
      setRefreshing(false);
    }
  }, [canManualRefresh, fetchQR]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.info]}
            tintColor={colors.info}
          />
        }
      >
        <View style={styles.header}>
          <View style={[styles.logoContainer, { backgroundColor: colors.primary }]}>
            <Text style={styles.logoText}>THAI QR{`\n`}PAYMENT</Text>
          </View>
        </View>

        <View style={styles.qrContainer}>
          <View style={[styles.qrBox, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            {loading ? (
              <ActivityIndicator size="large" color={colors.info} />
            ) : error ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
            ) : qr?.url ? (
              <Image style={styles.qrImage} source={{ uri: qr.url }} />
            ) : (
              <Text style={[styles.noDataText, { color: colors.subtext }]}>ไม่พบข้อมูล QR</Text>
            )}
          </View>
        </View>

        <View style={styles.infoContainer}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.text }]}>ยอดที่ต้องชำระ</Text>
            {(() => {
              const displayAmount = qr?.amount ?? initAmount;
              return (
                <Text style={[styles.amountText, { color: colors.text }]}>
                  THB {displayAmount != null ? Number(displayAmount).toFixed(2) : '-'}
                </Text>
              );
            })()}
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.text }]}>เวลาคงเหลือ</Text>
            <Text style={[styles.amountText, { color: colors.danger }]}>
              {expiryText}
            </Text>
          </View>
          {autoRefreshing && (
            <Text style={[styles.expireHint, { color: colors.info }]}>QR expired. Regenerating automatically...</Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.uploadButton,
            { backgroundColor: colors.success },
            (loading || !!error || uploading) && { backgroundColor: colors.disabled },
          ]}
          onPress={onConfirm}
          disabled={!!error || loading || uploading}
        >
          <Text style={styles.uploadButtonText}>
            {loading ? 'กำลังโหลด...' : uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดสลิป'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: colors.info },
            !qr?.url && { backgroundColor: colors.disabled },
          ]}
          onPress={onSaveQr}
          disabled={!qr?.url}
        >
          <Text style={styles.uploadButtonText}>Save QR Code</Text>
        </TouchableOpacity>

        {onBack && (
          <TouchableOpacity style={[styles.saveButton, styles.backButton]} onPress={onBack}>
            <Text style={styles.uploadButtonText}>กลับ</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal
        visible={receiptModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setReceiptModalVisible(false);
          if (onBack) onBack();
        }}
      >
        <View style={styles.receiptBackdrop}>
          <View style={[styles.receiptModalCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
            <View style={styles.receiptHeaderRow}>
              <Text style={[styles.receiptTitle, styles.receiptTitleBrand]}>NitiSmart</Text>
              <Text style={styles.receiptSuccessLabel}>ทำรายการสำเร็จ</Text>
            </View>
            <View style={[styles.receiptImageWrap, { borderColor: colors.border }]}> 
              {receiptImageUrl ? (
                <Image source={{ uri: receiptImageUrl }} style={styles.receiptImagePreview} resizeMode="contain" />
              ) : (
                <Text style={[{ color: colors.subtext }]}>ไม่พบรูปใบเสร็จ</Text>
              )}
            </View>

            <View style={styles.receiptActionRow}>
              <TouchableOpacity
                style={[
                  styles.receiptBtnPrimary,
                  (!receiptImageUrl || receiptDownloading) && styles.receiptBtnDisabled,
                ]}
                onPress={onSaveReceipt}
                disabled={!receiptImageUrl || receiptDownloading}
              >
                {receiptDownloading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.receiptBtnText}>บันทึกรูป</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptBtnSecondary}
                onPress={() => {
                  setReceiptModalVisible(false);
                  if (onBack) onBack();
                }}
              >
                <Text style={styles.receiptBtnText}>ปิดและกลับ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    borderRadius: wp('3%'),
  },
  container: {
    flex: 1,
    borderRadius: wp('3%'),
    paddingHorizontal: wp('8%'),
    paddingTop: hp('4.5%'),
  },
  scrollContent: {
    paddingBottom: hp('5%'),
  },
  header: {
    alignItems: 'center',
    marginBottom: hp('3.8%'),
  },
  logoContainer: {
    borderRadius: wp('2%'),
    paddingVertical: hp('1%'),
    paddingHorizontal: wp('4%'),
  },
  logoText: {
    color: 'white',
    fontSize: wp('3%'),
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: wp('4%'),
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: hp('5%'),
  },
  qrBox: {
    width: wp('70%'),
    height: wp('70%'),
    borderRadius: wp('3%'),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: wp('65%'),
    height: wp('65%'),
    borderRadius: wp('2%'),
  },
  errorText: {
    fontSize: wp('3.5%'),
    textAlign: 'center',
  },
  noDataText: {
    fontSize: wp('3.5%'),
    textAlign: 'center',
  },
  infoContainer: {
    marginBottom: hp('5%'),
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: hp('1.5%'),
  },
  infoLabel: {
    fontSize: wp('4%'),
    fontWeight: '400',
  },
  amountText: {
    fontSize: wp('4%'),
    fontWeight: '600',
  },
  expireHint: {
    marginTop: hp('0.8%'),
    fontSize: wp('3.2%'),
  },
  uploadButton: {
    borderRadius: wp('6%'),
    paddingVertical: hp('1.9%'),
    alignItems: 'center',
    marginHorizontal: wp('5%'),
  },
  saveButton: {
    borderRadius: wp('6%'),
    paddingVertical: hp('1.9%'),
    alignItems: 'center',
    marginHorizontal: wp('5%'),
    marginTop: hp('1.5%'),
  },
  backButton: {
    backgroundColor: '#9E9E9E',
  },
  uploadButtonText: {
    color: 'white',
    fontSize: wp('4%'),
    fontWeight: '700',
  },
  receiptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: wp('5%'),
  },
  receiptModalCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    borderTopWidth: 5,
    borderTopColor: '#003399',
  },
  receiptHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  receiptTitle: {
    fontSize: wp('5.5%'),
    fontWeight: '700',
  },
  receiptSuccessLabel: {
    fontSize: wp('3.5%'),
    fontWeight: '700',
    color: '#2e7d32',
  },
  receiptImageWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    height: hp('52%'),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1020',
  },
  receiptImagePreview: {
    width: '100%',
    height: '100%',
  },
  receiptActionRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  receiptBtnPrimary: {
    flex: 1,
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptBtnSecondary: {
    flex: 1,
    marginLeft: 10,
    backgroundColor: '#64748B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptBtnDisabled: {
    opacity: 0.5,
  },
  receiptBtnText: {
    color: '#FFFFFF',
    fontSize: wp('3.8%'),
    fontWeight: '700',
  },
  receiptTitleBrand: {
    color: '#003399',
  },
});


