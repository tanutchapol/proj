import React, { useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Modal, Pressable, Image } from 'react-native';
import { launchImageLibrary, type Asset } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../components/GlobalAlert';
import { NavigationRouteContext } from '@react-navigation/native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { BASE_HOST } from './config';
import { useI18n } from '../i18n';
import RepairCameraModal from '../components/RepairCameraModal';

const getBaseUrl = () => BASE_HOST;

type Payment = {
  id: number;
  house_number: string;
  area_sq_m: number | null;
  rate_per_sqm: number;
  months: number;
  amount_per_month: number;
  total_amount: number;
  note?: string | null;
  created_at: string;
};

type PaymentInstallment = {
  id: number;
  payment_id: number;
  installment_no: number;
  months_span: number;
  due_date: string;
  amount: number;
  status: 'pending' | 'paid' | 'overdue' | 'waiting_approval';
  paid_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  paid_method?: 'cash' | 'promptpay' | 'bank_transfer' | null;
  paid_note?: string | null;
  proof_image?: string | null;
  paid_by?: string | null;
};

type Props = {
   house?: string;
   houseNumber?: string | null;
   onGoQr?: () => void;
   darkMode?: boolean;
  isAdmin?: boolean; // น€เธโฌเน€เธยเนยเธเเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ”เน€เธย
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addMonths = (date: Date, months: number) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtDateTime = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const paidMethodLabelKeys: Record<NonNullable<PaymentInstallment['paid_method']>, string> = {
  cash: 'phCash',
  promptpay: 'PromptPay',
  bank_transfer: 'phBankTransfer',
};
// parse 'YYYY-MM-DD HH:mm:ss' เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย 'YYYY-MM-DDTHH:mm:ss' -> Date (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ”เน€เธยเน€เธย เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌย timezone)
const parseMySqlDateTime = (s: string) => {
  if (!s) return new Date();
  // เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’เน€เธเธเน€เธเธ• T เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย Z เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย + เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธย ISO format เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธย new Date() parse เน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€ (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธย timezone เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธเธเน€เธเธ—เน€เธยเน€เธเธเน€เธย)
  if (s.includes('T') || s.includes('Z') || s.includes('+')) {
    return new Date(s);
  }
  // เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€ข date string เน€เธยเน€เธยเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธย (MySQL เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธเธ’) เน€เธยเน€เธเธเน€เธยเน€เธเธเน€เธเธ• timezone -> parse เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธย local date components
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return new Date(s);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] || 0),
    Number(m[5] || 0),
    Number(m[6] || 0)
  );
};
// parse 'YYYY-MM-DD' -> Date (local)
const parseMySqlDate = (s?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const QR_AMOUNT_KEY = 'qr_amount';
const QR_INTENT_KEY = 'qr_intent_id';
const QR_INSTALLMENT_KEY = 'qr_installment_id';

const PaymentHistory: React.FC<Props> = ({ house: propHouse, houseNumber, isAdmin, onGoQr }) => {
  const { t } = useI18n();
  const routeContext = useContext(NavigationRouteContext);
  const routeParams = (routeContext?.params ?? {}) as { houseNumber?: string; house?: string };
  const paramHouse =
    (routeParams.houseNumber as string | undefined) ||
    (routeParams.house as string | undefined) ||
    undefined;
  const fromHouseNumber = houseNumber || undefined;
  const house = propHouse ?? fromHouseNumber ?? paramHouse; // เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธเธเน€เธยเน€เธเธเน€เธเธ”เน€เธย

  const [items, setItems] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instMap, setInstMap] = useState<Record<number, PaymentInstallment[]>>({});
  const [instLoading, setInstLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdminView, setIsAdminView] = useState<boolean>(!!isAdmin);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState<'status' | 'method' | 'proof' | 'confirm_status' | 'confirm_notify'>('status');
  const [pendingMethod, setPendingMethod] = useState<PaymentInstallment['paid_method'] | null>(null);
  const [proofImage, setProofImage] = useState<{ uri: string; type: string; fileName: string } | null>(null);
  const [sheetRow, setSheetRow] = useState<PaymentInstallment | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);

  // ImageViewer state
  const [viewImageUri, setViewImageUri] = useState<string | null>(null);

  // เน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€“เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธย /auth/me
  const fetchRole = useCallback(async () => {
    try {
      const base = getBaseUrl();
      const token = await AsyncStorage.getItem('token');
      if (!token) { setIsAdminView(!!isAdmin); return; }
      const res = await fetch(`${base}/auth/me`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      const ct = res.headers.get('content-type') || '';
      const json = ct.includes('application/json') ? await res.json() : null;
      if (res.ok && json) {
        const data = json.data || json.user || json;
        const role = String((data?.role ?? data?.user?.role ?? '') || '').toLowerCase();
        const adminFlag =
          !!(data?.isAdmin || data?.is_admin) ||
          role === 'admin' || role === 'administrator' || role === 'staff' || role === 'superadmin';
        setIsAdminView(adminFlag);
        setIsSuperAdmin(role === 'superadmin');
      } else {
        setIsAdminView(!!isAdmin);
      }
    } catch {
      setIsAdminView(!!isAdmin);
    }
  }, [isAdmin]);

  const loadData = useCallback(async (opts: { showSpinner?: boolean; refreshStatus?: boolean } = {}) => {
    const { showSpinner = false, refreshStatus = false } = opts;
    try {
      if (showSpinner) setLoading(true);
      setError(null);

      const base = getBaseUrl();
      const url = house
        ? `${base}/payments/history/${encodeURIComponent(String(house))}?_t=${Date.now()}`
        : `${base}/payments?_t=${Date.now()}`;

      const token = await AsyncStorage.getItem('token');
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      // เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ overdue เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌยเน€เธเธ–เน€เธย (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’เน€เธยเน€เธเธ‘เน€เธย)
      if (refreshStatus) {
        try {
          await fetch(`${base}/payment-installments/refresh-status`, { method: 'POST', headers });
        } catch {}
      }

      const res = await fetch(url, { headers });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 120)}`);
      }

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Error fetching payment history');

      const list: Payment[] = Array.isArray(json.data) ? json.data : [];
      const filtered = house
        ? list.filter((p) => String(p.house_number) === String(house))
        : list;

      setItems(filtered);

      // เน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€“เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธยเน€เธเธ…เน€เธเธ payment เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธย payment_installments (เน€เธโฌเน€เธยเนโฌโ€เน€เธเธ“เน€เธยเน€เธยเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธย)
      const instHeaders: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) instHeaders.Authorization = `Bearer ${token}`;
      setInstLoading(true);
      const pairs = await Promise.all(
        filtered.map(async (p) => {
          try {
            const res2 = await fetch(`${base}/payments/${p.id}/installments?_t=${Date.now()}`, { headers: instHeaders });
            const j2 = await res2.json().catch(() => ({}));
            const arr: PaymentInstallment[] = res2.ok && Array.isArray(j2?.data) ? j2.data : [];
            return [p.id, arr] as [number, PaymentInstallment[]];
          } catch {
            return [p.id, []] as [number, PaymentInstallment[]];
          }
        })
      );
      setInstMap(Object.fromEntries(pairs));
      setInstLoading(false);
    } catch (e: any) {
      setError(e?.message || 'An error occurred');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [house]);

  useEffect(() => {
    (async () => {
       try {
        await fetchRole();
        await loadData({ showSpinner: true, refreshStatus: true });
       } catch (e: any) {
        // already handled inside loadData
       } finally {
        //
       }
     })();
  }, [house, loadData, fetchRole]);
 
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchRole();
      await loadData({ showSpinner: false, refreshStatus: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadData, fetchRole]);

  // เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ QR (เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธยเน€เธยเน€เธย AsyncStorage เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธเธเน€เธเธ•เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ QR)
  const createPaymentIntent = useCallback(
    async (row: PaymentInstallment, houseNum?: string | number) => {
      try {
        const base = getBaseUrl();
        const token = await AsyncStorage.getItem('token');
        const res = await fetch(`${base}/payment-intents`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            installment_id: row.id,
            payment_id: row.payment_id,
            house_number: houseNum ?? house, // เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌโ€เน€เธเธ•เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธเน€เธเธ’ เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย fallback เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธย
            amount: row.amount,
            method: 'promptpay',
          }),
        });
        const j = await res.json().catch(() => ({}));
        return res.ok && j?.ok && j?.data?.id ? Number(j.data.id) : null;
      } catch {
        return null;
      }
    },
    [house]
  );

  // เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ QR (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ–เน€เธย amount, installment_id เน€เธยเน€เธเธ…เน€เธเธ intentId)
  const goQr = useCallback(
    async (row: PaymentInstallment, houseNum?: string | number) => {
      try {
        await AsyncStorage.setItem(QR_AMOUNT_KEY, String(row.amount));
        await AsyncStorage.setItem(QR_INSTALLMENT_KEY, String(row.id));
        const intentId = await createPaymentIntent(row, houseNum);
        if (intentId) await AsyncStorage.setItem(QR_INTENT_KEY, String(intentId));
      } catch {}
      onGoQr?.();
    },
    [createPaymentIntent, onGoQr]
 );

  // เน€เธโฌเน€เธยเนยเธเน€เธเธเน€เธเธ•เน€เธเธเน€เธย backend เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ (เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธเธเน€เธเธ”เน€เธย)
  const updateInstallmentStatus = useCallback(async (
    id: number,
    status: 'paid' | 'pending' | 'overdue' | 'waiting_approval',
    paid_method?: 'cash' | 'promptpay' | 'bank_transfer',
    paid_note?: string
  ) => {
    const base = getBaseUrl();
    const token = await AsyncStorage.getItem('token');
    const res = await fetch(`${base}/payment-installments/${id}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ status, paid_method, paid_note }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.message || t('phUpdateFailed'));
    await loadData({ showSpinner: false, refreshStatus: true });
  }, [loadData, t]);

  // เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ
  const openStatusSheet = useCallback((row: PaymentInstallment) => {
    setSheetRow(row);
    setSheetStep('status');
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    if (sheetBusy) return;
    setCameraVisible(false);
    setSheetOpen(false);
    setSheetRow(null);
    setProofImage(null);
    setPendingMethod(null);
    setPendingStatus(null);
  }, [sheetBusy]);

  // เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ
  // เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธยเน€เธเธ“เน€เธเธเน€เธเธ
  const notifyPayment = useCallback(async (row: PaymentInstallment, status: string) => {
    try {
      const base = getBaseUrl();
      const token = await AsyncStorage.getItem('token');
      await fetch(`${base}/chat/notify-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ installment_id: row.id, status }),
      });
      showAlert(t('success'), t('phNotifSent'));
    } catch {}
  }, [t]);

  const [pendingStatus, setPendingStatus] = useState<'pending' | 'overdue' | 'waiting_approval' | null>(null);

  // เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ
  const chooseStatus = useCallback(async (row: PaymentInstallment, status: 'paid' | 'pending' | 'overdue' | 'waiting_approval') => {
    if (status === 'paid') {
      setSheetStep('method');
      return;
    }

    // New Logic: If editing 'paid' item
    if (sheetRow?.status === 'paid' && !isSuperAdmin) {
      showAlert(
        t('phApprovalTitle'),
        t('phApprovalMsg'),
        [
          { text: t('cancel'), style: 'cancel' },
          { 
            text: t('phSendRequest'), 
            onPress: async () => {
              try {
                setSheetBusy(true);
                // Directly call update to waiting_approval
                await updateInstallmentStatus(row.id, 'waiting_approval');
                showAlert(t('success'), t('phRequestSent'));
                closeSheet();
              } catch (e: any) {
                showAlert(t('error'), e?.message || t('phRequestFailed'));
              } finally {
                setSheetBusy(false);
              }
            } 
          }
        ]
      );
      return;
    }

    // เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธเธ…เน€เธเธ•เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธยเน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ Confirm เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธย Alert
    setPendingStatus(status);
    setSheetStep('confirm_status');
  }, [sheetRow, isSuperAdmin, closeSheet, updateInstallmentStatus, t]);

  // เน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ (เน€เธยเน€เธเธ’เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ Confirm)
  const confirmChangeStatus = async (notify: boolean) => {
    if (!sheetRow || !pendingStatus) return;
    try {
      setSheetBusy(true);
      await updateInstallmentStatus(sheetRow.id, pendingStatus);
      if (notify) {
        await notifyPayment(sheetRow, pendingStatus);
      }
      closeSheet();
    } catch (e: any) {
      showAlert(t('error'), e?.message || t('phUpdateFailed'));
    } finally {
      setSheetBusy(false);
    }
  };


  const chooseMethod = useCallback(async (row: PaymentInstallment, method: NonNullable<PaymentInstallment['paid_method']>) => {
    try {
      setSheetBusy(true);
      if (method === 'cash' || method === 'bank_transfer') {
        // เน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌย เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธเธ’เน€เธเธ เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ Proof
        setSheetBusy(false);
        setPendingMethod(method);
        setSheetStep('proof');
        return;
      }
      await updateInstallmentStatus(row.id, 'paid', method);
      closeSheet();
    } catch (e: any) {
      showAlert(t('error'), e?.message || t('phUpdateFailed'));
    } finally {
      if (sheetStep !== 'proof') { // เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ’ proof เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌย busy
         setSheetBusy(false);
      }
    }
  }, [updateInstallmentStatus, closeSheet, sheetStep, t]);

  const handleChooseImage = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setProofImage({ uri: asset.uri!, type: asset.type!, fileName: asset.fileName || 'upload.jpg' });
      }
    } catch (e) {
      console.warn(e);
    }
  };

  const handleTakePhoto = async () => {
    setCameraVisible(true);
  };

  const onCameraCapture = useCallback((asset: Asset) => {
    if (asset?.uri) {
      setProofImage({
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        fileName: asset.fileName || `capture_${Date.now()}.jpg`,
      });
    }
    setCameraVisible(false);
  }, []);

  const confirmPaymentWithProof = async () => {
    if (!sheetRow) return;
    try {
      setSheetBusy(true);
      const base = getBaseUrl();
      const token = await AsyncStorage.getItem('token');
      
      const formData = new FormData();
      formData.append('status', 'paid');
      formData.append('paid_method', pendingMethod || 'cash');
      
      if (proofImage) {
        formData.append('file', {
          uri: proofImage.uri,
          type: proofImage.type,
          name: proofImage.fileName,
        } as any);
      }

      const res = await fetch(`${base}/payment-installments/${sheetRow.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.message || t('phUpdateFailed'));

      await loadData({ showSpinner: false, refreshStatus: true });
      closeSheet();
    } catch (e: any) {
      showAlert(t('error'), e?.message || t('phUpdateFailed'));
    } finally {
      setSheetBusy(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator /></View>;
  if (error) return <View style={styles.center}><Text style={styles.errorText}>{error}</Text></View>;

  const renderFallbackSchedule = (count: number, start: Date, m: number, perInstallment: number | null) => {
    const dates: Date[] = Array.from({ length: count }, (_, i) => addMonths(start, m * (i + 1)));
    const overdueIdx = dates
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => {
        const today = new Date();
        const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const tk = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return tk < t0;
      })
      .map(x => x.i);
    if (overdueIdx.length > 0) {
      return (
        <>
          <Text style={styles.listHeader}>{t('phOverdueList')}</Text>
          {overdueIdx.map((i) => (
            <View key={i} style={styles.userInstRow}>
              <View style={styles.userCol}>
                <Text style={styles.userLabel}>{t('phDateLabel')}</Text>
                <Text style={styles.userValue}>{fmtDate(dates[i])}</Text>
              </View>
              <View style={styles.userCol}>
                <Text style={styles.userLabel}>{t('phAmountLabel')}</Text>
                <Text style={styles.userValue}>{fmt(perInstallment || 0)} {t('phBaht')}</Text>
              </View>
              <View style={styles.userStatusCol}>
                <Text style={[styles.userStatus, styles.userStatusOverdue]}>{t('payStatusOverdue')}</Text>
              </View>
            </View>
          ))}
        </>
      );
    }
    const last = dates[dates.length - 1];
    return (
      <>
        <Text style={styles.listHeader}>{t('phLatestInstallment')}</Text>
        <View style={styles.userInstRow}>
          <View style={styles.userCol}>
            <Text style={styles.userLabel}>{t('phDateLabel')}</Text>
            <Text style={styles.userValue}>{fmtDate(last)}</Text>
          </View>
          <View style={styles.userCol}>
            <Text style={styles.userLabel}>{t('phAmountLabel')}</Text>
            <Text style={styles.userValue}>{fmt(perInstallment || 0)} {t('phBaht')}</Text>
          </View>
          <View style={styles.userStatusCol}>
            <Text style={[styles.userStatus, styles.userStatusPending]}>{t('payStatusProcessing')}</Text>
          </View>
        </View>
      </>
    );
  };

  const renderInstallmentSection = (item: Payment) => {
    const list = instMap[item.id] || [];
    if (instLoading) return <Text style={styles.scheduleHeader}>{t('phLoadingInstallments')}</Text>;
    if (list.length > 0) {
      const start = parseMySqlDateTime(item.created_at);
      if (isAdminView) {
        const perInstallmentByPayment = (Number(item.amount_per_month) || 0) * (Number(item.months) || 0);
        const perInstallmentDisplay = perInstallmentByPayment > 0 ? perInstallmentByPayment : Number(list[0].amount || 0);
        return (
          <View style={styles.mt10}>
            <Text style={styles.scheduleHeader}>
              {t('phInstallmentPer')} {fmt(perInstallmentDisplay)} {t('phBaht')} ทั้งหมด {list.length} {t('phInstallments')} ({t('phStartFrom')} {fmtDate(start)})
            </Text>
            <View style={styles.scheduleWrap}>
              {list.map((row) => {
                const st = getInstallmentStatus(row);
                let chipStyle;
                if (st === 'paid') {
                  chipStyle = styles.chipPaid;
                } else if (st === 'overdue') {
                  chipStyle = styles.chipOverdue;
                } else if (st === 'waiting_approval') {
                  chipStyle = styles.chipWaitingApproval;
                } else {
                  chipStyle = styles.chipPending;
                }
                return (
                  <TouchableOpacity
                    key={row.id}
                    activeOpacity={0.8}
                    onPress={() => openStatusSheet(row)}
                    style={[styles.scheduleItem, chipStyle]}
                  >
                    <Text style={styles.scheduleRound}>{t('payInstallment')} {row.installment_no}</Text>
                    <Text style={styles.scheduleDate}>{fmtDate(parseMySqlDateTime(row.due_date))}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      }

      const overdueList = pickOverdueInstallments(list);
      if (overdueList.length > 0) {
        return (
          <View style={styles.mt10}>
            <Text style={styles.listHeader}>{t('phOverdueList')}</Text>
            {overdueList.map((row) => (
              <TouchableOpacity key={row.id} style={styles.userInstRow} activeOpacity={0.8}
                onPress={() => goQr(row, item.house_number)}>
                <View style={styles.userCol}>
                  <Text style={styles.userLabel}>{t('phDateLabel')}</Text>
                  <Text style={styles.userValue}>{fmtDate(parseMySqlDateTime(row.due_date))}</Text>
                </View>
                <View style={styles.userCol}>
                  <Text style={styles.userLabel}>{t('phAmountLabel')}</Text>
                  <Text style={styles.userValue}>{fmt(row.amount)} {t('phBaht')}</Text>
                </View>
                <View style={styles.userStatusCol}>
                  <Text style={[styles.userStatus, styles.userStatusOverdue]}>{t('payStatusOverdue')}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        );
      }

      const latest = pickNextInstallment(list);
      if (!latest) {
        // ไม่มีงวดค้าง และไม่มีงวดที่จะถึงใน threshold → แสดงว่าชำระครบแล้ว
        return (
          <View style={styles.mt10}>
            <View style={styles.allPaidCard}>
              <Ionicons name="checkmark-circle" size={28} color="#22C55E" />
              <Text style={styles.allPaidText}>{t('phAllPaid')}</Text>
            </View>
          </View>
        );
      }
      const status = getInstallmentStatus(latest);
      const statusLabel =
        status === 'paid' ? t('phPaidComplete') :
        status === 'overdue' ? t('payStatusOverdue') : t('payStatusProcessing');
      const statusStyle =
        status === 'paid'
          ? styles.userStatusPaid
          : status === 'overdue'
          ? styles.userStatusOverdue
          : styles.userStatusPending;
      return (
        <View style={styles.mt10}>
          <Text style={styles.listHeader}>{t('phLatestInstallment')}</Text>
          <TouchableOpacity style={styles.userInstRow} activeOpacity={0.8}
            onPress={() => goQr(latest, item.house_number)}>
            <View style={styles.userCol}>
              <Text style={styles.userLabel}>{t('phDateLabel')}</Text>
              <Text style={styles.userValue}>{fmtDate(parseMySqlDateTime(latest.due_date))}</Text>
            </View>
            <View style={styles.userCol}>
              <Text style={styles.userLabel}>{t('phAmountLabel')}</Text>
              <Text style={styles.userValue}>{fmt(latest.amount)} {t('phBaht')}</Text>
            </View>
            <View style={styles.userStatusCol}>
              <Text style={[styles.userStatus, statusStyle]}>{statusLabel}</Text>
              {status === 'paid' && (
                <Text style={styles.userStatusMeta}>
                  {(latest.paid_method && t(paidMethodLabelKeys[latest.paid_method])) || '-'} - {latest.paid_at ? fmtDateTime(parseMySqlDateTime(latest.paid_at)) : '-'}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    // fallback เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเนยเธเน€เธเธเน€เธย (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€ข B เน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธเธเน€เธเธ•)
    const m = Number(item.months) || 0;
    const start = parseMySqlDateTime(item.created_at);
    const count = m > 0 ? Math.floor(12 / m) : 0;
    const perInstallment = m > 0 ? item.amount_per_month * m : null;
    if (!count) return null;
    const schedule = Array.from({ length: count }, (_, i) => fmtDate(addMonths(start, m * (i + 1))));
    if (isAdminView) {
      return (
        <View style={styles.mt10}>
          <Text style={styles.scheduleHeader}>
            {t('phInstallmentPer')} {fmt(perInstallment || 0)} {t('phBaht')} x {count} {t('phInstallments')} ({t('phStartFrom')} {fmtDate(start)})
          </Text>
          <View style={styles.scheduleWrap}>
            {schedule.map((label, idx) => (
              <View key={idx} style={styles.scheduleItem}>
                <Text style={styles.scheduleRound}>{t('payInstallment')} {idx + 1}</Text>
                <Text style={styles.scheduleDate}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    }
    return (
      <View style={styles.mt10}>
        {renderFallbackSchedule(count, start, m, perInstallment)}
      </View>
    );
  };

  return (
    <View style={styles.flex1}>
      <FlatList
         data={items}
         keyExtractor={it => String(it.id)}
         contentContainerStyle={styles.contentContainer}
         refreshing={refreshing}
         onRefresh={onRefresh}
         renderItem={({ item }) => (
           <View style={styles.card}>
             <View style={styles.cardHeader}>
               <View style={styles.headerLeft}>
                 <View style={styles.houseIconBadge}>
                   <Ionicons name="receipt-outline" size={18} color="#334155" />
                 </View>
                 <View style={styles.headerMeta}>
                   <Text style={styles.title}>{t('phHouseNumber')} {item.house_number}</Text>
                   <View style={styles.datePill}>
                     <Ionicons name="time-outline" size={12} color="#64748B" />
                     <Text style={styles.date}>{fmtDateTime(parseMySqlDateTime(item.created_at))}</Text>
                   </View>
                 </View>
               </View>
             </View>

             <View style={styles.metricsWrap}>
               <View style={styles.row}>
                 <Text style={styles.label}>{t('phArea')}:</Text>
                 <Text style={styles.val}>{fmt(item.area_sq_m || 0)} {t('phSqM')}</Text>
               </View>
               <View style={styles.row}>
                 <Text style={styles.label}>{t('phRatePerSqm')}:</Text>
                 <Text style={styles.val}>{fmt(item.rate_per_sqm)} {t('phBaht')}</Text>
               </View>
               <View style={styles.row}>
                 <Text style={styles.label}>{t('phAmountPerMonth')}:</Text>
                 <Text style={styles.val}>{fmt(item.amount_per_month)} {t('phBaht')}</Text>
               </View>
               <View style={styles.row}>
                 <Text style={styles.label}>{t('phMonths')}:</Text>
                 <Text style={styles.val}>{item.months} {t('phMonthUnit')}</Text>
               </View>
             </View>

             <View style={styles.totalRowBox}>
               <Text style={styles.totalLabel}>{t('phTotal')}</Text>
               <Text style={styles.totalValue}>{fmt(item.total_amount)} {t('phBaht')}</Text>
             </View>

             {renderInstallmentSection(item)}

             {!!item.note && (
               <View style={styles.noteBox}>
                 <Text style={styles.note}>
                   <Text style={styles.noteLabel}>{t('phNote')}: </Text>
                   {item.note}
                 </Text>
               </View>
             )}
           </View>
         )}
       />
       {/* Bottom Sheet: เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ / เน€เธเธเน€เธเธ”เน€เธยเน€เธเธ•เน€เธยเน€เธเธ“เน€เธเธเน€เธเธ */}
      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={closeSheet}>
        <Pressable style={styles.sheetBackdrop} onPress={closeSheet}>
          <View />
        </Pressable>
        <View style={styles.sheet}>
          {!!sheetRow && (
            <>
              <View style={styles.sheetHeader}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>
                  {sheetStep === 'status' ? t('phChangeStatus') : t('phChooseMethod')}
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {t('payInstallment')} {sheetRow.installment_no} - {fmtDate(parseMySqlDateTime(sheetRow.due_date))}
                </Text>
                {sheetRow.paid_at && (
                  <View style={styles.sheetPaidInfo}>
                    <Text style={styles.sheetMeta}>
                      {t('phPaidAt')} {fmtDateTime(parseMySqlDateTime(sheetRow.paid_at))}{' '}
                      {sheetRow.paid_method ? '- ' + t(paidMethodLabelKeys[sheetRow.paid_method]) : ''}
                    </Text>
                     {sheetRow.paid_by && <Text style={styles.sheetMeta}>{t('phConfirmedBy')}: {sheetRow.paid_by}</Text>}
                     {sheetRow.proof_image && (
                        <Pressable 
                          style={styles.sheetProofPress} 
                          onPress={() => setViewImageUri(`${getBaseUrl()}/${sheetRow.proof_image}`)}
                        >
                          <Image 
                            source={{ uri: `${getBaseUrl()}/${sheetRow.proof_image}` }} 
                            style={styles.sheetProofImage}
                            resizeMode="cover"
                          />
                          <Text style={styles.sheetProofHint}>{t('phTapToView')}</Text>
                        </Pressable>
                     )}
                  </View>
                )}
              </View>

              {sheetStep === 'status' ? (
                sheetRow.status === 'waiting_approval' ? (
                  <View style={[styles.sheetOptions, styles.waitingApprovalContainer]}>
                    <Ionicons name="time-outline" size={48} color="#6B7280" style={styles.waitingApprovalIcon} />
                    <Text style={styles.waitingApprovalTitle}>
                      อยู่ระหว่างรออนุมัติการแก้ไขสถานะ
                    </Text>
                    <Text style={styles.waitingApprovalSubtitle}>
                      ไม่สามารถเปลี่ยนสถานะได้ในขณะนี้
                    </Text>
                  </View>
                ) : (
                <View style={styles.sheetOptions}>
                  {sheetRow.status !== 'paid' && (
                    <Pressable
                      disabled={sheetBusy}
                      onPress={() => chooseStatus(sheetRow, 'paid')}
                      style={[styles.optBtn, styles.optPrimary, sheetBusy && styles.optDisabled]}
                    >
                      <Ionicons name="checkmark-done-outline" size={18} color="#0F5132" />
                      <Text style={[styles.optText, styles.colorPaid]}>{t('payStatusPaid')}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    disabled={sheetBusy}
                    onPress={() => chooseStatus(sheetRow, 'pending')}
                    style={[styles.optBtn, styles.optNeutral, sheetBusy && styles.optDisabled]}
                  >
                    <Ionicons name="time-outline" size={18} color="#5A4500" />
                    <Text style={[styles.optText, styles.colorPending]}>{t('payStatusPending')}</Text>
                  </Pressable>
                  <Pressable
                    disabled={sheetBusy}
                    onPress={() => chooseStatus(sheetRow, 'overdue')}
                    style={[styles.optBtn, styles.optDanger, sheetBusy && styles.optDisabled]}
                  >
                    <Ionicons name="warning-outline" size={18} color="#7F1D1D" />
                    <Text style={[styles.optText, styles.colorOverdue]}>{t('payStatusOverdue')}</Text>
                  </Pressable>
                </View>
                )
              ) : sheetStep === 'confirm_status' ? (
                <View style={styles.sheetOptions}>
                   <View style={styles.confirmSection}>
                      <View style={[styles.confirmIconCircle, pendingStatus === 'pending' ? styles.confirmIconPending : styles.confirmIconOverdue]}>
                        <Ionicons 
                          name={pendingStatus === 'pending' ? 'time-outline' : 'warning-outline'} 
                          size={28} 
                          color={pendingStatus === 'pending' ? '#B45309' : '#B91C1C'} 
                        />
                      </View>
                      <Text style={styles.confirmTitle}>
                        {t('phConfirmChange')}
                      </Text>
                      <Text style={styles.confirmSubtitle}>
                         {t('phConfirmChangeMsg', { status: pendingStatus === 'pending' ? t('payStatusPending') : t('payStatusOverdue') })}
                      </Text>
                   </View>

                   <Pressable
                     disabled={sheetBusy}
                     onPress={() => setSheetStep('confirm_notify')}
                     style={[styles.optBtn, styles.optNotify, sheetBusy && styles.optDisabled]}
                   >
                     <Ionicons name="notifications-outline" size={20} color="#0369A1" />
                     <Text style={[styles.optText, styles.colorNotify]}>{t('phChangeAndNotify')}</Text>
                   </Pressable>

                   <Pressable
                     disabled={sheetBusy}
                     onPress={() => confirmChangeStatus(false)}
                     style={[styles.optBtn, styles.optNeutral, styles.optCenter, sheetBusy && styles.optDisabled]}
                   >
                     <Ionicons name="create-outline" size={20} color="#374151" />
                     <Text style={[styles.optText, styles.colorNeutral]}>{t('phChangeOnly')}</Text>
                   </Pressable>
                </View>
              ) : sheetStep === 'confirm_notify' ? (
                <View style={styles.sheetOptions}>
                   <View style={styles.confirmSection}>
                      <View style={[styles.confirmIconCircle, styles.confirmIconSuccess]}>
                        <Ionicons 
                          name="notifications" 
                          size={28} 
                          color="#059669" 
                        />
                      </View>
                      <Text style={styles.confirmTitle}>
                        {t('phConfirmNotify')}
                      </Text>
                      <Text style={styles.confirmSubtitle}>
                         {t('phConfirmNotifyMsg')}
                      </Text>
                   </View>

                   <Pressable
                     disabled={sheetBusy}
                     onPress={() => confirmChangeStatus(true)}
                     style={[styles.optBtn, styles.optConfirmSend, sheetBusy && styles.optDisabled]}
                   >
                     {sheetBusy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.optText, styles.colorWhite]}>{t('phConfirmSend')}</Text>}
                   </Pressable>

                   <Pressable
                     disabled={sheetBusy}
                     onPress={() => setSheetStep('confirm_status')}
                     style={[styles.optBtn, styles.optNeutral, styles.optCenter, sheetBusy && styles.optDisabled]}
                   >
                     <Text style={[styles.optText, styles.colorNeutral]}>{t('cancel')}</Text>
                   </Pressable>
                </View>
              ) : sheetStep === 'proof' ? (
                <View style={styles.sheetOptions}>
                   <View style={styles.proofImageRow}>
                     {proofImage ? (
                       <Image source={{ uri: proofImage.uri }} style={styles.proofImage} resizeMode="cover" />
                     ) : (
                       <View style={styles.proofPlaceholder}>
                         <Ionicons name="image-outline" size={48} color="#ccc" />
                         <Text style={styles.proofPlaceholderText}>{t('phNoImage')}</Text>
                       </View>
                     )}
                   </View>
                   
                   <View style={styles.proofButtonsRow}>
                     <Pressable onPress={handleTakePhoto} style={[styles.optBtn, styles.optWhite]}>
                        <Ionicons name="camera-outline" size={20} color="#333" />
                        <Text style={[styles.optText, styles.colorDark]}>{t('phTakePhoto')}</Text>
                     </Pressable>
                     <Pressable onPress={handleChooseImage} style={[styles.optBtn, styles.optWhite]}>
                        <Ionicons name="images-outline" size={20} color="#333" />
                        <Text style={[styles.optText, styles.colorDark]}>{t('phChooseImage')}</Text>
                     </Pressable>
                   </View>

                   <Pressable
                     disabled={sheetBusy || !proofImage}
                     onPress={confirmPaymentWithProof}
                     style={[styles.optBtn, styles.optPrimary, (sheetBusy || !proofImage) && styles.optDisabled, styles.optCenter]}
                   >
                     {sheetBusy ? <ActivityIndicator color="#0F5132" /> : <Text style={[styles.optText, styles.colorPaid]}>{t('phConfirmPayment')}</Text>}
                   </Pressable>
                </View>
              ) : (
                <View style={styles.sheetOptions}>
                  <Pressable
                    disabled={sheetBusy}
                    onPress={() => chooseMethod(sheetRow, 'cash')}
                    style={[styles.optBtn, styles.optNeutral, sheetBusy && styles.optDisabled]}
                  >
                    <Ionicons name="cash-outline" size={18} color="#111827" />
                    <Text style={[styles.optText, styles.colorDarkText]}>{t('phCash')}</Text>
                  </Pressable>
                  <Pressable
                    disabled={sheetBusy}
                    onPress={() => chooseMethod(sheetRow, 'bank_transfer')}
                    style={[styles.optBtn, styles.optNeutral, sheetBusy && styles.optDisabled]}
                  >
                    <Ionicons name="swap-horizontal-outline" size={18} color="#111827" />
                    <Text style={[styles.optText, styles.colorDarkText]}>{t('phBankTransfer')}</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.sheetFooter}>
                {sheetStep === 'method' ? (
                  <Pressable disabled={sheetBusy} onPress={() => setSheetStep('status')} style={styles.footerBtn}>
                    <Text style={styles.footerBtnText}>{t('phGoBack')}</Text>
                  </Pressable>
                ) : sheetStep === 'proof' ? (
                  <Pressable disabled={sheetBusy} onPress={() => setSheetStep('method')} style={styles.footerBtn}>
                    <Text style={styles.footerBtnText}>{t('phGoBack')}</Text>
                  </Pressable>
                ) : sheetStep === 'confirm_status' ? (
                  <Pressable disabled={sheetBusy} onPress={() => setSheetStep('status')} style={styles.footerBtn}>
                    <Text style={styles.footerBtnText}>{t('phGoBack')}</Text>
                  </Pressable>
                ) : (
                  <View />
                )}
                <Pressable disabled={sheetBusy} onPress={closeSheet} style={styles.footerBtn}>
                  <Text style={styles.footerBtnText}>{t('phClose')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* Image Viewer Modal */}
      <Modal visible={!!viewImageUri} transparent animationType="fade" onRequestClose={() => setViewImageUri(null)}>
        <View style={styles.imageViewerOverlay}>
          <Pressable style={styles.imageViewerClose} onPress={() => setViewImageUri(null)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </Pressable>
          {viewImageUri && (
            <Image 
              source={{ uri: viewImageUri }} 
              style={styles.imageViewerImage} 
            />
          )}
        </View>
      </Modal>

      <RepairCameraModal
        visible={cameraVisible}
        onClose={() => setCameraVisible(false)}
        onCapture={onCameraCapture}
      />
    </View>
  );
};

export default PaymentHistory;

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  mt6: { marginTop: 6 },
  mt10: { marginTop: 10 },
  bold800: { fontWeight: '800' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#D32F2F',
  },
  contentContainer: {
    padding: 12,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#DCE3EC',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  cardHeader: {
    marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  houseIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  headerMeta: { flex: 1 },
  datePill: {
    marginTop: 5,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F6F8FB',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E6ECF3',
  },
  metricsWrap: {
    borderWidth: 1,
    borderColor: '#E6ECF3',
    borderRadius: 12,
    backgroundColor: '#FAFCFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  totalRowBox: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#F2FAF5',
    borderWidth: 1,
    borderColor: '#CDEBD7',
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: '#0F5132', fontWeight: '800', fontSize: 14 },
  totalValue: { color: '#046C4E', fontWeight: '900', fontSize: 18 },
  cardTitle: {
    fontWeight: '800',
    color: '#0F9D58',
  },
  chipWaitingApproval: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  chipPaid: { backgroundColor: '#E8F7EE', borderColor: '#CDEBD7' },
  chipPending: { backgroundColor: '#EEF4FF', borderColor: '#CADCFF' },
  chipOverdue: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  title: { fontWeight: '800', fontSize: 17, color: '#111827' },
  date: { color: '#64748B', fontSize: 12, fontWeight: '600', marginLeft: 4 },
  label: { color: '#475569', fontWeight: '700', fontSize: 13 },
  val: { color: '#0F172A', fontWeight: '800', fontSize: 15 },
  noteBox: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  note: { color: '#475569', fontSize: 12, lineHeight: 17 },
  noteLabel: { color: '#334155', fontWeight: '800' },
  scheduleHeader: { color: '#334155', fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  scheduleWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginRight: 6,
    marginBottom: 6,
  },
  scheduleRound: { fontWeight: '800', fontSize: 12, color: '#2563EB', marginRight: 4 },
  scheduleDate: { fontWeight: '700', fontSize: 12, color: '#334155' },
  listHeader: { color: '#0F172A', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  instRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  // ===== User list styles (simple 3-column pill) =====
  userInstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  userCol: { flex: 1 },
  userLabel: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  userValue: { fontSize: 13, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  userStatusCol: { minWidth: 90, alignItems: 'flex-end' },
  userStatus: { fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  userStatusPaid: { color: '#065F46', backgroundColor: '#E8F7EE' },
  userStatusPending: { color: '#334155', backgroundColor: '#EAF1FF' },
  userStatusOverdue: { color: '#991B1B', backgroundColor: '#FEE2E2' },
  instTitle: { fontWeight: '800', fontSize: 13, color: '#111827' },
  instSub: { fontWeight: '600', fontSize: 12, color: '#6B7280', marginTop: 2 },
  instAmount: { fontWeight: '800', fontSize: 12, color: '#111827', marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontWeight: '800', fontSize: 11 },
  badgePaid: { backgroundColor: '#D1FAE5' },
  badgePending: { backgroundColor: '#FEF3C7' },
  badgeOverdue: { backgroundColor: '#FEE2E2' },
  // เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ’เน€เธยเน€เธเธ (user fallback)
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#666',
    marginTop: 2,
  },
  dotPaid: { backgroundColor: '#22A06B' },
  dotPending: { backgroundColor: '#FEF3C7' },
  dotOverdue: { backgroundColor: '#C0392B' },
  userStatusMeta: { fontSize: 11, color: '#64748B', marginTop: 4, fontWeight: '700', textAlign: 'right' },
  allPaidCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    gap: 10,
  },
  allPaidText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#15803D',
  },
  // ----- Bottom Sheet -----
  sheetBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 12,
  },
  sheetHeader: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 6, alignItems: 'center' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', marginBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  sheetSubtitle: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginTop: 4 },
  sheetMeta: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', marginTop: 2 },
  sheetOptions: { paddingHorizontal: 12, paddingTop: 6 },
  optBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 4,
    marginVertical: 6,
    borderWidth: 1,
  },
  optText: { marginLeft: 10, fontSize: 14, fontWeight: '800' },
  optPrimary: { backgroundColor: '#E8FFF3', borderColor: '#C6F6D5' },
  optNeutral: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  optDanger: { backgroundColor: '#FFE8E8', borderColor: '#FECACA' },
  optDisabled: { opacity: 0.6 },
  sheetFooter: {
    paddingHorizontal: 12,
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  footerBtnText: { fontWeight: '800', color: '#2563EB' },
  // Sheet paid info
  sheetPaidInfo: { marginTop: 4, alignItems: 'center' },
  sheetProofPress: { marginTop: 8, alignItems: 'center' },
  sheetProofImage: { width: 100, height: 100, borderRadius: 6, backgroundColor: '#eee' },
  sheetProofHint: { fontSize: 11, color: '#666', marginTop: 2 },
  // Option text colors
  colorPaid: { color: '#0F5132' },
  colorPending: { color: '#5A4500' },
  colorOverdue: { color: '#7F1D1D' },
  colorNotify: { color: '#0369A1' },
  colorNeutral: { color: '#374151' },
  colorWhite: { color: '#fff' },
  colorDarkText: { color: '#111827' },
  colorDark: { fontSize: 13, color: '#333' },
  // Confirm section
  confirmSection: { alignItems: 'center', marginBottom: 16, paddingHorizontal: 16 },
  confirmIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmIconPending: { backgroundColor: '#FEF3C7' },
  confirmIconOverdue: { backgroundColor: '#FEE2E2' },
  confirmIconSuccess: { backgroundColor: '#ECFDF5' },
  confirmTitle: { fontSize: 16, fontWeight: '800', color: '#111827', textAlign: 'center' },
  confirmSubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 4 },
  // Option button variants
  optCenter: { justifyContent: 'center' },
  optNotify: { backgroundColor: '#F0F9FF', borderColor: '#BAE6FD', justifyContent: 'center' },
  optConfirmSend: { justifyContent: 'center', backgroundColor: '#059669', borderColor: '#059669' },
  optWhite: { backgroundColor: '#fff', borderColor: '#ccc' },
  // Proof section
  proofImageRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 12 },
  proofImage: { width: 120, height: 160, borderRadius: 8, backgroundColor: '#eee' },
  proofPlaceholder: { width: 120, height: 160, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  proofPlaceholderText: { fontSize: 12, color: '#999', marginTop: 8 },
  proofButtonsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 16 },
  // Image viewer
  imageViewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  imageViewerClose: { position: 'absolute', top: 40, right: 20, zIndex: 10 },
  imageViewerImage: { width: '90%', height: '80%', resizeMode: 'contain' },
  // Waiting Approval Sheet
  waitingApprovalContainer: { alignItems: 'center', paddingVertical: 20 },
  waitingApprovalIcon: { marginBottom: 10 },
  waitingApprovalTitle: { color: '#4B5563', fontSize: 16, fontWeight: '600' },
  waitingApprovalSubtitle: { color: '#6B7280', fontSize: 14, textAlign: 'center', marginTop: 5 },
});

// เน€เธโฌเน€เธเธ…เน€เธเธ—เน€เธเธเน€เธย "เน€เธยเน€เธเธเน€เธโ€เน€เธเธ…เน€เธยเน€เธเธ’เน€เธเธเน€เธเธเน€เธโ€เน€เธเธเน€เธเธ“เน€เธเธเน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธย" เน€เธยเน€เธโ€เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ“เน€เธเธเน€เธเธเน€เธเธเน€เธเธ’เน€เธยเน€เธยเน€เธเธเน€เธย (เน€เธเธเน€เธเธ”เน€เธยเน€เธเธเน€เธโ€“เน€เธเธ’เน€เธยเน€เธเธ DB เน€เธยเน€เธเธ…เน€เธเธ period_end)
const pickNextInstallment = (list: PaymentInstallment[]) => {
  if (!list || list.length === 0) return null;
  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = (r: PaymentInstallment) => parseMySqlDateTime(r.due_date).getTime();
  const notPaid = (r: PaymentInstallment) => r.status !== 'paid' && r.status !== 'waiting_approval';

  // 0) Priority: If there is any installment waiting for approval, show it first
  const waiting = list.filter(r => r.status === 'waiting_approval').sort((a, b) => time(a) - time(b));
  if (waiting.length) return waiting[0];

  // 1) เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’เน€เธเธเน€เธเธ•เน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ“เน€เธเธเน€เธเธ (เน€เธยเน€เธเธ’เน€เธย DB เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย period_end < เน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธ•เน€เธย) เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธยเน€เธยเน€เธเธเน€เธย
  const overdue = list
    .filter((r) => {
      if (!notPaid(r)) return false;
      if (r.status === 'overdue') return true; // เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€“เน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธย DB
      const pe = parseMySqlDate(r.period_end);
      const peKey = pe ? pe.getTime() : null;
      // เน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธย period_end เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธเธ—เน€เธเธเน€เธเธเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ“เน€เธเธเน€เธเธ
      if (peKey != null && peKey < todayKey) return true;
      // เน€เธโฌเน€เธยเนยเธเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธย: เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’ due_date เน€เธโฌเน€เธยเนยเธเน€เธเธ…เน€เธเธเน€เธยเน€เธเธ…เน€เธยเน€เธเธ
      return time(r) < todayKey;
    })
    .sort((a, b) => time(b) - time(a));
  if (overdue.length) return overdue[0];

  // 2) เน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเนโฌยเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธ•เน€เธย (เน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธเธ)
  const isUpcomingVisible = (r: PaymentInstallment) => {
    const m = Number(r.months_span) || 1;
    const dueTime = time(r);
    
    let thresholdDays = 15;
    if (m >= 12) thresholdDays = 180;
    else if (m >= 6) thresholdDays = 90;
    else if (m >= 3) thresholdDays = 30;
    
    const diffDays = (dueTime - todayKey) / (1000 * 60 * 60 * 24);
    return diffDays <= thresholdDays;
  };

  const upcoming = list.filter((r) => notPaid(r) && time(r) >= todayKey && isUpcomingVisible(r)).sort((a, b) => time(a) - time(b));
  if (upcoming.length) return upcoming[0];

  // 3) เน€เธยเน€เธยเน€เธเธ’เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธ…เน€เธยเน€เธเธ -> เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ขเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌย
  // 3) All paid + no upcoming visible -> return null
  return null;
};

// เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธยเน€เธเธ—เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธเน€เธย (เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนยเธเน€เธยเน€เธเธ’เน€เธเธเน€เธย DB overdue เน€เธยเน€เธเธ…เน€เธเธ period_end)
const getInstallmentStatus = (r: PaymentInstallment): 'pending' | 'paid' | 'overdue' | 'waiting_approval' => {
  if (!r) return 'pending';
  if (r.status === 'paid') return 'paid';
  if (r.status === 'waiting_approval') return 'waiting_approval';
  // เน€เธโฌเน€เธยเนโฌโ€เน€เธยเน€เธเธ’ DB เน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธย overdue เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌยเน€เธย overdue เน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€ข
  if (r.status === 'overdue') return 'overdue';
  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const pe = parseMySqlDate(r.period_end);
  if (pe && pe.getTime() < todayKey) return 'overdue';
  const t = parseMySqlDateTime(r.due_date).getTime();
  return t < todayKey ? 'overdue' : 'pending';
};

// เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌโ€เน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนโฌย (เน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธยเน€เธยเน€เธเธ’เน€เธเธ เน€เธโฌเน€เธยเธขยเน€เธโฌเน€เธยเน€เธโ€ฆเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเนยเธเน€เธยเน€เธยเน€เธย overdue เน€เธโฌเน€เธยเนโฌเธเน€เธโฌเน€เธยเน€เธโ€เน€เธโฌเน€เธยเน€เธย DB เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย period_end เน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธโ€”เน€เธโฌเน€เธยเน€เธย due_date)
const pickOverdueInstallments = (list: PaymentInstallment[]) => {
  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = (r: PaymentInstallment) => parseMySqlDateTime(r.due_date).getTime();
  const notPaid = (r: PaymentInstallment) => r.status !== 'paid';
  return list
    .filter((r) => {
      if (!notPaid(r)) return false;
      if (r.status === 'overdue') return true;
      const pe = parseMySqlDate(r.period_end);
      if (pe && pe.getTime() < todayKey) return true;
      return time(r) < todayKey;
    })
    .sort((a, b) => time(a) - time(b)); // เน€เธยเน€เธยเน€เธเธ…เน€เธยเน€เธยเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธเธ‘เน€เธยเน€เธยเน€เธยเน€เธเธเน€เธย
};




