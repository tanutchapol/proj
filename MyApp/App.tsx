import React, { useMemo, useState, useEffect, useRef } from 'react';
import { StyleSheet, View, ScrollView, StatusBar, Platform, Modal, TouchableOpacity, TouchableWithoutFeedback, Image, Text, PermissionsAndroid, AppState, Dimensions, Linking, LogBox } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlobalAlertModal, showAlert } from './src/components/GlobalAlert';
import { I18nProvider, useI18n } from './src/i18n';

LogBox.ignoreAllLogs(); // Hide all warning notifications on front-end


import Header from './src/components/Header';
import Sidebar from './src/components/Sidebar';
import Login from './src/pages/Login';
import Home from './src/pages/Home';
import Qrcode from './src/pages/Qrcode';
import Call from './src/pages/Call';
import Repairst from './src/pages/Repairst';
import Notification from './src/pages/Notification';
import Admin from './src/pages/Admin';
import AnnouncementAdmin from './src/pages/AnnouncementAdmin';
import PaymentStatus from './src/pages/PaymentStatus';
import PaymentHistory from './src/pages/PaymentHistory';
import UserManage from './src/pages/UserManage';
import Profile from './src/pages/Profile'; // NEW
import SuperAdmin from './src/pages/SuperAdmin'; // SuperAdmin page
import Settings from './src/pages/Settings';
import Financial from './src/pages/Financial';
import { BASE_HOST } from './src/pages/config.ts';

import ChatChannelPicker from './src/pages/chat/ChatChannelPicker';
import ChatRoomModal from './src/pages/chat/ChatRoomModal';
import { getLastSeen, markAllSeen, sortNotifications, iconNameFor, type AppNotification, colorFor } from './src/notifications/center';
import { sendDeviceNotification, setupDeviceNotifications } from './src/notifications/device.ts';

import type { Announcement, MenuItem, Page } from './src/types';
import { Ionicons } from '@react-native-vector-icons/ionicons';

export function getBaseUrl() {
  return BASE_HOST;
}

type User = {
  id: number | string;
  username: string;
  full_name?: string;
  role?: 'user' | 'admin' | 'superadmin';
  created_at?: string;
};

type ChatRoom = { id: number; name: string; room_type: 'public' | 'dm' };

const parseAnnounceDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) { const y = +m1[1], M = +m1[2], d = +m1[3]; const dt = new Date(y, M - 1, d); return isNaN(dt.getTime()) ? null : dt; }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) { let d = +m2[1], M = +m2[2], y = +m2[3]; if (y > 2400) y -= 543; const dt = new Date(y, M - 1, d); return isNaN(dt.getTime()) ? null : dt; }
  return null;
};

// Helper to sort announcements: important first, then upcoming date closest first, then past date most recent first, then id desc
const compareAnnouncements = (a: Announcement, b: Announcement) => {
  const impDelta = (b?.important ? 1 : 0) - (a?.important ? 1 : 0);
  if (impDelta !== 0) return impDelta;

  const aDate = parseAnnounceDate(a.date);
  const bDate = parseAnnounceDate(b.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  const aTs = aDate ? new Date(aDate.getFullYear(), aDate.getMonth(), aDate.getDate()).getTime() : 0;
  const bTs = bDate ? new Date(bDate.getFullYear(), bDate.getMonth(), bDate.getDate()).getTime() : 0;

  if (aTs > 0 && bTs > 0) {
    const aDiff = aTs - todayTs;
    const bDiff = bTs - todayTs;
    const aUpcoming = aDiff >= 0;
    const bUpcoming = bDiff >= 0;

    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    if (aUpcoming && bUpcoming && aDiff !== bDiff) return aDiff - bDiff;
    if (!aUpcoming && !bUpcoming && aDiff !== bDiff) return bDiff - aDiff;
  }

  if (aTs !== bTs) return bTs - aTs;

  const idA = typeof a?.id === 'number' ? (a.id as number) : Number(a?.id ?? 0);
  const idB = typeof b?.id === 'number' ? (b.id as number) : Number(b?.id ?? 0);
  return idB - idA;
};

const DEVICE_NOTIF_SNAPSHOT_KEY = 'device_notif_snapshot_v1';
const NOTIF_DROPDOWN_PAGE_SIZE = 8;
const NOTIF_DROPDOWN_MAX_ITEMS = 120;
const SCREEN = Dimensions.get('window');

function toNotifFingerprint(n: AppNotification) {
  return [
    n.type,
    n.id,
    n.title || '',
    n.subtitle || '',
    n.statusCode || '',
    n.date || '',
    n.important ? '1' : '0',
  ].join('|');
}

function shouldNotifyDevice(n: AppNotification) {
  if (n.type === 'announcement') return !!n.important;
  if (n.type === 'repair') return !!String(n.statusCode || '').trim();
  if (n.type === 'payment') {
    const st = String(n.statusCode || '').toLowerCase();
    return st === 'overdue' || st === 'pending' || st === 'processing' || st === 'success' || st === 'paid';
  }
  return false;
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>('login');

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (url.startsWith('nitismart://')) {
        const route = url.replace('nitismart://', '').split('/')[0];
        const allowedPages: Page[] = ['login', 'home', 'qrcode', 'call', 'repairst', 'notification', 'admin', 'announcement', 'usermgr', 'profile', 'superadmin', 'settings', 'financial', 'payment', 'paymentDetail', 'chat'];
        if (allowedPages.includes(route as Page)) {
          setPage(route as Page);
        }
      }
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => sub.remove();
  }, []);

  const [username, setUsername] = useState<string>('');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(false);
  const [selectedHouse, setSelectedHouse] = useState<string | null>(null);
  const [homeOverdueAmount, setHomeOverdueAmount] = useState<number | null>(null);
  const [homeOverdueLoading, setHomeOverdueLoading] = useState<boolean>(false);
  const homeOverdueRefreshLock = useRef(false);

  const [role, setRole] = useState<'user' | 'admin' | 'superadmin'>('user');
  const [booting, setBooting] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [importantModalOpen, setImportantModalOpen] = useState(false);
  const [importantModalItems, setImportantModalItems] = useState<Announcement[]>([]);
  const [importantModalIndex, setImportantModalIndex] = useState(0);
  const [importantModalPageWidth, setImportantModalPageWidth] = useState<number>(Math.round(SCREEN.width * 0.82));
  const [importantModalImageAspectMap, setImportantModalImageAspectMap] = useState<Record<string, number>>({});
  const importantCarouselRef = useRef<ScrollView | null>(null);
  const [lastImportantSeenId, setLastImportantSeenId] = useState<number>(0);

  // ===== Notification Center State =====
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [bellCount, setBellCount] = useState(0);
  const [_lastSeenTs, setLastSeenTs] = useState<number>(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifVisibleCount, setNotifVisibleCount] = useState(NOTIF_DROPDOWN_PAGE_SIZE);
  const notifSnapshotRef = useRef<Record<string, string> | null>(null);
  const notifSnapshotPrimedRef = useRef(false);
  const notifSnapshotKey = `${DEVICE_NOTIF_SNAPSHOT_KEY}_${String(user?.id || username || 'guest')}`;

  // Counter to force re-fetch announcements after adding/editing/deleting
  const [announcementsKey, setAnnouncementsKey] = useState(0);
  const refreshAnnouncements = React.useCallback(() => {
    setAnnouncementsKey(k => k + 1);
  }, []);

  // ===== Request Permissions on App Start =====
  useEffect(() => {
    const requestAllPermissions = async () => {
      if (Platform.OS !== 'android') return;
      
      try {
        const permissions: any[] = [
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
        ];
        
        // Android 13+ permissions
        if (Platform.Version >= 33) {
          permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
          permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
          permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
          permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        } else {
          // Android 12 และต่ำกว่า
          permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
          permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
        }
        
        const results = await PermissionsAndroid.requestMultiple(permissions);
        console.log('Permission results:', results);
      } catch (err) {
        console.warn('Permission request error:', err);
      }
    };
    
    requestAllPermissions();
  }, []);

  useEffect(() => {
    setupDeviceNotifications().catch(() => {});
  }, []);

  useEffect(() => {
    notifSnapshotRef.current = null;
    notifSnapshotPrimedRef.current = false;
  }, [notifSnapshotKey]);

  // Helpers for formatting Thai date in modals
  const toDate = parseAnnounceDate;
  const formatBeThai = (s?: string | null): string => {
    const d = toDate(s);
    if (!d) return String(s ?? '');
    const months = [t('monthJan'),t('monthFeb'),t('monthMar'),t('monthApr'),t('monthMay'),t('monthJun'),t('monthJul'),t('monthAug'),t('monthSep'),t('monthOct'),t('monthNov'),t('monthDec')];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  };

  const getImportantItemKey = React.useCallback((item: Announcement, index: number): string => {
    return String(item.id ?? `important_${index}`);
  }, []);

  const getImportantModalImageStyle = React.useCallback((aspect: number) => {
    const ratio = aspect > 0 ? aspect : 4 / 3;
    const maxWidth = Math.round(SCREEN.width * 0.84);
    const maxHeight = Math.round(SCREEN.height * 0.29);

    let width = maxWidth;
    if (width / ratio > maxHeight) {
      width = Math.round(maxHeight * ratio);
    }

    return { width, aspectRatio: ratio };
  }, []);

  const handleImportantModalImageLoad = React.useCallback((itemKey: string, event: any) => {
    const width = Number(event?.nativeEvent?.source?.width || 0);
    const height = Number(event?.nativeEvent?.source?.height || 0);
    if (width <= 0 || height <= 0) return;

    const ratio = width / height;
    setImportantModalImageAspectMap((prev) => {
      if (prev[itemKey] === ratio) return prev;
      return { ...prev, [itemKey]: ratio };
    });
  }, []);

  useEffect(() => {
    if (!importantModalItems.length) {
      setImportantModalImageAspectMap((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    let cancelled = false;

    importantModalItems.forEach((item, index) => {
      if (!item.image) return;
      const itemKey = getImportantItemKey(item, index);

      Image.getSize(
        item.image,
        (width, height) => {
          if (cancelled) return;
          if (width <= 0 || height <= 0) return;

          const ratio = width / height;
          setImportantModalImageAspectMap((prev) => {
            if (prev[itemKey] === ratio) return prev;
            return { ...prev, [itemKey]: ratio };
          });
        },
        () => {
          // Keep default aspect ratio when size cannot be fetched.
        },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [importantModalItems, getImportantItemKey]);

  const closeImportantModal = React.useCallback(async () => {
    try {
      const maxSeen = importantModalItems.reduce((max, item) => {
        const idNum = Number((item.id as any) ?? 0);
        return Number.isFinite(idNum) ? Math.max(max, idNum) : max;
      }, lastImportantSeenId);

      setLastImportantSeenId(maxSeen);
      await AsyncStorage.setItem('important_modal_seen_last_id', String(maxSeen));
    } catch {}

    setImportantModalOpen(false);
    setImportantModalItems([]);
    setImportantModalIndex(0);
  }, [importantModalItems, lastImportantSeenId]);

  const closeImportantModalFromUi = React.useCallback(() => {
    closeImportantModal().catch(() => {});
  }, [closeImportantModal]);

  const moveImportantModalPage = React.useCallback((direction: -1 | 1) => {
    if (!importantModalItems.length) return;

    const nextIndex = Math.max(0, Math.min(importantModalIndex + direction, importantModalItems.length - 1));
    if (nextIndex === importantModalIndex) return;

    setImportantModalIndex(nextIndex);
    const pageWidth = importantModalPageWidth > 0 ? importantModalPageWidth : Math.round(SCREEN.width * 0.82);
    importantCarouselRef.current?.scrollTo({ x: pageWidth * nextIndex, y: 0, animated: true });
  }, [importantModalIndex, importantModalItems.length, importantModalPageWidth]);

  // แชท
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const closeChatRoom = React.useCallback(() => {
    setSelectedRoom(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) { setPage('login'); return; }

        const res = await fetch(`${getBaseUrl()}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        const raw = await res.text();

        if (res.status === 401) {
          await AsyncStorage.removeItem('token');
          setPage('login');
          return;
        }

        let me: User | null = null;
        try { me = JSON.parse(raw); }
        catch {
          showAlert('Parse Error', t('loginParseError'));
          setPage('login');
          return;
        }

        setUser(me);
        setRole(me?.role === 'superadmin' ? 'superadmin' : me?.role === 'admin' ? 'admin' : 'user');
        setUsername(me?.username || '');
        setPage('home');
      } catch (e: any) {
        showAlert(t('error'), e?.message || t('loginFetchError'));
        setPage('login');
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const toAbsoluteUrl = (url: string): string => {
      if (!url) return '';
      if (/^https?:\/\//i.test(url)) return url;
      const base = getBaseUrl();
      return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
    };
    const load = async () => {
      try {
        const res = await fetch(`${getBaseUrl()}/announcements`);
        if (!res.ok) throw new Error(t('loadAnnouncementFailed'));
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        let mapped: Announcement[] = data.map((a: any) => ({
          id: a.id,
          date: String(a.date ?? ''),
          title: String(a.title ?? ''),
          image: toAbsoluteUrl(String(a.image ?? '')),
          important: !!a.important,
          description: a.description != null ? String(a.description) : undefined,
          created_at: a.created_at != null ? String(a.created_at) : undefined,
          updated_at: a.updated_at != null ? String(a.updated_at) : undefined,
        })).sort(compareAnnouncements);
        setAnnouncements(mapped);

        // Show unseen important announcements in one swipeable modal, upcoming first.
        try {
          const seenIdRaw = await AsyncStorage.getItem('important_modal_seen_last_id');
          const seenId = seenIdRaw ? Number(seenIdRaw) : 0;
          setLastImportantSeenId(seenId);
          const unseenImportant = mapped.filter((it) => {
            if (!it.important) return false;
            const idNum = Number((it.id as any) ?? 0);
            return Number.isFinite(idNum) && idNum > seenId;
          });

          // Sort unseen important using the new shared sorting logic
          unseenImportant.sort(compareAnnouncements);

          if (unseenImportant.length > 0) {
            setImportantModalItems(unseenImportant);
            setImportantModalIndex(0);
            setImportantModalOpen(true);
          } else {
            setImportantModalItems([]);
            setImportantModalIndex(0);
            setImportantModalOpen(false);
          }
        } catch { }
      } catch (e: any) {
        console.warn('fetch announcements error:', e?.message);
        // fallback ตัวอย่าง เผื่อ backend ยังไม่พร้อม
        setAnnouncements([
          { date: '—', title: t('noAnnouncement'), image: '' },
        ]);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, announcementsKey]);

  const openPaymentPage = React.useCallback(async () => {
    setSelectedRoom(null);
    if (role === 'admin' || role === 'superadmin') {
      setPage('payment');
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        showAlert(t('notLoggedIn'));
        setPage('login');
        return;
      }
      const res = await fetch(`${getBaseUrl()}/me/resident`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || t('houseNotFound'));
      const hn = String(json.data?.house_number || '');
      if (!hn) throw new Error(t('houseNumberNotFound'));
      setSelectedHouse(hn);
      setPage('paymentDetail');
    } catch (e: any) {
      showAlert(t('cannotOpenHistory'), e?.message || t('houseNotFound'));
    }
  }, [role, t]);

  const fetchHomeOverdueTotal = React.useCallback(async (): Promise<number | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      } as const;

      const calculateVisibleTotal = (installments: any[]) => {
        const todayKey = new Date().setHours(0, 0, 0, 0);
        return installments.reduce((sum: number, it: any) => {
          const status = String(it?.status || '').toLowerCase();
          if (status === 'paid' || status === 'waiting_approval') return sum;
          
          let isVisible = false;
          if (status === 'overdue') {
            isVisible = true;
          } else {
            const dueTime = new Date(it?.due_date || '').getTime();
            if (Number.isNaN(dueTime) || dueTime < todayKey) {
               isVisible = true;
            } else {
               const m = Number(it?.months_span) || 1;
               let thresholdDays = 15;
               if (m >= 12) thresholdDays = 180;
               else if (m >= 6) thresholdDays = 90;
               else if (m >= 3) thresholdDays = 30;
               
               const diffDays = (dueTime - Date.now()) / (1000 * 60 * 60 * 24);
               isVisible = diffDays <= thresholdDays;
            }
          }
          
          if (!isVisible) return sum;
          const amount = Number(it?.amount);
          return Number.isFinite(amount) ? sum + amount : sum;
        }, 0);
      };

      if (role === 'admin' || role === 'superadmin') {
        const res = await fetch(`${getBaseUrl()}/payment-installments/latest?limit=1000&_t=${Date.now()}`, { headers });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) return null;
        const rows = Array.isArray(json.data) ? json.data : [];
        return calculateVisibleTotal(rows);
      }

      let house = String(selectedHouse || '').trim();
      if (!house) {
        const resH = await fetch(`${getBaseUrl()}/me/resident?_t=${Date.now()}`, { headers });
        const jsonH = await resH.json().catch(() => ({}));
        if (resH.ok && jsonH?.ok) {
          house = String(jsonH?.data?.house_number || '').trim();
        }
      }
      if (!house) return 0;

      const resPh = await fetch(`${getBaseUrl()}/payments/history/${encodeURIComponent(house)}?_t=${Date.now()}`, { headers });
      const jsonPh = await resPh.json().catch(() => ({}));
      if (!resPh.ok || !jsonPh?.ok) return null;

      const payments = Array.isArray(jsonPh.data) ? jsonPh.data : [];
      if (!payments.length) return 0;
      const latestPaymentId = Number(payments[0]?.id);
      if (!Number.isFinite(latestPaymentId) || latestPaymentId <= 0) return 0;

      const resIns = await fetch(`${getBaseUrl()}/payments/${latestPaymentId}/installments?_t=${Date.now()}`, { headers });
      const jsonIns = await resIns.json().catch(() => ({}));
      if (!resIns.ok || !jsonIns?.ok) return null;
      const installments = Array.isArray(jsonIns.data) ? jsonIns.data : [];

      return calculateVisibleTotal(installments);
    } catch {
      return null;
    }
  }, [role, selectedHouse]);

  const refreshHomeOverdue = React.useCallback(async (showLoading: boolean = true) => {
    if (homeOverdueRefreshLock.current) return;
    homeOverdueRefreshLock.current = true;

    if (showLoading) setHomeOverdueLoading(true);
    try {
      const total = await fetchHomeOverdueTotal();
      if (typeof total === 'number' && !Number.isNaN(total)) {
        setHomeOverdueAmount(total);
      }
    } finally {
      if (showLoading) setHomeOverdueLoading(false);
      homeOverdueRefreshLock.current = false;
    }
  }, [fetchHomeOverdueTotal]);

  useEffect(() => {
    if (page !== 'home') {
      setHomeOverdueLoading(false);
      return;
    }

    let active = true;
    const run = (showLoading: boolean) => {
      if (!active) return;
      refreshHomeOverdue(showLoading);
    };

    run(true);
    const interval = setInterval(() => {
      run(false);
    }, 20000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [page, refreshHomeOverdue]);

  // ===== Approval Count State (SuperAdmin) =====
  const [approvalCount, setApprovalCount] = useState(0);

  useEffect(() => {
    if (role !== 'superadmin') return;
    const fetchApprovals = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) return;
        const res = await fetch(`${getBaseUrl()}/payment-installments/waiting-approval`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.data)) {
            setApprovalCount(json.data.length);
          }
        }
      } catch (err) {
        console.warn('fetch approvals failed', err);
      }
    };
    fetchApprovals();
    // Poll every 10 seconds? or just once/on role change.
    // For now, just once on mount/role change.
    const interval = setInterval(fetchApprovals, 15000); 
    return () => clearInterval(interval);
  }, [role]);

  const { menuItems, adminDividerIndex } = useMemo(() => {
    const base: MenuItem[] = [
      { label: t('menuHome'), onPress: () => { setSelectedRoom(null); setPage('home'); } },
    ];
    
    if (role !== 'admin' && role !== 'superadmin') {
      base.push({ label: t('menuProfile'), onPress: () => { setSelectedRoom(null); setPage('profile'); } });
      base.push({ label: t('menuPayment'), onPress: openPaymentPage });
    }

    base.push(
      { label: t('menuChat'), onPress: () => { setSelectedRoom(null); setPage('chat'); } },
      { label: t('menuRepair'), onPress: () => { setSelectedRoom(null); setPage('repairst'); } },
      { label: 'รายรับ - รายจ่าย', onPress: () => { setSelectedRoom(null); setPage('financial'); } },
      { label: t('menuEmergency'), onPress: () => { setSelectedRoom(null); setPage('call'); } },
      { label: t('menuSettings'), onPress: () => { setSelectedRoom(null); setPage('settings'); } },
    );
    if (role === 'admin') {
      const adminItems: MenuItem[] = [
        { label: t('menuManageResidents'), onPress: () => { setSelectedRoom(null); setPage('usermgr'); } },
        { label: t('menuCheckPayments'), onPress: () => { setSelectedRoom(null); setPage('payment'); } },
        { label: t('menuAnnouncementAdmin'), onPress: () => { setSelectedRoom(null); setPage('announcement'); } },
        { label: t('menuAdminDashboard'), onPress: () => { setSelectedRoom(null); setPage('admin'); } },
      ];
      return { menuItems: [...base, ...adminItems], adminDividerIndex: base.length };
    }
    if (role === 'superadmin') {
      const adminItems: MenuItem[] = [
        { label: t('menuManageResidents'), onPress: () => { setSelectedRoom(null); setPage('usermgr'); } },
        { label: t('menuCheckPayments'), onPress: () => { setSelectedRoom(null); setPage('payment'); } },
        { label: t('menuAnnouncementAdmin'), onPress: () => { setSelectedRoom(null); setPage('announcement'); } },
        { label: t('menuAdminDashboard'), onPress: () => { setSelectedRoom(null); setPage('admin'); } },
      ];
      const superAdminItems: MenuItem[] = [
        { 
          label: t('menuSuperAdmin'), 
          onPress: () => { setSelectedRoom(null); setPage('superadmin'); },
          showRedDot: approvalCount > 0
        },
      ];
      return { menuItems: [...base, ...adminItems, ...superAdminItems], adminDividerIndex: base.length };
    }
    return { menuItems: base, adminDividerIndex: undefined };
  }, [role, approvalCount, t, openPaymentPage]);

  const toggleSidebar = () => setSidebarVisible(v => !v);

  const handleLogout = async () => {
    await AsyncStorage.removeItem('token');
    setUser(null);
    setRole('user');
    setUsername('');
    setSelectedRoom(null);
    setPage('login');
  };

  // Notification rebuild function
  const rebuildNotifications = React.useCallback(async () => {
    try {
      setNotifLoading(true);
      const ls = await getLastSeen();
      setLastSeenTs(ls);

      const list: AppNotification[] = [];
      const toAbsoluteUrl = (url: string): string => {
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        const base = getBaseUrl();
        return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
      };

      const toAnnouncementFingerprint = (arr: Announcement[]): string =>
        arr
          .map((a) => `${String(a.id ?? '')}|${String(a.updated_at ?? '')}|${String(a.created_at ?? '')}|${String(a.title ?? '')}|${String(a.date ?? '')}`)
          .join('||');

      let bellAnnouncements: Announcement[] = announcements;
      try {
        const annRes = await fetch(`${getBaseUrl()}/announcements?_t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });
        if (annRes.ok) {
          const annJson = await annRes.json();
          const annData = Array.isArray(annJson?.data) ? annJson.data : [];
          const mappedAnnouncements: Announcement[] = annData
            .map((a: any) => ({
              id: a.id,
              date: String(a.date ?? ''),
              title: String(a.title ?? ''),
              image: toAbsoluteUrl(String(a.image ?? '')),
              important: !!a.important,
              description: a.description != null ? String(a.description) : undefined,
              created_at: a.created_at != null ? String(a.created_at) : undefined,
              updated_at: a.updated_at != null ? String(a.updated_at) : undefined,
            }))
            .sort(compareAnnouncements);

          bellAnnouncements = mappedAnnouncements;

          if (toAnnouncementFingerprint(mappedAnnouncements) !== toAnnouncementFingerprint(announcements)) {
            setAnnouncements(mappedAnnouncements);
          }
        }
      } catch {}

      const toSortTs = (...values: any[]): number | undefined => {
        const parseOne = (value: any): number => {
          if (value == null) return 0;
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 1e12 ? value : value * 1000;
          }

          const raw = String(value).trim();
          if (!raw) return 0;

          if (/^\d+$/.test(raw)) {
            const n = Number(raw);
            if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
          }

          const parsed = Date.parse(raw);
          if (!Number.isNaN(parsed)) return parsed;

          const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
          if (dateTime) {
            const [, y, m, d, hh, mm, ss] = dateTime;
            const parsedTs = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
            return Number.isNaN(parsedTs) ? 0 : parsedTs;
          }

          const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (slash) {
            const d = Number(slash[1]);
            const m = Number(slash[2]);
            let y = Number(slash[3]);
            if (y > 2400) y -= 543;
            const dt = new Date(y, m - 1, d);
            return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
          }

          return 0;
        };

        for (const value of values) {
          const tsValue = parseOne(value);
          if (tsValue > 0) return tsValue;
        }

        return undefined;
      };

      // helper แปลงสถานะเป็นไทย
      const toThaiPayStatus = (st: string) => {
        switch (st) {
          case 'overdue': return t('payStatusOverdue');
          case 'pending': return t('payStatusPending');
          case 'processing': return t('payStatusProcessing');
          case 'success':
          case 'paid': return t('payStatusPaid');
          default: return st;
        }
      };
      const toThaiRepairStatus = (st: string) => {
        switch (st) {
          case 'pending': return t('repairStatusPending');
          case 'in_progress': return t('repairStatusInProgress');
          case 'processing': return t('repairStatusProcessing');
          case 'done':
          case 'completed': return t('repairStatusDone');
          case 'rejected':
          case 'cancelled': return t('repairStatusCancelled');
          default: return st;
        }
      };

      // 1) Announcements
      bellAnnouncements.forEach(a => {
        list.push({
          id: `ann_${a.id ?? a.title}`,
          type: 'announcement',
          title: a.title,
          subtitle: a.description,
          date: a.date,
          sortTs: toSortTs(a.updated_at, a.created_at, a.date),
          important: !!a.important,
        });
      });

      // 2) Repairs (fetch lightweight list)
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) {
          const res = await fetch(`${getBaseUrl()}/repairs?_t=${Date.now()}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          });
          if (res.ok) {
            const raw = await res.json();
            const repairs = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
            repairs.slice(0, 40).forEach((r: any) => {
              const important = r.status !== 'done' && r.status !== 'completed';
              list.push({
                id: `rep_${r.id}`,
                type: 'repair',
                title: t('repairNotif', { id: String(r.id), title: r.title || '' }),
                subtitle: t('repairNotifStatus', { status: toThaiRepairStatus(r.status) }),
                date: r.updated_at || r.created_at || r.date,
                sortTs: toSortTs(
                  r.status_updated_at,
                  r.status_changed_at,
                  r.updated_at,
                  r.updatedAt,
                  r.created_at,
                  r.createdAt,
                  r.date,
                ),
                important,
                statusCode: r.status,
              });
            });
          }
        }
      } catch {}
      
      // 3) Payments (ADMIN)
      try {
        const token = await AsyncStorage.getItem('token');
        if (role === 'admin' || role === 'superadmin') {
          if (token) {
            const res = await fetch(`${getBaseUrl()}/payments/status?_t=${Date.now()}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            });
            const js = await res.json();
            if (res.ok && js?.ok) {
              (Array.isArray(js.data) ? js.data : []).forEach((p: any, idx: number) => {
                const st = p.status;
                const important = st === 'overdue' || st === 'pending' || st === 'processing';
                const stTh = toThaiPayStatus(st);
                if (important) {
                  list.push({
                    id: `pay_${p.houseNumber || p.house_number || idx}`,
                    type: 'payment',
                    title: `${t('payHouseNumber')} ${p.houseNumber || p.house_number} ${stTh}`,
                    subtitle: stTh,
                    date: p.updated_at || p.created_at || p.date || p.billing_date,
                    sortTs: toSortTs(
                      p.status_updated_at,
                      p.status_changed_at,
                      p.updated_at,
                      p.updatedAt,
                      p.created_at,
                      p.createdAt,
                      p.date,
                      p.billing_date,
                      p.due_date,
                    ),
                    important,
                    statusCode: st,
                  });
                }
              });
            }
          }
        } else {
          // ผู้ใช้ปกติ
          let house = selectedHouse;
          if (!house) {
            try {
              if (token) {
                const resH = await fetch(`${getBaseUrl()}/me/resident`, { headers: { Authorization: `Bearer ${token}` } });
                const jsH = await resH.json();
                if (resH.ok && jsH?.ok) house = String(jsH.data?.house_number || '');
              }
            } catch {}
          }
          if (house && token) {
            const resPh = await fetch(`${getBaseUrl()}/payments/history/${encodeURIComponent(house)}?_t=${Date.now()}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            });
            const jsPh = await resPh.json();
            if (resPh.ok && jsPh?.ok) {
              (Array.isArray(jsPh.data) ? jsPh.data : []).forEach((h: any) => {
                const st = h.status;
                const important = st === 'overdue' || st === 'processing';
                const stTh = toThaiPayStatus(st);
                if (important) {
                  list.push({
                    id: `ph_${h.id || h.date}`,
                    type: 'payment',
                    title: `${t('payExpense')} ${h.date || ''}`,
                    subtitle: stTh,
                    important,
                    date: h.date,
                    sortTs: toSortTs(
                      h.status_updated_at,
                      h.status_changed_at,
                      h.updated_at,
                      h.updatedAt,
                      h.created_at,
                      h.createdAt,
                      h.date,
                      h.billing_date,
                      h.due_date,
                    ),
                    statusCode: st, // NEW
                  });
                }
              });
            }
          }
        }
      } catch {}

      const sorted = sortNotifications(list).slice(0, NOTIF_DROPDOWN_MAX_ITEMS);
      setNotifications(sorted);

      // นับเฉพาะรายการสำคัญที่ใหม่กว่า lastSeen
      const toTs = (s?: string | null): number => {
        if (!s) return 0;
        const d = toDate(s);
        if (d) return d.getTime();
        const parsed = Date.parse(String(s));
        return Number.isNaN(parsed) ? 0 : parsed;
      };
      const count = sorted.filter(n => n.important && ((n.sortTs ?? toTs(n.date)) > ls)).length;
      setBellCount(count);

      const tracked = sorted.filter(shouldNotifyDevice);
      const nextSnapshot: Record<string, string> = {};
      for (const n of tracked) {
        nextSnapshot[n.id] = toNotifFingerprint(n);
      }

      if (!notifSnapshotRef.current) {
        try {
          const rawSnapshot = await AsyncStorage.getItem(notifSnapshotKey);
          notifSnapshotRef.current = rawSnapshot ? JSON.parse(rawSnapshot) : {};
        } catch {
          notifSnapshotRef.current = {};
        }
      }

      const prevSnapshot = notifSnapshotRef.current || {};
      const shouldSend = notifSnapshotPrimedRef.current || Object.keys(prevSnapshot).length > 0;

      if (shouldSend) {
        for (const n of tracked) {
          const fp = nextSnapshot[n.id];
          if (prevSnapshot[n.id] === fp) continue;
          await sendDeviceNotification({
            title: n.title,
            body: n.subtitle || undefined,
            category: n.type,
          });
        }
      }

      notifSnapshotPrimedRef.current = true;
      notifSnapshotRef.current = nextSnapshot;
      await AsyncStorage.setItem(notifSnapshotKey, JSON.stringify(nextSnapshot));
    } finally {
      setNotifLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, role, selectedHouse, t, notifSnapshotKey]);

  // Rebuild เมื่อประกาศ / role / house เปลี่ยน
  useEffect(() => {
    rebuildNotifications();
  }, [rebuildNotifications]);

  useEffect(() => {
    if (page === 'login' || booting) return;
    let mounted = true;

    const refresh = () => {
      if (!mounted) return;
      rebuildNotifications().catch(() => {});
    };

    refresh();
    const timer = setInterval(refresh, 10000);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      mounted = false;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [page, booting, rebuildNotifications]);

  const toggleNotif = () => {
    // เปิด = mark seen และรีเซ็ตตัวเลขทันที
    setNotifOpen(prev => {
      const next = !prev;
      if (next) {
        setNotifVisibleCount(NOTIF_DROPDOWN_PAGE_SIZE);
        (async () => {
          await markAllSeen();
          setLastSeenTs(Date.now());
          setBellCount(0); // รีเซ็ตตัวเลขเมื่อผู้ใช้เปิดดู
          await rebuildNotifications();
        })();
      }
      return next;
    });
  };

  if (page === 'login') {
    return (
      <>
      <SafeAreaProvider style={styles.loginProvider}>
        <StatusBar barStyle="light-content" backgroundColor="#0F680FFF" translucent={false} />
        <Login
          username={username}
          setUsername={setUsername}
          onLogin={async () => {
            try {
              const token = await AsyncStorage.getItem('token');
              if (!token) { setPage('login'); return; }

              const res = await fetch(`${getBaseUrl()}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!res.ok) {
                await AsyncStorage.removeItem('token');
                setPage('login');
                return;
              }

              const raw = await res.text();
              let me: User | null = null;
              try { me = JSON.parse(raw); }
              catch {
                showAlert(t('error'), t('loginReadError'));
                setPage('login');
                return;
              }

              setUser(me);
              setRole(me?.role === 'superadmin' ? 'superadmin' : me?.role === 'admin' ? 'admin' : 'user');
              setUsername(me?.username || '');
              showAlert(t('loginSuccess'), `${t('loginWelcome')} ${me?.username || ''}`);
              setPage('home');
            } catch (err: any) {
              showAlert(t('error'), err?.message || t('loginFailed'));
              setPage('login');
            }
          }}
        />
      </SafeAreaProvider>
      <GlobalAlertModal darkMode={darkMode} />
      </>
    );
  }

  if (booting) {
    return (
      <>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, darkMode ? styles.bgBootDark : styles.bgBootLight]} />
      </SafeAreaProvider>
      <GlobalAlertModal darkMode={darkMode} />
      </>
    );
  }

  const getPageConfig = () => {
    switch (page) {
      case 'admin':
        return { title: t('titleAdmin'), bgColor: darkMode ? '#1A1A1A' : '#C2185B', headerTone: 'admin' };
      case 'announcement':
        return { title: t('titleAnnouncement'), bgColor: darkMode ? '#1A1A1A' : '#1B8A5A', headerTone: 'announcement' };
      case 'qrcode':
        return { title: t('titlePayment'), bgColor: darkMode ? '#1A1A1A' : '#2E7D32', headerTone: 'qrcode' };
      case 'payment':
        return { title: t('titleCheckPayment'), bgColor: darkMode ? '#1A1A1A' : '#5B8C2A', headerTone: 'payment' };
      case 'paymentDetail':
        return { title: `Home No. ${selectedHouse ?? ''}`, bgColor: darkMode ? '#1A1A1A' : '#527A20', headerTone: 'paymentDetail' };
      case 'usermgr':
        return { title: t('titleManageResidents'), bgColor: darkMode ? '#1A1A1A' : '#0F8A6B', headerTone: 'usermgr' };
      case 'notification':
        return { title: t('titleNotification'), bgColor: darkMode ? '#1A1A1A' : '#E67E22', headerTone: 'notification' };
      case 'call':
        return { title: t('titleEmergency'), bgColor: darkMode ? '#1A1A1A' : '#D3544B', headerTone: 'call' };
      case 'repairst':
        return { title: t('titleRepair'), bgColor: darkMode ? '#1A1A1A' : '#1D4ED8', headerTone: 'repairst' };
      case 'chat':
        return { title: selectedRoom ? (selectedRoom.name || t('titleChat')) : t('titleChat'), bgColor: darkMode ? '#1A1A1A' : '#00897B', headerTone: 'chat' };
      case 'profile':
        return { title: t('titleProfile'), bgColor: darkMode ? '#1A1A1A' : '#2E7D32', headerTone: 'profile' };
      case 'financial':
        return { title: 'รายรับ - รายจ่าย', bgColor: darkMode ? '#1A1A1A' : '#3B82F6', headerTone: 'profile' };
      case 'settings':
        return { title: t('titleSettings'), bgColor: darkMode ? '#1A1A1A' : '#455A64', headerTone: 'settings' };
      default:
        return { title: t('titleHome'), bgColor: darkMode ? '#1A1A1A' : '#2D8A3D', headerTone: 'home' };
    }
  };

  const { title, bgColor, headerTone } = getPageConfig();

  // โหมดต่าง ๆ ของแชท
  const isChatRoomPage = page === 'chat' && !!selectedRoom; // อยู่ในห้อง
  const isChatPickerPage = page === 'chat' && !selectedRoom;  // เลือกห้อง

  // หน้าไหนมี VirtualizedList
  const isVirtualizedPage = page === 'repairst' || page === 'payment' || page === 'paymentDetail' || page === 'usermgr' || page === 'superadmin';

  return (
    <>
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.container, { backgroundColor: isChatRoomPage ? '#FFFFFF' : bgColor }] as any}
        edges={['top']}
      >
        <StatusBar
          barStyle={isChatRoomPage ? 'dark-content' : 'light-content'}
          backgroundColor={isChatRoomPage ? '#FFFFFF' : bgColor}
          translucent={false}
        />

        {sidebarVisible && (
          <Sidebar
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            visible={sidebarVisible}
            onClose={() => setSidebarVisible(false)}
            onLogout={handleLogout}
            menuItems={menuItems}
            adminDividerIndex={adminDividerIndex}
            currentUser={user}
          />
        )}

        {/* Header ใหญ่แสดงเฉพาะหน้า non-chat, non-superadmin หรือหน้าเลือกห้อง (ให้มีหัวเรื่อง) */}
        {(!isChatRoomPage && page !== 'superadmin' && page !== 'financial') && (
          <Header
            title={title}
            darkMode={darkMode}
            tone={headerTone}
            onMenuPress={toggleSidebar}
            showClose={page === 'notification' || page === 'paymentDetail' || isChatRoomPage}
            onClose={() => {
              if (isChatRoomPage) {
                setSelectedRoom(null);
              } else if (page === 'paymentDetail') {
                setSelectedHouse(null);
                if (role === 'admin') {
                  setPage('payment');
                } else {
                  setPage('home');
                }
              } else {
                setPage('home');
              }
            }}
            onBellPress={toggleNotif}
            bellCount={bellCount}
            bellActive={notifOpen}
          />
        )}

        {/* ===== เนื้อหา ===== */}
        {page === 'chat' ? (
          <View style={styles.flex1}>
            {isChatPickerPage ? (
              <ChatChannelPicker
                onOpenRoom={(room) => setSelectedRoom(room)}
              />
            ) : null}
          </View>
        ) : page === 'superadmin' ? (
           // SuperAdmin - เต็มจอ (Manage its own header/layout)
           <View style={styles.flex1}>
              <SuperAdmin 
                darkMode={darkMode} 
                onMenuPress={toggleSidebar}
              />
           </View>
        ) : (
          // หน้าอื่น ๆ ยังอยู่ในกล่องขาว
          <View style={styles.whiteContentContainer}>
            {(['call', 'notification', 'announcement', 'profile', 'settings', 'financial'] as const).includes(page as any) ? (
              <>
                {page === 'call' && <Call darkMode={darkMode} />}
                {page === 'notification' && <Notification darkMode={darkMode} />}
                {page === 'announcement' && <AnnouncementAdmin darkMode={darkMode} onDataChanged={refreshAnnouncements} />}
                {page === 'settings' && <Settings darkMode={darkMode} />}
                {page === 'financial' && <Financial navigation={{ goBack: () => setPage('home') }} darkMode={darkMode} role={role} />}
                {page === 'profile' && (
                  <Profile
                    darkMode={darkMode}
                    onUpdated={async () => {
                      try {
                        const token = await AsyncStorage.getItem('token');
                        if (!token) return;
                        const res = await fetch(`${getBaseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
                        if (res.ok) {
                          const me = await res.json();
                          setUser(me);
                          setRole(me?.role === 'superadmin' ? 'superadmin' : me?.role === 'admin' ? 'admin' : 'user');
                        }
                      } catch {}
                    }}
                  />
                )}
              </>
            ) : isVirtualizedPage ? (
              <View style={styles.flex1}>
                {page === 'repairst' && <Repairst darkMode={darkMode} />}
                {page === 'payment' && (
                  <PaymentStatus
                    darkMode={darkMode}
                    onSelectHouse={(hn) => { setSelectedHouse(hn); setPage('paymentDetail'); }}
                  />
                )}
                {page === 'paymentDetail' && selectedHouse && (
                  <PaymentHistory darkMode={darkMode} houseNumber={selectedHouse} onGoQr={() => setPage('qrcode')} />
                )}
                {page === 'usermgr' && (
                  <UserManage darkMode={darkMode} />
                )}
              </View>
            ) : page === 'home' ? (
              <Home
                darkMode={darkMode}
                announcements={announcements}
                goNotification={() => setPage('notification')}
                goPayment={openPaymentPage}
                goCall={() => setPage('call')}
                goRepair={() => setPage('repairst')}
                goFinancial={() => setPage('financial')}
                totalOverdueAmount={homeOverdueAmount}
                totalOverdueLoading={homeOverdueLoading}
                onRefreshOverdue={() => refreshHomeOverdue(true)}
                onRefreshAnnouncements={refreshAnnouncements}
                role={role}
              />
            ) : (
              <ScrollView contentContainerStyle={styles.scrollContent}>
                {page === 'qrcode' && (
                  <Qrcode
                    darkMode={darkMode}
                    onBack={() => {
                      if (selectedHouse) setPage('paymentDetail'); else setPage('home');
                    }}
                  />
                )}
                {page === 'admin' && <Admin />}
              </ScrollView>
            )}
          </View>
        )}
      </SafeAreaView>

      <ChatRoomModal
        visible={isChatRoomPage}
        room={selectedRoom}
        onClose={closeChatRoom}
      />

      {/* Important announcements: one modal with horizontal swipe */}
      <Modal
        visible={importantModalOpen && importantModalItems.length > 0}
        transparent
        animationType="fade"
        onRequestClose={closeImportantModalFromUi}
      >
        <TouchableWithoutFeedback onPress={closeImportantModalFromUi}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <TouchableOpacity
                  accessibilityLabel="close"
                  onPress={closeImportantModalFromUi}
                  style={styles.modalCloseX}
                >
                  <Ionicons name="close" size={18} color={'#333'} />
                </TouchableOpacity>

                <View style={styles.modalPagerWrap}>
                  <Text style={styles.modalPagerText}>
                    {`${Math.min(importantModalIndex + 1, importantModalItems.length)} / ${importantModalItems.length}`}
                  </Text>
                </View>

                <View
                  style={styles.modalCarousel}
                  onLayout={(event) => {
                    const width = Math.round(event.nativeEvent.layout.width);
                    if (width > 0) setImportantModalPageWidth(width);
                  }}
                >
                  <ScrollView
                    ref={importantCarouselRef}
                    key={`important-carousel-${importantModalItems[0]?.id ?? 'empty'}-${importantModalItems.length}`}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.modalCarouselContent}
                    onMomentumScrollEnd={(event) => {
                      const pageWidth = event.nativeEvent.layoutMeasurement.width || importantModalPageWidth;
                      if (pageWidth <= 0) return;
                      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
                      const clamped = Math.max(0, Math.min(nextIndex, importantModalItems.length - 1));
                      setImportantModalIndex(clamped);
                    }}
                  >
                    {importantModalItems.map((item, index) => {
                      const itemKey = getImportantItemKey(item, index);
                      const aspect = importantModalImageAspectMap[itemKey] || 4 / 3;
                      const imageStyle = getImportantModalImageStyle(aspect);

                      return (
                        <View key={itemKey} style={[styles.modalPage, { width: importantModalPageWidth }]}>
                          <Text style={styles.modalTitle1}>{t('importantNotice')}</Text>
                          <Text style={styles.modalTitle}>{item.title || t('announcement')}</Text>
                          {item.description ? (
                            <Text style={styles.modalDesc}>{item.description}</Text>
                          ) : null}
                          <View style={styles.modalDateRow}>
                            <Ionicons name="calendar-outline" size={16} color={'#2E7D32'} />
                            <Text style={styles.modalDateText}>{formatBeThai(item.date)}</Text>
                          </View>
                          {!!item.image && (
                            <View style={styles.modalImageWrap}>
                              <Image
                                source={{ uri: item.image }}
                                style={[styles.modalImageCentered, imageStyle]}
                                onLoad={(event) => {
                                  handleImportantModalImageLoad(itemKey, event);
                                }}
                                resizeMode="contain"
                              />
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.modalNavRow}>
                  <TouchableOpacity
                    onPress={() => moveImportantModalPage(-1)}
                    disabled={importantModalIndex <= 0}
                    style={[
                      styles.modalNavBtn,
                      importantModalIndex <= 0 && styles.modalNavBtnDisabled,
                    ]}
                  >
                    <Ionicons name="chevron-back" size={18} color={importantModalIndex <= 0 ? '#94A3B8' : '#334155'} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => moveImportantModalPage(1)}
                    disabled={importantModalIndex >= importantModalItems.length - 1}
                    style={[
                      styles.modalNavBtn,
                      importantModalIndex >= importantModalItems.length - 1 && styles.modalNavBtnDisabled,
                    ]}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={importantModalIndex >= importantModalItems.length - 1 ? '#94A3B8' : '#334155'}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {notifOpen && (
        <View style={stylesNotif.overlay} pointerEvents="box-none">
          <TouchableWithoutFeedback onPress={() => setNotifOpen(false)}>
            <View style={stylesNotif.backdrop} />
          </TouchableWithoutFeedback>
          <View style={stylesNotif.dropdown}>
            <View style={stylesNotif.headerRow}>
              <Text style={stylesNotif.dropTitle}>{t('notifTitle')}</Text>
              <TouchableOpacity
                onPress={() => {
                  markAllSeen();
                  setBellCount(0); // รีเซ็ตตอนกดปิด
                  setNotifOpen(false);
                }}
              >
                <Text style={stylesNotif.markAll}>{t('close')}</Text>
              </TouchableOpacity>
            </View>
            {notifLoading ? (
              <Text style={stylesNotif.loading}>{t('loading')}</Text>
            ) : notifications.length === 0 ? (
              <Text style={stylesNotif.empty}>{t('notifNoItems')}</Text>
            ) : (
              <>
                <Text style={stylesNotif.metaText}>
                  {`ล่าสุด ${Math.min(notifVisibleCount, notifications.length)} จาก ${notifications.length}`}
                </Text>
                <ScrollView style={styles.notifScroll}>
                  {notifications.slice(0, notifVisibleCount).map(n => {
                    // base color
                    let typeColor = colorFor(n.type);
                    // Override สำหรับ payment ตามสถานะย่อย
                    if (n.type === 'payment') {
                      switch (n.statusCode) {
                        case 'overdue':
                          typeColor = '#F05454'; // แดง
                          break;
                        case 'pending':
                        case 'processing':
                          typeColor = '#FFD34D'; // เหลือง
                          break;
                        case 'paid':
                        case 'success':
                          typeColor = '#26C281'; // เขียว
                          break;
                        default:
                          typeColor = '#16A34A';
                      }
                    }
                    // (ถ้าต้องการ แปลง repair status code เพิ่มได้แบบเดียวกัน)

                    return (
                      <View
                        key={n.id}
                        style={stylesNotif.itemRow}
                      >
                        <Ionicons
                          name={iconNameFor(n.type) as any}
                          size={18}
                          color={typeColor}
                          style={styles.mr10}
                        />
                        <View style={styles.flex1}>
                          <Text
                            style={[
                              stylesNotif.itemTitle,
                              { color: typeColor } as any,
                              n.important && styles.fontBold
                            ]}
                            numberOfLines={2}
                          >
                            {n.title}
                          </Text>
                          {!!n.subtitle && (
                            <Text style={stylesNotif.itemSub} numberOfLines={1}>
                              {n.subtitle}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                {notifications.length > notifVisibleCount && (
                  <TouchableOpacity
                    style={stylesNotif.loadMoreBtn}
                    onPress={() => {
                      setNotifVisibleCount((prev) => Math.min(prev + NOTIF_DROPDOWN_PAGE_SIZE, notifications.length));
                    }}
                  >
                    <Text style={stylesNotif.loadMoreText}>โหลดเพิ่ม</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      )}
    </SafeAreaProvider>
    <GlobalAlertModal darkMode={darkMode} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loginProvider: { flex: 1, backgroundColor: '#0F680FFF' },
  bgBootDark: { backgroundColor: '#1A1A1A' },
  bgBootLight: { backgroundColor: '#8BC34A' },
  flex1: { flex: 1 },
  notifScroll: { maxHeight: 340 },
  mr10: { marginRight: 10 },
  fontBold: { fontWeight: '800' as const },
  whiteContentContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '92%',
    maxWidth: 520,
    borderRadius: 26,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAEAEA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  modalCloseX: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EEF2F5',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 5,
  },
  modalPagerWrap: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2F5',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  modalPagerText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  modalNavRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: 44,
    marginTop: 18,
  },
  modalNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalNavBtnDisabled: {
    opacity: 0.7,
  },
  modalCarousel: {
    width: '100%',
  },
  modalCarouselContent: {
    alignItems: 'stretch',
  },
  modalPage: {
    paddingBottom: 4,
  },
  modalImage: { width: '100%', height: 180, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, marginBottom: 12, backgroundColor: '#F0F0F0' },
  modalImageWrap: { alignItems: 'center', marginTop: 10 },
  modalImageCentered: { borderRadius: 18, alignSelf: 'center' },
  modalImportantBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modalImportantText: { marginLeft: 6, color: '#B08400', fontSize: 12, fontWeight: '800' },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 6, color: '#1F2937' },
  modalTitle1: { fontSize: 20, fontWeight: '900', marginBottom: 6, color: '#F7B220FF' },
  modalDesc: { fontSize: 14, lineHeight: 20, color: '#111827', marginBottom: 12 },
  modalDateRow: { flexDirection: 'row', alignItems: 'center' },
  modalDateText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '800',
    color: '#1B5E20',
    backgroundColor: 'rgba(76, 175, 80, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
});

// เพิ่ม stylesNotif ด้านล่างสุดของไฟล์
const stylesNotif = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 400,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 60,
    paddingRight: 10,
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  dropdown: {
    width: 310,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dropTitle: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
    color: '#1E293B',
  },
  markAll: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  loading: { fontSize: 13, color: '#64748B', paddingVertical: 10 },
  empty: { fontSize: 13, color: '#64748B', paddingVertical: 10 },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemTitle: { fontSize: 13, fontWeight: '700', color: '#334155' },
  itemSub: { fontSize: 11, color: '#64748B', marginTop: 2 },
  metaText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 6,
  },
  loadMoreBtn: {
    marginTop: 8,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  loadMoreText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
  footerBtn: {
    marginTop: 8,
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  footerText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
