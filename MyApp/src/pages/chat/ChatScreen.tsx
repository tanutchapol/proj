/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react/no-unstable-nested-components */
/* eslint-disable react-native/no-inline-styles */
// ChatScreen.tsx
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  Platform, StatusBar, KeyboardAvoidingView, AppState, AppStateStatus,
  Image, Linking, Dimensions, Share, ToastAndroid, ActivityIndicator, Keyboard,
  LayoutAnimation, UIManager, InteractionManager, NativeModules
} from 'react-native';

// LayoutAnimation disabled — causes native crashes when used with inverted FlatList
// if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
//   UIManager.setLayoutAnimationEnabledExperimental(true);
// }
import { Ionicons } from '@react-native-vector-icons/ionicons';
import LinearGradient from 'react-native-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../../components/GlobalAlert';
import io, { Socket } from 'socket.io-client';
import Clipboard from '@react-native-clipboard/clipboard';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary, Asset } from 'react-native-image-picker';
import { openAttachmentFromUrl, openPdfFromUrl, downloadOriginalAttachment } from './pdfViewer';
import { initNotifications, showMessageNotification, setAppBadge } from './notifications';
import { incUnread, clearUnread, getTotalUnread, getTotalUnreadExcept } from './unreadStore';
import { BASE_HOST } from '../config';
import RNFS from 'react-native-fs';
import { Video as VideoCompressor } from 'react-native-compressor';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { PermissionsAndroid } from 'react-native';
import ChatImageViewer from './components/ChatImageViewer';
import PinnedMessagesModal from './components/PinnedMessagesModal';
import MessageActionsModal from './components/MessageActionsModal';
import PdfQuickPreviewModal from './components/PdfQuickPreviewModal';
import VideoQuickPreviewModal from './components/VideoQuickPreviewModal';
import ChatCameraModal from './components/ChatCameraModal';
import { useI18n } from '../../i18n';
import { parseServerDateTime } from '../../lib/datetime';

import { styles } from './ChatScreenStyles';
// === Inline chatHelpers (merged back) ===
function getBaseUrl() {
  return BASE_HOST;
}

type Me = {
  id: number;
  username: string;
  full_name?: string;
  role: 'admin' | 'superadmin' | 'user';
};

const CHAT_ME_CACHE_VERSION = 1;
const CHAT_ME_CACHE_KEY_PREFIX = `chat_me_snapshot_v${CHAT_ME_CACHE_VERSION}_`;

function getChatMeCacheKey(token: string) {
  const suffix = String(token || '').trim().slice(-64);
  return `${CHAT_ME_CACHE_KEY_PREFIX}${suffix}`;
}

function normalizeMeSnapshot(input: any): Me | null {
  const id = Number(input?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;

  const roleRaw = String(input?.role || '').toLowerCase();
  const role: 'admin' | 'superadmin' | 'user' =
    roleRaw === 'admin' || roleRaw === 'superadmin' || roleRaw === 'user'
      ? roleRaw
      : 'user';

  return {
    id,
    username: String(input?.username || ''),
    full_name: input?.full_name ? String(input.full_name) : undefined,
    role,
  };
}

type ChatRoom = {
  id: number;
  name: string;
  room_type: 'public' | 'dm';
};

type MsgStatus = 'sending' | 'sent' | 'delivered' | 'read';

type ChatReaction = {
  message_id: number;
  user_id: number;
  emoji: string;
  username?: string;
  full_name?: string;
  created_at?: string;
};

type ChatMessage = {
  id: number;
  localId?: string;
  room_id: number;
  user_id: number;
  username: string;
  full_name?: string;
  role?: 'admin' | 'superadmin' | 'user';
  text: string;
  created_at: string;
  pinned_at?: string | null;
  msg_type?: 'text' | 'image' | 'file';
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_duration?: number | null;
  mime_type?: string | null;
  video_thumb_url?: string | null;
  reactions?: ChatReaction[];
  status?: MsgStatus;
  upload_progress?: number | null;
  reply_to_id?: number | null;
  reply_to?: {
    id: number;
    user_id: number;
    username: string;
    full_name?: string;
    role?: 'admin' | 'superadmin' | 'user';
    text: string;
    msg_type?: 'text' | 'image' | 'file';
    file_url?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
  } | null;
};

interface ChatScreenProps {
  darkMode?: boolean;
  initialRoom?: ChatRoom | null;
  onBack?: () => void;
}

/* ===== helpers ===== */
const MESSAGE_GROUP_WINDOW_MS = 60_000;
const VIDEO_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;
const VIDEO_THUMB_RETRY_DELAY_MS = 2200;
const VIDEO_THUMB_PREFETCH_RETRY_ROUNDS = 4;
const VIDEO_THUMB_SERVER_SYNC_RETRY_DELAY_MS = 2600;
const VIDEO_THUMB_SERVER_PREFETCH_RETRY_ROUNDS = 8;

const toTs = (v: string) => {
  const d = parseServerDateTime(v);
  return d ? d.getTime() : NaN;
};

const dayKey = (v: string) => {
  const d = parseServerDateTime(v);
  if (!d) return String(v || '').slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

const isSameMinute = (a: string, b: string) => {
  const da = toTs(a);
  const db = toTs(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  return Math.abs(da - db) <= MESSAGE_GROUP_WINDOW_MS;
};

// เนเธเนเธชเธณเธซเธฃเธฑเธเธเธฃเธธเนเธเน€ป็น grid: เธ เธฒเธขเนเธเธเนเธงเธเน€เธงเธฅเธฒเน€เธ”เธตเธขเธงเธเธฑเธเธ•เธฒเธก window
const isCloseInTime = (a: string, b: string, ms = MESSAGE_GROUP_WINDOW_MS) =>
  Math.abs(toTs(a) - toTs(b)) <= ms;

const isSameSender = (a?: number | null, b?: number | null) =>
  String(a ?? '') === String(b ?? '');

function summarizeReactions(reactions: ChatReaction[] | undefined, meId?: number) {
  const rows = Array.isArray(reactions) ? reactions : [];
  if (!rows.length) return [] as Array<{ emoji: string; count: number; mine: boolean; lastTs: number; firstIdx: number }>;

  const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean; lastTs: number; firstIdx: number }>();
  for (let idx = 0; idx < rows.length; idx += 1) {
    const reaction = rows[idx];
    const emoji = String(reaction?.emoji || '').trim();
    if (!emoji) continue;

    if (!byEmoji.has(emoji)) {
      byEmoji.set(emoji, {
        emoji,
        count: 0,
        mine: false,
        lastTs: 0,
        firstIdx: idx,
      });
    }

    const item = byEmoji.get(emoji)!;
    item.count += 1;
    if (meId && Number(reaction?.user_id || 0) === Number(meId)) {
      item.mine = true;
    }

    const ts = Date.parse(String(reaction?.created_at || ''));
    if (Number.isFinite(ts) && ts > item.lastTs) item.lastTs = ts;
  }

  return Array.from(byEmoji.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    return a.firstIdx - b.firstIdx;
  });
}

const getInitial = (name?: string) => {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed[0].toUpperCase();
};

const makeLocalId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const ellipsize = (s: string, n = 70) => (s || '').length > n ? s.slice(0, n - 1) + 'โ€ฆ' : (s || '');

const ellipsizeMiddle = (s: string, max = 44) => {
  const text = String(s || '').trim();
  if (!text || text.length <= max) return text;

  const extMatch = text.match(/(\.[a-z0-9]{1,8})$/i);
  const ext = extMatch ? extMatch[1] : '';
  const tailKeep = Math.max(8, Math.min(16, ext ? ext.length + 8 : 12));
  const headKeep = Math.max(10, max - tailKeep - 1);

  return `${text.slice(0, headKeep)}โ€ฆ${text.slice(-tailKeep)}`;
};

const formatPinnedFileLabel = (fileName: string, t: (key: string, params?: Record<string, string | number>) => string) => {
  const safeName = ellipsizeMiddle(fileName, 42);
  return `${t('chatFile')}: ${safeName}`;
};

function normalizeDurationSeconds(value?: number | null) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // Some sources return milliseconds.
  if (raw >= 1000) return Math.max(1, Math.round(raw / 1000));
  return Math.max(1, Math.round(raw));
}

function formatVideoDurationLabel(seconds?: number | null) {
  const total = Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return '';
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function estimateVideoDurationSecondsFromSize(bytes?: number | null) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return null;
  // Reasonable mobile chat bitrate fallback when real duration is unavailable.
  const assumedBitrateBps = 900_000;
  const seconds = Math.round((size * 8) / assumedBitrateBps);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(60 * 60, Math.max(1, seconds));
}

const getPinnedSortTime = (msg?: Pick<ChatMessage, 'pinned_at' | 'created_at' | 'id'> | null) => {
  const pinnedTs = toTs(String(msg?.pinned_at || ''));
  if (Number.isFinite(pinnedTs)) return pinnedTs;

  const createdTs = toTs(String(msg?.created_at || ''));
  if (Number.isFinite(createdTs)) return createdTs;

  return Number(msg?.id || 0) || 0;
};

const sortPinnedListDesc = (items: ChatMessage[]) => {
  const copy = [...items];
  copy.sort((a, b) => {
    const delta = getPinnedSortTime(b) - getPinnedSortTime(a);
    if (delta !== 0) return delta;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  return copy;
};

const asNum = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isSameMessageIdentity = (
  a?: Pick<ChatMessage, 'id' | 'localId'> | null,
  b?: Pick<ChatMessage, 'id' | 'localId'> | null,
) => {
  if (!a || !b) return false;
  const aId = asNum(a.id);
  const bId = asNum(b.id);
  if (aId && bId) return aId === bId;
  const aLocal = String(a.localId || '');
  const bLocal = String(b.localId || '');
  return !!aLocal && !!bLocal && aLocal === bLocal;
};

const pinnedPreviewText = (msg: ChatMessage | null | undefined, t: (key: string, params?: Record<string, string | number>) => string) => {
  if (!msg) return t('chatLatestPinnedPreview');
  if (msg.msg_type === 'image') {
    const cap = (msg.text || '').trim();
    return cap ? ellipsize(cap.replace(/\s+/g, ' '), 52) : t('chatImageLabel');
  }
  if (msg.msg_type === 'file' || String(msg.file_name || '').trim()) {
    const fileName = decodeDisplayFileName(msg.file_name)
      || decodeDisplayFileName(msg.text)
      || t('chatAttachment');
    return formatPinnedFileLabel(fileName, t);
  }
  const text = (msg.text || '').trim();
  return text ? ellipsize(text.replace(/\s+/g, ' '), 52) : t('chatNoMessage');
};

function absoluteUrl(u?: string | null) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  if (/^(https?:|file:|content:|data:)/i.test(raw)) return raw;
  return `${getBaseUrl()}${raw}`;
}

function normalizeImageUri(u?: string | null) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  if (/^(https?:|file:|content:|data:)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return `file://${raw}`;
  return raw;
}

function buildVideoThumbKey(input: {
  id?: number;
  localId?: string;
  fileUrl?: string | null;
}) {
  const id = Number(input.id || 0);
  if (Number.isFinite(id) && id > 0) return `id:${id}`;
  const localId = String(input.localId || '').trim();
  if (localId) return `local:${localId}`;
  const fileUrl = String(input.fileUrl || '').trim();
  return fileUrl ? `src:${fileUrl}` : '';
}

type CreateVideoThumbnailFn = (config: {
  url: string;
  timeStamp?: number;
  format?: 'jpeg' | 'png';
  dirSize?: number;
  maxWidth?: number;
  maxHeight?: number;
}) => Promise<{ path?: string | null; width?: number; height?: number }>;

type VideoThumbMeta = {
  uri: string;
  width: number;
  height: number;
  aspectRatio: number;
};

function resolveCreateVideoThumbnailFn(): CreateVideoThumbnailFn | null {
  const nativeCreate = (NativeModules as any)?.CreateThumbnail?.create;
  if (typeof nativeCreate === 'function') return nativeCreate as CreateVideoThumbnailFn;
  return null;
}

function decodeDisplayFileName(name?: string | null) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.replace(/\+/g, '%20'));
  } catch {
    return raw;
  }
}

function hasPdfSuffix(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const decoded = decodeDisplayFileName(raw).toLowerCase();
  return /\.pdf(?:$|[?#])/i.test(decoded);
}

function hasWordSuffix(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const decoded = decodeDisplayFileName(raw).toLowerCase();
  return /\.docx?(?:$|[?#])/i.test(decoded);
}

function hasDocxSuffix(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const decoded = decodeDisplayFileName(raw).toLowerCase();
  return /\.docx(?:$|[?#])/i.test(decoded);
}

function hasExcelSuffix(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const decoded = decodeDisplayFileName(raw).toLowerCase();
  return /\.xlsx?(?:$|[?#])/i.test(decoded);
}

function hasVideoSuffix(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const decoded = decodeDisplayFileName(raw).toLowerCase();
  return /\.(mp4|m4v|mov|avi|wmv|webm|mkv|3gp)(?:$|[?#])/i.test(decoded);
}

type AttachmentKind = 'pdf' | 'word' | 'excel' | 'video' | 'file';

function getAttachmentKind(input: {
  mimeType?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  text?: string | null;
}): AttachmentKind {
  const mime = String(input.mimeType || '').toLowerCase();

  if (mime.startsWith('video/') || hasVideoSuffix(input.fileName) || hasVideoSuffix(input.fileUrl) || hasVideoSuffix(input.text)) {
    return 'video';
  }

  if (mime.includes('pdf') || hasPdfSuffix(input.fileName) || hasPdfSuffix(input.fileUrl) || hasPdfSuffix(input.text)) {
    return 'pdf';
  }

  const isWordMime = mime.includes('msword') || mime.includes('wordprocessingml');
  if (isWordMime || hasWordSuffix(input.fileName) || hasWordSuffix(input.fileUrl) || hasWordSuffix(input.text)) {
    return 'word';
  }

  const isExcelMime = mime.includes('ms-excel') || mime.includes('spreadsheetml') || mime.includes('csv');
  if (isExcelMime || hasExcelSuffix(input.fileName) || hasExcelSuffix(input.fileUrl) || hasExcelSuffix(input.text)) {
    return 'excel';
  }

  return 'file';
}

function buildAttachmentFallbackName(asset: Asset, index: number) {
  const mime = String(asset.type || '').toLowerCase();
  if (mime.startsWith('video/')) return `video_${index + 1}.mp4`;
  if (mime.startsWith('image/')) return `image_${index + 1}.jpg`;
  return `file_${index + 1}`;
}

function isPdfLike(input: {
  mimeType?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  text?: string | null;
}) {
  return getAttachmentKind(input) === 'pdf';
}

function isAdminRole(role?: string | null) {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'superadmin';
}

function formatSenderName(input: {
  role?: string | null;
  fullName?: string | null;
  username?: string | null;
  fallback?: string;
}) {
  const baseName = String(input.fullName || input.username || input.fallback || '').trim();
  if (!isAdminRole(input.role)) return baseName;
  const normalizedName = baseName
    .replace(/^\[(admin|นิติบุคคล|กรรมการบริหาร)\]\s*/i, '')
    .replace(/^admin\b[:\-\s]*/i, '')
    .trim();
  const role = String(input.role || '').toLowerCase();
  const prefix = role === 'superadmin' ? '[กรรมการบริหาร]' : '[นิติบุคคล]';
  if (!normalizedName) return prefix;
  return `${prefix} ${normalizedName}`;
}

function splitAdminPrefix(displayName?: string | null) {
  const raw = String(displayName || '');
  const matched = raw.match(/^\[(นิติบุคคล|กรรมการบริหาร|admin)\]\s*/i);
  if (!matched) return null;
  return {
    prefix: raw.slice(0, matched[0].length),
    suffix: raw.slice(matched[0].length),
    type: matched[1].toLowerCase(),
  };
}

function renderSenderNameWithAdminPrefix(displayName?: string | null) {
  const split = splitAdminPrefix(displayName);
  if (!split) return String(displayName || '');
  const isSuper = split.type === 'กรรมการบริหาร' || split.type === 'superadmin';
  return (
    <Text>
      <Text style={isSuper ? styles.superAdminPrefixText : styles.adminPrefixText}>{split.prefix}</Text>
      {split.suffix}
    </Text>
  );
}

/* Safe image wrapper — lazy-loads images to prevent OOM crash when scrolling through old messages */
const _imageLoadQueue = { active: 0, max: 4 };

const SafeChatImage = React.memo(({ source, style, resizeMode }: {
  source: { uri: string };
  style?: any;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
}) => {
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const mountedRef = React.useRef(true);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    if (!source?.uri) { setPhase('error'); return; }

    // Delay image load — if cell scrolls out of view before timer fires, load is skipped
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;

      // Throttle concurrent loads
      if (_imageLoadQueue.active >= _imageLoadQueue.max) {
        // Retry after a short delay
        timerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          _imageLoadQueue.active++;
          setPhase('loading');
        }, 200 + Math.random() * 300);
        return;
      }

      _imageLoadQueue.active++;
      setPhase('loading');
    }, 120);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source?.uri]);

  const onLoad = React.useCallback(() => {
    _imageLoadQueue.active = Math.max(0, _imageLoadQueue.active - 1);
    if (mountedRef.current) setPhase('loaded');
  }, []);

  const onError = React.useCallback(() => {
    _imageLoadQueue.active = Math.max(0, _imageLoadQueue.active - 1);
    if (mountedRef.current) setPhase('error');
  }, []);

  if (phase === 'error' || !source?.uri) {
    return (
      <View style={[style, { backgroundColor: '#E8ECEA', alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="image-outline" size={24} color="#B0C4B8" />
      </View>
    );
  }

  if (phase === 'idle') {
    return (
      <View style={[style, { backgroundColor: '#EEF2F0', alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="small" color="#B0C4B8" />
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        source={source}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        resizeMode={resizeMode || 'cover'}
        onLoad={onLoad}
        onError={onError}
      />
      {phase === 'loading' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#EEF2F0', alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="small" color="#9CB8AC" />
        </View>
      )}
    </View>
  );
});

function normalizeReactions(input: any): ChatReaction[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => ({
      message_id: Number(row?.message_id || 0),
      user_id: Number(row?.user_id || 0),
      emoji: String(row?.emoji || '').trim(),
      username: row?.username ? String(row.username) : undefined,
      full_name: row?.full_name ? String(row.full_name) : undefined,
      created_at: row?.created_at ? String(row.created_at) : undefined,
    }))
    .filter((row) => row.message_id > 0 && row.user_id > 0 && !!row.emoji);
}

const FIXED_UPLOAD_ORIGIN = 'http://192.168.0.8:4000';

function toFixedUploadHostUrl(u?: string | null) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  const normalizedRaw = raw.replace(/(\/uploads\/[^?#]+?)\/+(?=($|[?#]))/i, '$1');

  // Relative upload paths should always use the fixed host.
  if (normalizedRaw.startsWith('/uploads/')) {
    return `${FIXED_UPLOAD_ORIGIN}${normalizedRaw}`;
  }

  try {
    const parsed = new URL(normalizedRaw.startsWith('http') ? normalizedRaw : `${getBaseUrl()}${normalizedRaw}`);
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${FIXED_UPLOAD_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    if (normalizedRaw.startsWith('/')) return `${FIXED_UPLOAD_ORIGIN}${normalizedRaw}`;
    return `${FIXED_UPLOAD_ORIGIN}/${normalizedRaw.replace(/^\/+/, '')}`;
  }
}

function toPdfBrowserViewerUrl(u?: string | null) {
  const fixedUrl = toFixedUploadHostUrl(u);
  if (!fixedUrl) return '';

  try {
    const parsed = new URL(fixedUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const isPdfPath = /^\/(uploads|pdfs)\/.+\.pdf$/i.test(cleanPath);
    if (!isPdfPath) return parsed.toString();

    const filePathWithQuery = `${cleanPath}${parsed.search || ''}`;
    return `${FIXED_UPLOAD_ORIGIN}/pdf-viewer?file=${encodeURIComponent(filePathWithQuery)}`;
  } catch {
    return fixedUrl;
  }
}

function toDocxPreviewUrl(u?: string | null) {
  const fixedUrl = toFixedUploadHostUrl(u);
  if (!fixedUrl) return '';

  try {
    const parsed = new URL(fixedUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const isDocxPath = /^\/(uploads|pdfs)\/.+\.docx$/i.test(cleanPath);
    if (!isDocxPath) return '';

    const filePathWithQuery = `${cleanPath}${parsed.search || ''}`;
    return `${FIXED_UPLOAD_ORIGIN}/api/preview?file=${encodeURIComponent(filePathWithQuery)}`;
  } catch {
    return '';
  }
}

function toOriginalDownloadUrl(u?: string | null, fileName?: string | null) {
  const fixedUrl = toFixedUploadHostUrl(u);
  if (!fixedUrl) return '';

  try {
    const parsed = new URL(fixedUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const isUploadPath = /^\/(uploads|pdfs)\//i.test(cleanPath);
    if (!isUploadPath) return parsed.toString();

    const filePathWithQuery = `${cleanPath}${parsed.search || ''}`;
    const fallbackName = cleanPath.split('/').filter(Boolean).pop() || 'attachment';
    const name = decodeDisplayFileName(fileName) || fallbackName;
    const query = `file=${encodeURIComponent(filePathWithQuery)}&name=${encodeURIComponent(name)}`;
    return `${FIXED_UPLOAD_ORIGIN}/api/download?${query}`;
  } catch {
    return fixedUrl;
  }
}

function buildFileOpenUrlCandidates(u?: string | null) {
  const raw = String(u || '').trim();
  if (!raw) return [] as string[];

  const out: string[] = [];
  const push = (value?: string | null) => {
    const input = String(value || '').trim();
    if (!input) return;
    const normalized = input.replace(/(\/(uploads|pdfs)\/[^?#]+?)\/+((?=$)|(?=[?#]))/i, '$1');
    if (!normalized) return;
    if (!out.includes(normalized)) out.push(normalized);
  };

  const appendOriginsByPath = (value?: string | null) => {
    try {
      const parsed = new URL(String(value || ''));
      const cleanPath = parsed.pathname.replace(/\/+$/, '');
      if (!/^\/(uploads|pdfs)\//i.test(cleanPath)) return;

      const suffix = `${cleanPath}${parsed.search || ''}${parsed.hash || ''}`;
      push(`${getBaseUrl()}${suffix}`);
      push(`${FIXED_UPLOAD_ORIGIN}${suffix}`);

      if (/%[0-9a-f]{2}/i.test(cleanPath)) {
        const decodedPath = decodeURIComponent(cleanPath);
        const decodedSuffix = `${decodedPath}${parsed.search || ''}${parsed.hash || ''}`;
        push(`${getBaseUrl()}${decodedSuffix}`);
        push(`${FIXED_UPLOAD_ORIGIN}${decodedSuffix}`);
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  };

  push(raw);
  push(absoluteUrl(raw));
  push(toFixedUploadHostUrl(raw));
  appendOriginsByPath(absoluteUrl(raw));
  appendOriginsByPath(toFixedUploadHostUrl(raw));

  return out;
}

function extractFirstLink(text?: string | null) {
  const raw = String(text || '');
  const match = raw.match(/(?:https?:\/\/|www\.)[^\s]+/i);
  if (!match) return '';

  let link = String(match[0]).trim().replace(/[)\],.!?;:]+$/, '');
  if (!/^https?:\/\//i.test(link) && /^www\./i.test(link)) {
    link = `https://${link}`;
  }
  return link;
}

function buildCopyText(msg: ChatMessage, t: (key: string, params?: Record<string, string | number>) => string) {
  if (msg.msg_type === 'text' || !msg.msg_type) return msg.text || '';
  if (msg.msg_type === 'image') {
    const parts: string[] = [];
    if (msg.text) parts.push(msg.text);
    if (msg.file_url) parts.push(absoluteUrl(msg.file_url));
    return parts.join('\n');
  }
  const name = decodeDisplayFileName(msg.file_name) || t('chatAttachment');
  const url = absoluteUrl(msg.file_url || '');
  return [name, url].filter(Boolean).join('\n');
}

/** เธ–้า reply_to เนเธกเนเธกเธตเน€นื้อหา เนเธซเนเธ”ึง snapshot จาก messages ปัจจุบัน */
function makeReplySnapshot(
  m: ChatMessage,
  list: ChatMessage[],
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (m.reply_to && (m.reply_to.text || m.reply_to.file_name || m.reply_to.file_url)) {
    return m.reply_to;
  }
  const id = asNum(m.reply_to?.id) || asNum(m.reply_to_id);
  if (!id) return null;
  const found = list.find(x => x.id === id);
  if (!found) {
    return {
      id,
      user_id: 0,
      username: t('chatMessageNumber', { id }),
      text: ''
    } as any;
  }
  return {
    id: found.id,
    user_id: found.user_id,
    username: found.username,
    full_name: found.full_name,
    role: found.role,
    text: found.text,
    msg_type: found.msg_type,
    file_url: found.file_url ?? null,
    file_name: found.file_name ?? null,
  };
}

/* ====== Reply UI pill (multiline & full width) ====== */
const ReplyPill: React.FC<{
  reply: NonNullable<ChatMessage['reply_to']> | (Pick<ChatMessage, 'reply_to_id'> & { reply_to?: never });
  onPress?: () => void;
  mine?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}> = ({ reply, onPress, mine, t }) => {
  const id = asNum((reply as any)?.id) || asNum((reply as any)?.reply_to_id);
  const mimeType = (reply as any)?.mime_type as string | undefined;
  const fileName = (reply as any)?.file_name as string | undefined;
  const isPdf = isPdfLike({
    mimeType,
    fileName,
    fileUrl: (reply as any)?.file_url,
    text: (reply as any)?.text,
  });
  const isImage = (reply as any)?.msg_type === 'image' && !isPdf;
  const isFile = (reply as any)?.msg_type === 'file' || isPdf;
  const text = (reply as any)?.text as string | undefined;
  const name = formatSenderName({
    role: (reply as any)?.role,
    fullName: (reply as any)?.full_name,
    username: (reply as any)?.username,
    fallback: id ? t('chatMessageNumber', { id }) : t('chatPreviousMessage'),
  });
  const imgUri = (reply as any)?.file_url as string | undefined;

  const leftBar = mine ? '#8FA99D' : '#AAB7B1';
  const bg = mine ? '#EDF3F1' : '#F3F5F4';

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 10,
        backgroundColor: bg,
        marginBottom: 6,
        width: '100%',
        minWidth: 220,
      }}
    >
      <View style={{ width: 3, height: '100%', backgroundColor: leftBar, borderRadius: 2, marginRight: 8 }} />
      {!!(isImage && imgUri) && (
        <Image
          source={{ uri: imgUri.startsWith('http') ? imgUri : `${getBaseUrl()}${imgUri}` }}
          style={{ width: 40, height: 40, borderRadius: 6, marginRight: 8, backgroundColor: '#E3E8E6' }}
        />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#24323A' }}>
          {renderSenderNameWithAdminPrefix(name)}
        </Text>

        {isImage ? (
          <>
            <Text style={{ fontSize: 12, color: '#55626A' }}>{t('chatImageLabel')}</Text>
            {text ? (
              <Text style={{ fontSize: 12, color: '#55626A', marginTop: 2 }}>
                {text}
              </Text>
            ) : null}
          </>
        ) : isFile ? (
          <Text style={{ fontSize: 12, color: '#55626A', marginTop: 2 }}>
            📎 {fileName || t('chatAttachment')}
          </Text>
        ) : text ? (
          <Text style={{ fontSize: 12, color: '#55626A', marginTop: 2 }}>
            {text}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

/* ====== Popover Menu ====== */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function getVideoCardRenderSize(meta?: VideoThumbMeta | null) {
  const scale = 0.55;
  const maxWidth = Math.floor((SCREEN_W - 24) * 0.78 * scale);
  const maxHeight = Math.floor(SCREEN_H * 0.52 * scale);
  const minWidth = 96;
  const minHeight = 86;

  const w = Number(meta?.width || 0);
  const h = Number(meta?.height || 0);
  let ratio = Number(meta?.aspectRatio || 0);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    ratio = (w > 0 && h > 0) ? (w / h) : (9 / 16);
  }

  ratio = Math.max(0.45, Math.min(2.2, ratio));

  let width = maxWidth;
  let height = Math.round(width / ratio);

  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ratio);
  }

  if (width < minWidth) {
    width = minWidth;
    height = Math.round(width / ratio);
  }

  if (height < minHeight) {
    height = minHeight;
    width = Math.round(height * ratio);
  }

  width = Math.max(minWidth, Math.min(maxWidth, width));
  height = Math.max(minHeight, Math.min(maxHeight, height));

  return { width, height };
}

type PopoverState = {
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  mine?: boolean;
  isPinned?: boolean;
  target?: ChatMessage | null;
};

const POPOVER_CLOSED_STATE: PopoverState = {
  visible: false,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  target: null,
};

/* ====== share helper for outside icon ====== */
const shareFileMessage = async (
  m: ChatMessage,
  t: (key: string, params?: Record<string, string | number>) => string,
) => {
  try {
    if (!m.file_url) return;
    const url = m.file_url.startsWith('http') ? m.file_url : `${getBaseUrl()}${m.file_url}`;
    const title = decodeDisplayFileName(m.file_name) || t('chatFile');
    const message = `${title}\n${url}`;
    if (Platform.OS === 'ios') await Share.share({ url, message, title });
    else await Share.share({ message });
  } catch (e: any) {
    Platform.OS === 'android'
      ? ToastAndroid.show(t('chatShareFailed'), ToastAndroid.SHORT)
      : showAlert(t('chatShareFailed'), e?.message || '');
  }
};

/* ================================================================== */
/* ============ Render list with image-grid grouping ================= */
/* ================================================================== */
type RenderUnit =
  | { kind: 'msg'; msg: ChatMessage; idx: number; key: string; showDayHeader: boolean }
  | { kind: 'grid'; items: ChatMessage[]; mine: boolean; created_at: string; key: string; showDayHeader: boolean };

const MAX_MESSAGES_IN_MEMORY = 400;
const SOCKET_BATCH_WINDOW_MS = 120;
const AUTO_SCROLL_NEAR_LATEST_PX = 72;
const NOTIFICATION_COOLDOWN_MS = 2500;
const CHAT_MESSAGE_CACHE_VERSION = 1;
const CHAT_MESSAGE_CACHE_KEY_PREFIX = 'chat_room_messages_v1_';
const CHAT_MESSAGE_CACHE_MAX_ITEMS = 160;
const CHAT_MESSAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type ChatMessageCachePayload = {
  v: number;
  roomId: number;
  updatedAt: number;
  hasMore: boolean;
  items: ChatMessage[];
};

function getMessageCacheKey(roomId: number) {
  return `${CHAT_MESSAGE_CACHE_KEY_PREFIX}${roomId}`;
}

function normalizeCachedMessageStatus(input: any): MsgStatus {
  const status = String(input || '');
  if (status === 'sending' || status === 'sent' || status === 'delivered' || status === 'read') {
    return status;
  }
  return 'sent';
}

function sanitizeCachedMessages(input: any): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const out: ChatMessage[] = [];
  const seen = new Set<number>();
  for (const row of input) {
    const id = Number(row?.id || 0);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;

    const roomId = Number(row?.room_id || 0);
    const userId = Number(row?.user_id || 0);
    const createdAt = String(row?.created_at || '').trim();
    if (!roomId || !userId || !createdAt) continue;

    seen.add(id);
    out.push({
      ...(row as ChatMessage),
      id,
      room_id: roomId,
      user_id: userId,
      text: String(row?.text || ''),
      created_at: createdAt,
      localId: undefined,
      status: normalizeCachedMessageStatus(row?.status),
      upload_progress: null,
    });

    if (out.length >= CHAT_MESSAGE_CACHE_MAX_ITEMS) break;
  }

  return out;
}

function toCacheableMessages(input: ChatMessage[]): ChatMessage[] {
  return input
    .filter((msg) => Number(msg.id || 0) > 0)
    .slice(0, CHAT_MESSAGE_CACHE_MAX_ITEMS)
    .map((msg) => ({
      ...msg,
      localId: undefined,
      status: normalizeCachedMessageStatus(msg.status),
      upload_progress: null,
    }));
}

function mergeIncomingMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  if (!incoming.length) return prev;

  let next = prev;
  for (const msg of incoming) {
    // 1) If same id already exists, update it.
    if (msg.id) {
      const sameId = next.findIndex(m => m.id === msg.id);
      if (sameId >= 0) {
        const copy = [...next];
        copy[sameId] = { ...copy[sameId], ...msg, status: 'sent' };
        next = copy;
        continue;
      }
    }

    // 2) Try to match optimistic messages.
    const optimisticIdx = next.findIndex(m =>
      !!m.localId &&
      m.user_id === msg.user_id &&
      (m.text || '') === (msg.text || '') &&
      (m.msg_type || 'text') === (msg.msg_type || 'text') &&
      (m.file_name || '') === (msg.file_name || '')
    );
    if (optimisticIdx >= 0) {
      const copy = [...next];
      copy[optimisticIdx] = { ...copy[optimisticIdx], ...msg, status: 'sent' };
      next = copy;
      continue;
    }

    next = [msg, ...next];
  }

  if (next.length > MAX_MESSAGES_IN_MEMORY) {
    return next.slice(0, MAX_MESSAGES_IN_MEMORY);
  }
  return next;
}


function toRenderUnits(msgs: ChatMessage[], meId?: number): RenderUnit[] {
  const out: RenderUnit[] = [];
  const usedKeys = new Set<string>();
  
  const getUniqueKey = (base: string) => {
    let k = base;
    let c = 1;
    while (usedKeys.has(k)) {
      k = `${base}_${c++}`;
    }
    usedKeys.add(k);
    return k;
  };

  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];

    // เน€งื่อนไขกรุ๊ปรูป (Exclue PDF marked as image)
    const isRealImage = (x: ChatMessage) => x.msg_type === 'image' && !isPdfLike({
      mimeType: x.mime_type,
      fileName: x.file_name,
      fileUrl: x.file_url,
      text: x.text,
    });

    if (isRealImage(m)) {
      const group: ChatMessage[] = [m];
      let j = i + 1;
      while (j < msgs.length) {
        const n = msgs[j];
        if (
          isRealImage(n) &&
          isSameSender(n.user_id, m.user_id) &&
          isCloseInTime(n.created_at, m.created_at, MESSAGE_GROUP_WINDOW_MS) &&
          String(asNum(n.reply_to_id)) === String(asNum(m.reply_to_id))
        ) {
          group.push(n);
          j++;
        } else break;
      }
      if (group.length >= 2) {
        const groupKeyIds = group
          .map(g => (g.id ? String(g.id) : (g.localId ? String(g.localId) : ''))) 
          .filter(Boolean)
          .join('_');
        out.push({
          kind: 'grid',
          items: group,
          mine: isSameSender(m.user_id, meId),
          created_at: group[group.length - 1].created_at,
          key: getUniqueKey(`grid_${groupKeyIds || i}_${group.length}`),
          showDayHeader: false,
        });
        i = j;
        continue;
      }
    }

    const baseKey = m.id ? `id_${m.id}` : (m.localId ? `lid_${m.localId}` : `idx_${i}`);
    out.push({ kind: 'msg', msg: m, idx: i, key: getUniqueKey(baseKey), showDayHeader: false });
    i++;
  }

  // เนเธชเธ”เธเธงเธฑเธเธ—เธตเนเน€เธเธตเธขเธเธเธฃเธฑเนเธเน€เธ”เธตเธขเธงเธ•่อวัน เธ•เธฒเธกเธฅเธณเธ”เธฑเธเธ—เธตเนเน€ห็นจริงใน inverted list (เธ—้าย -> หน้า)
  const seenDays = new Set<string>();
  for (let visualIdx = out.length - 1; visualIdx >= 0; visualIdx--) {
    const unit = out[visualIdx];
    const stamp = unit.kind === 'grid' ? unit.created_at : unit.msg.created_at;
    const dKey = dayKey(stamp);
    if (!seenDays.has(dKey)) {
      unit.showDayHeader = true;
      seenDays.add(dKey);
    }
  }

  return out;
}

/* ================================================================== */



const ChatScreen: React.FC<ChatScreenProps> = ({ darkMode = false, initialRoom, onBack }) => {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [meResolved, setMeResolved] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<ChatRoom | null>(initialRoom || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [pinnedList, setPinnedList] = useState<ChatMessage[]>([]);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [popover, setPopover] = useState<PopoverState>(POPOVER_CLOSED_STATE);

  const flatRef = useRef<FlatList<any>>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingEmitAt = useRef<number>(0);
  const bubbleRefs = useRef<Record<string, View | null>>({});
  const suppressPressAfterLongPressRef = useRef<{ key: string; at: number } | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const [isForeground, setIsForeground] = useState(true);
  const isNearLatestRef = useRef(true);
  const incomingQueueRef = useRef<ChatMessage[]>([]);
  const incomingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNotificationAtRef = useRef<Record<number, number>>({});
  const lastServerReadMarkAtRef = useRef<Record<number, number>>({});
  const serverTrackedRoomIdsRef = useRef<number[]>([]);
  const loadInitialSeqRef = useRef(0);

  // Refs for stable socket handler access (prevents connectSocket from recreating)
  const meRef = useRef(me);
  meRef.current = me;
  const currentRoomRef = useRef(currentRoom);
  currentRoomRef.current = currentRoom;
  const isForegroundRef = useRef(isForeground);
  isForegroundRef.current = isForeground;
  const tRef = useRef(t);
  tRef.current = t;
  const scheduleIncomingFlushRef = useRef<() => void>(() => {});
  const scheduleUnreadSyncRef = useRef<() => void>(() => {});
  const markRoomReadOnServerRef = useRef<(roomId: number) => void>(() => {});
  const loadPinnedRef = useRef<(roomId: number) => Promise<void>>(async () => {});
  const setMessageReactionsRef = useRef<(messageId: number, reactions: ChatReaction[]) => void>(() => {});
  const syncPopoverReactionStateRef = useRef<(messageId: number, reactions: ChatReaction[]) => void>(() => {});

  // Ref for stable renderItem access — prevents FlatList full re-render on every message
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // New State for Image Preview
  const [selectedImages, setSelectedImages] = useState<Asset[]>([]);
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);
  const [cameraPickerVisible, setCameraPickerVisible] = useState(false);
  const composerInputRef = useRef<TextInput | null>(null);

  // Fix: แยก UI เธ•อนพับ/เน€เธเธดเธ” Keyboard (Android)
  const [keyboardUsing, setKeyboardUsing] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(true); // Messenger style
  const [androidKbHeight, setAndroidKbHeight] = useState(0);
  const locale = 'th-TH';
  const formatDayText = useCallback(
    (iso: string) => {
      const d = parseServerDateTime(iso);
      if (!d) return '-';
      return d.toLocaleDateString(locale, {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },
    [locale],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKbHeight(e.endCoordinates.height);
      setKeyboardUsing(true);
    });
    const subHide = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKbHeight(0);
      setKeyboardUsing(false);
      setToolsVisible(true);
    });
    return () => { subShow.remove(); subHide.remove(); };
  }, []);

  const colors = useMemo(() => ({
    bg: '#FFFFFF',
    cardBg: '#FFFFFF',
    text: '#22313A',
    subtext: '#6F8078',
    border: '#DBE5E0',
    primary: '#4F8F77',
    success: '#4B8E74',
    danger: '#D95A5A',
    myBubble: '#E6EEEA',
    otherBubble: '#F5F7F6',
    dayChip: '#DEE8E3',
  }), []);

  const getToken = useCallback(async () => AsyncStorage.getItem('token'), []);

  const readMessagesCache = useCallback(async (roomId: number) => {
    try {
      const raw = await AsyncStorage.getItem(getMessageCacheKey(roomId));
      if (!raw) return null;

      const payload = JSON.parse(raw) as ChatMessageCachePayload;
      if (!payload || Number(payload.v) !== CHAT_MESSAGE_CACHE_VERSION) return null;
      if (Number(payload.roomId || 0) !== roomId) return null;

      const updatedAt = Number(payload.updatedAt || 0);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
      if (Date.now() - updatedAt > CHAT_MESSAGE_CACHE_TTL_MS) return null;

      const items = sanitizeCachedMessages(payload.items);
      if (!items.length) return null;

      return {
        items,
        hasMore: payload.hasMore !== false,
      };
    } catch {
      return null;
    }
  }, []);

  const writeMessagesCache = useCallback(async (roomId: number, items: ChatMessage[], roomHasMore: boolean) => {
    try {
      const cacheItems = toCacheableMessages(items);
      const key = getMessageCacheKey(roomId);

      if (!cacheItems.length) {
        await AsyncStorage.removeItem(key);
        return;
      }

      const payload: ChatMessageCachePayload = {
        v: CHAT_MESSAGE_CACHE_VERSION,
        roomId,
        updatedAt: Date.now(),
        hasMore: !!roomHasMore,
        items: cacheItems,
      };

      await AsyncStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore cache persistence errors.
    }
  }, []);

  const setMessageReactions = useCallback((messageId: number, reactions: ChatReaction[]) => {
    if (!messageId) return;
    setMessages(prev => prev.map((m) => {
      if (m.id !== messageId) return m;
      return { ...m, reactions };
    }));
  }, []);

  const syncPopoverReactionState = useCallback((messageId: number, reactions: ChatReaction[]) => {
    setPopover((prev) => {
      if (!prev.visible || !prev.target) return prev;
      if (asNum(prev.target.id) !== messageId) return prev;
      return {
        ...prev,
        target: {
          ...prev.target,
          reactions,
        },
      };
    });
  }, []);

  const loadReactionsForMessage = useCallback(async (message: ChatMessage) => {
    const messageId = asNum(message?.id);
    if (!messageId) return;

    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`${getBaseUrl()}/chat/reactions/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const reactions = normalizeReactions(payload?.reactions);
      setMessageReactions(messageId, reactions);
      syncPopoverReactionState(messageId, reactions);
    } catch {
      // ignore transient reaction fetch failures
    }
  }, [getToken, setMessageReactions, syncPopoverReactionState]);

  const reactToMessage = useCallback(async (message: ChatMessage, emoji: string) => {
    const messageId = asNum(message?.id);
    if (!messageId || !me?.id) return;

    const token = await getToken();
    if (!token) return;

    const nextEmoji = String(emoji || '').trim();
    if (!nextEmoji) return;

    const myReaction = (Array.isArray(message.reactions) ? message.reactions : [])
      .find((row) => Number(row.user_id || 0) === Number(me.id));

    try {
      let res;
      if (myReaction?.emoji === nextEmoji) {
        res = await fetch(`${getBaseUrl()}/chat/reactions/${messageId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        res = await fetch(`${getBaseUrl()}/chat/reactions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message_id: messageId, emoji: nextEmoji }),
        });
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'REACTION_FAILED');

      const reactions = normalizeReactions(payload?.reactions);
      setMessageReactions(messageId, reactions);
      syncPopoverReactionState(messageId, reactions);
    } catch (e: any) {
      showAlert('อัปเดตรีแอคชันไม่สำเร็จ', e?.message || 'ลองใหม่อีกครั้ง');
    }
  }, [getToken, me?.id, setMessageReactions, syncPopoverReactionState]);

  // ===== Me =====
  const fetchMe = useCallback(async () => {
    setMeResolved(false);
    let hydratedFromCache = false;

    try {
      const token = await getToken();
      if (!token) {
        setMe(null);
        setMeResolved(true);
        return;
      }

      const cacheKey = getChatMeCacheKey(token);
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        const cached = normalizeMeSnapshot(raw ? JSON.parse(raw) : null);
        if (cached) {
          hydratedFromCache = true;
          setMe(cached);
          setMeResolved(true);
        }
      } catch {
        // Ignore invalid local cache and continue with server request.
      }

      const res = await fetch(`${getBaseUrl()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('ME_FAILED');
      const data = normalizeMeSnapshot(await res.json());
      if (!data) throw new Error('ME_INVALID');
      setMe(data);
      setMeResolved(true);

      AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
    } catch {
      if (!hydratedFromCache) {
        setMe(null);
        setMeResolved(true);
      }
    }
  }, [getToken]);

  // ===== Pinned (multiple) =====
  const loadPinned = useCallback(async (roomId: number) => {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${getBaseUrl()}/chat/message-pins?room_id=${roomId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'PINNED_FETCH_FAILED');

      const list = Array.isArray(payload?.data)
        ? payload.data
        : (Array.isArray(payload) ? payload : []);
      setPinnedList(sortPinnedListDesc(list as ChatMessage[]));
    } catch {
      // Keep the previous pinned list to avoid hiding latest pin on transient failures.
    }
  }, [getToken]);

  const togglePin = useCallback(async (roomId: number, msg: ChatMessage) => {
    const messageId = Number(msg.id || 0);
    if (!Number.isFinite(messageId) || messageId <= 0) return;

    const wasPinned = pinnedList.some(p => Number(p.id || 0) === messageId);
    const nextPinned = !wasPinned;

    setPinnedList(prev => {
      if (nextPinned) {
        if (prev.some(p => Number(p.id || 0) === messageId)) return prev;
        const optimisticPinned: ChatMessage = {
          ...msg,
          pinned_at: new Date().toISOString(),
        };
        return sortPinnedListDesc([...prev, optimisticPinned]);
      }
      // Do not remove optimistically on unpin; permission can reject in public rooms.
      return prev;
    });

    try {
      const token = await getToken();
      if (!token) throw new Error('NO_TOKEN');

      const res = await fetch(`${getBaseUrl()}/chat/message-pins/${messageId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'PINNED_UPDATE_FAILED');
    } catch {
      await loadPinned(roomId);
      return;
    }

    await loadPinned(roomId);
  }, [getToken, pinnedList, loadPinned]);

  const unpinOne = useCallback(async (roomId: number, msgId: number | string) => {
    const messageId = Number(msgId || 0);
    if (!Number.isFinite(messageId) || messageId <= 0) return;

    try {
      const token = await getToken();
      if (!token) throw new Error('NO_TOKEN');

      const res = await fetch(`${getBaseUrl()}/chat/message-pins/${messageId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pinned: false }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'PINNED_REMOVE_FAILED');
    } catch {
      // If update fails, sync from server to keep state consistent.
    }

    await loadPinned(roomId);
  }, [getToken, loadPinned]);
  const PAGE_SIZE = 30;
  const INITIAL_PAGE_SIZE = 20;
  
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // ===== Messages =====
  const fetchMessages = useCallback(async (
    roomId: number,
    beforeId?: number,
    options?: { limit?: number; showLoading?: boolean }
  ) => {
    const limit = Math.min(Math.max(Number(options?.limit ?? PAGE_SIZE), 1), 100);
    const showLoading = options?.showLoading ?? false;
    try {
      if (showLoading) setMsgLoading(true);
      const token = await getToken();
      if (!token) return [];

      let url = `${getBaseUrl()}/chat/messages?room_id=${roomId}&limit=${limit}`;
      if (beforeId) url += `&before_id=${beforeId}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'MESSAGES_FAILED');
      return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    } catch {
      return [];
    } finally {
      if (showLoading) setMsgLoading(false);
    }
  }, [getToken]);
  
  const loadInitial = useCallback(async (roomId: number) => {
    try {
      const seq = loadInitialSeqRef.current + 1;
      loadInitialSeqRef.current = seq;

      const cached = await readMessagesCache(roomId);
      if (loadInitialSeqRef.current !== seq) return;

      const hasCachedItems = !!cached?.items?.length;
      if (hasCachedItems) {
        setMsgLoading(false);
        setMessages(cached!.items);
        setHasMore(cached!.hasMore);

        requestAnimationFrame(() => {
          flatRef.current?.scrollToOffset({ offset: 0, animated: false });
        });
      }

      const list = await fetchMessages(roomId, undefined, {
        limit: INITIAL_PAGE_SIZE,
        showLoading: !hasCachedItems,
      });
      if (loadInitialSeqRef.current !== seq) return;

      if (!list.length) {
        if (!hasCachedItems) {
          setMessages([]);
          setHasMore(false);
          await writeMessagesCache(roomId, [], false);
        }
        return;
      }

      const merged = hasCachedItems
        ? mergeIncomingMessages(cached!.items, list)
        : list;
      const nextHasMore = list.length === INITIAL_PAGE_SIZE || (cached?.hasMore ?? false);

      setMessages(merged);
      setHasMore(nextHasMore);
      writeMessagesCache(roomId, merged, nextHasMore);

      requestAnimationFrame(() => {
        flatRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
    } catch (e) {
      console.warn('[ChatScreen] loadInitial error:', e);
      setMsgLoading(false);
    }
  }, [fetchMessages, readMessagesCache, writeMessagesCache]);
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !messages.length || !currentRoom) return;
    // Cap total messages in memory to prevent OOM
    if (messages.length >= MAX_MESSAGES_IN_MEMORY) { setHasMore(false); return; }
    setLoadingMore(true);

    try {
      const oldest = messages[messages.length - 1];
      if (!oldest) { setLoadingMore(false); return; }
      const more = await fetchMessages(currentRoom.id, oldest.id, { limit: PAGE_SIZE, showLoading: false });

      if (more.length === 0) {
        setHasMore(false);
      } else {
        setMessages(prev => {
          const ids = prev
            .map(m => m.id)
            .filter((id): id is number => Number.isFinite(id) && id > 0);
          const existing = new Set<number>(ids);
          const deduped = more.filter((m: ChatMessage) => m.id <= 0 || !existing.has(m.id));
          return [...prev, ...deduped];
        });
      }
    } catch (e) {
      console.warn('[ChatScreen] loadMore error:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages, currentRoom, fetchMessages]);

  useEffect(() => {
    const roomId = Number(currentRoom?.id || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return;

    const timer = setTimeout(() => {
      writeMessagesCache(roomId, messages, hasMore);
    }, 220);

    return () => clearTimeout(timer);
  }, [currentRoom?.id, messages, hasMore, writeMessagesCache]);

  const flushIncomingQueue = useCallback(() => {
    if (incomingFlushTimerRef.current) {
      clearTimeout(incomingFlushTimerRef.current);
      incomingFlushTimerRef.current = null;
    }
    if (!incomingQueueRef.current.length) return;

    const batch = incomingQueueRef.current.splice(0, incomingQueueRef.current.length);
    setMessages(prev => mergeIncomingMessages(prev, batch));
  }, []);

  const scheduleIncomingFlush = useCallback(() => {
    if (incomingFlushTimerRef.current) return;
    incomingFlushTimerRef.current = setTimeout(() => {
      flushIncomingQueue();
    }, SOCKET_BATCH_WINDOW_MS);
  }, [flushIncomingQueue]);

  const syncBadgeFromServer = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      const localTotal = await getTotalUnread();
      await setAppBadge(localTotal);
      return;
    }

    try {
      const res = await fetch(`${getBaseUrl()}/chat/unread-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'UNREAD_SUMMARY_FAILED');

      const trackedIds = Array.isArray(payload?.tracked_room_ids)
        ? payload.tracked_room_ids
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
        : [];
      serverTrackedRoomIdsRef.current = trackedIds;

      const serverTotal = Number(payload?.total_unread || 0);
      const localOnlyTotal = await getTotalUnreadExcept(trackedIds);
      await setAppBadge(Math.max(0, serverTotal + localOnlyTotal));
    } catch {
      const trackedIds = serverTrackedRoomIdsRef.current;
      const localFallback = trackedIds.length > 0
        ? await getTotalUnreadExcept(trackedIds)
        : await getTotalUnread();
      await setAppBadge(localFallback);
    }
  }, [getToken]);

  const scheduleUnreadSync = useCallback(() => {
    if (unreadSyncTimerRef.current) return;
    unreadSyncTimerRef.current = setTimeout(() => {
      unreadSyncTimerRef.current = null;
      syncBadgeFromServer()
        .catch(() => {});
    }, 450);
  }, [syncBadgeFromServer]);

  const markRoomReadOnServer = useCallback(async (roomId: number) => {
    if (!roomId) return;
    const token = await getToken();
    if (!token) return;

    try {
      await fetch(`${getBaseUrl()}/chat/rooms/${roomId}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Silent fallback: local unread still works.
    }
  }, [getToken]);

  useEffect(() => {
    return () => {
      if (incomingFlushTimerRef.current) {
        clearTimeout(incomingFlushTimerRef.current);
        incomingFlushTimerRef.current = null;
      }
      if (unreadSyncTimerRef.current) {
        clearTimeout(unreadSyncTimerRef.current);
        unreadSyncTimerRef.current = null;
      }
      incomingQueueRef.current = [];
    };
  }, []);


  // ===== Socket =====
  // Keep refs up-to-date for stable socket callbacks
  useEffect(() => { scheduleIncomingFlushRef.current = scheduleIncomingFlush; }, [scheduleIncomingFlush]);
  useEffect(() => { scheduleUnreadSyncRef.current = scheduleUnreadSync; }, [scheduleUnreadSync]);
  useEffect(() => { markRoomReadOnServerRef.current = markRoomReadOnServer; }, [markRoomReadOnServer]);
  useEffect(() => { loadPinnedRef.current = loadPinned; }, [loadPinned]);
  useEffect(() => { setMessageReactionsRef.current = setMessageReactions; }, [setMessageReactions]);
  useEffect(() => { syncPopoverReactionStateRef.current = syncPopoverReactionState; }, [syncPopoverReactionState]);

  const connectSocket = useCallback(async (roomId: number) => {
    const token = await getToken();
    if (!token) return;

    if (socketRef.current) {
      try { socketRef.current.disconnect(); } catch { }
      socketRef.current = null;
    }

    const socket = io(getBaseUrl(), {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${token}` },
      auth: { token: `Bearer ${token}` },
    });

    socket.on('connect', () => {
      socket.emit('join_room', { room_id: roomId });
    });

    socket.on('new_message', async (msg: ChatMessage) => {
      incomingQueueRef.current.push(msg);
      scheduleIncomingFlushRef.current();

      const mine = msg.user_id === meRef.current?.id;
      if (mine) {
        setReplyingTo(null);
      } else if (currentRoomRef.current?.id === msg.room_id && isNearLatestRef.current) {
        setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
      }

      const inThisRoom = currentRoomRef.current?.id === msg.room_id;
      if (!mine && inThisRoom && isForegroundRef.current && isNearLatestRef.current) {
        const now = Date.now();
        const lastAt = Number(lastServerReadMarkAtRef.current[msg.room_id] || 0);
        if (now - lastAt >= 1200) {
          lastServerReadMarkAtRef.current[msg.room_id] = now;
          markRoomReadOnServerRef.current(msg.room_id);
          scheduleUnreadSyncRef.current();
        }
      }

      if (!mine && (!inThisRoom || !isForegroundRef.current)) {
        await incUnread(msg.room_id);
        scheduleUnreadSyncRef.current();

        const now = Date.now();
        const lastAt = Number(lastNotificationAtRef.current[msg.room_id] || 0);
        if (now - lastAt >= NOTIFICATION_COOLDOWN_MS) {
          lastNotificationAtRef.current[msg.room_id] = now;
          const room = currentRoomRef.current;
          const tt = tRef.current;
          await showMessageNotification({
            title: room?.name ? tt('chatNewMessageInRoom', { room: room.name }) : tt('chatNewMessage'),
            body: msg.msg_type === 'text'
              ? (msg.text || tt('chatNewMessage'))
              : (msg.msg_type === 'image' ? tt('chatSentImage') : (msg.file_name || tt('chatSentFile'))),
            data: { room_id: String(msg.room_id) }
          });
        }
      }
    });

    socket.on('message_status', (p: { room_id: number; message_id: number; status: MsgStatus; reader_user_id?: number }) => {
      const payloadRoomId = asNum(p?.room_id);
      const messageId = asNum(p?.message_id);
      if (!payloadRoomId || !messageId || payloadRoomId !== currentRoomRef.current?.id) return;

      if (p?.status === 'read') {
        const readerUserId = asNum(p?.reader_user_id);
        if (readerUserId && readerUserId === meRef.current?.id) return;

        setMessages((prev) => prev.map((m) => {
          const mid = asNum(m.id);
          if (!mid || mid > messageId) return m;
          if (Number(m.user_id || 0) !== Number(meRef.current?.id || 0)) return m;
          if (m.status === 'sending' || m.status === 'read') return m;
          return { ...m, status: 'read' };
        }));
        return;
      }

      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, status: p.status } : m)));
    });

    socket.on('reaction_update', (p: { room_id?: number; message_id: number; reactions: ChatReaction[] }) => {
      const payloadRoomId = asNum(p?.room_id);
      if (payloadRoomId && payloadRoomId !== currentRoomRef.current?.id) return;

      const messageId = asNum(p?.message_id);
      if (!messageId) return;

      const reactions = normalizeReactions(p?.reactions);
      setMessageReactionsRef.current(messageId, reactions);
      syncPopoverReactionStateRef.current(messageId, reactions);
    });

    socket.on('message_pin_update', (p: { room_id: number; message_id: number; user_id: number; pinned: boolean }) => {
      if (p.room_id !== currentRoomRef.current?.id) return;
      loadPinnedRef.current(p.room_id).catch(() => {});
    });

    socket.on('typing', (p: { room_id: number; user_id: number; username: string; full_name?: string; typing: boolean }) => {
      if (p.room_id !== currentRoomRef.current?.id || p.user_id === meRef.current?.id) return;
      const name = p.full_name || p.username;
      setTypingUsers((prev) => {
        const copy = { ...prev };
        if (p.typing) copy[name] = Date.now() + 2500;
        else delete copy[name];
        return copy;
      });
    });

    socket.on('disconnect', () => { });

    socketRef.current = socket;
  }, [getToken]);  // Only depends on getToken - stable!

  // typing emit
  const emitTyping = useCallback((typing: boolean) => {
    if (!currentRoom || !socketRef.current) return;
    const now = Date.now();
    if (typing) {
      if (now - lastTypingEmitAt.current < 1000) return;
      lastTypingEmitAt.current = now;
    }
    socketRef.current.emit('typing', { room_id: currentRoom.id, typing });
  }, [currentRoom?.id]);

  const statFileSizeByUri = useCallback(async (uri?: string | null) => {
    const raw = String(uri || '').trim();
    if (!raw) return null;
    if (/^content:/i.test(raw)) return null;

    let filePath = raw;
    if (/^file:/i.test(raw)) {
      const withoutScheme = raw.replace(/^file:\/\//i, '');
      try {
        filePath = decodeURIComponent(withoutScheme);
      } catch {
        filePath = withoutScheme;
      }
    }

    try {
      const st = await RNFS.stat(filePath);
      const sizeNum = Number(st.size);
      if (!Number.isFinite(sizeNum) || sizeNum <= 0) return null;
      return sizeNum;
    } catch {
      return null;
    }
  }, []);

  const compressVideoSourceIfNeeded = useCallback(async (input: {
    uri: string;
    type?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
  }) => {
    const originalUri = String(input.uri || '').trim();
    const originalType = String(input.type || '').trim();
    const originalSize = Number(input.fileSize || 0);
    const normalizedSize = Number.isFinite(originalSize) && originalSize > 0 ? originalSize : null;

    if (!originalUri) {
      return {
        uri: '',
        type: originalType || 'application/octet-stream',
        fileSize: normalizedSize,
      };
    }

    const kind = getAttachmentKind({
      mimeType: originalType,
      fileName: input.fileName,
      fileUrl: originalUri,
      text: input.fileName,
    });
    if (kind !== 'video') {
      return {
        uri: originalUri,
        type: originalType || 'application/octet-stream',
        fileSize: normalizedSize,
      };
    }

    const shouldCompress = normalizedSize == null || normalizedSize >= VIDEO_COMPRESS_THRESHOLD_BYTES;
    if (!shouldCompress) {
      return {
        uri: originalUri,
        type: originalType || 'video/mp4',
        fileSize: normalizedSize,
      };
    }

    try {
      const compressedUri = await VideoCompressor.compress(originalUri, { compressionMethod: 'auto' });
      const nextUri = String(compressedUri || '').trim();
      if (!nextUri || nextUri === originalUri) {
        return {
          uri: originalUri,
          type: originalType || 'video/mp4',
          fileSize: normalizedSize,
        };
      }

      const compressedSize = await statFileSizeByUri(nextUri);
      return {
        uri: nextUri,
        type: originalType || 'video/mp4',
        fileSize: compressedSize ?? normalizedSize,
      };
    } catch {
      return {
        uri: originalUri,
        type: originalType || 'video/mp4',
        fileSize: normalizedSize,
      };
    }
  }, [statFileSizeByUri]);



  // ===== upload single (keep for camera/doc) =====
  type UploadPart = { uri: string; name: string; type: string; size?: number | null; duration?: number | null };

  const uploadAttachment = useCallback(async (file: UploadPart) => {
    if (!currentRoom || !me) return;
    const token = await getToken();
    if (!token) return showAlert(t('chatNotLoggedIn'));

    const prepared = await compressVideoSourceIfNeeded({
      uri: file.uri,
      type: file.type,
      fileName: file.name,
      fileSize: file.size,
    });
    const effectiveFile: UploadPart = {
      ...file,
      uri: prepared.uri || file.uri,
      type: prepared.type || file.type,
      size: prepared.fileSize ?? file.size ?? null,
    };

    const isImage = effectiveFile.type.startsWith('image/');
    const localId = makeLocalId();

    const temp: ChatMessage = {
      id: 0,
      localId,
      room_id: currentRoom.id,
      user_id: me.id,
      username: me.username,
      full_name: me.full_name,
      role: me.role,
      text: isImage ? '' : (effectiveFile.name || t('chatAttachment')),
      msg_type: isImage ? 'image' : 'file',
      file_url: effectiveFile.uri,
      file_name: effectiveFile.name,
      file_size: effectiveFile.size || null,
      file_duration: normalizeDurationSeconds(effectiveFile.duration),
      mime_type: effectiveFile.type,
      created_at: new Date().toISOString(),
      status: 'sending',
      upload_progress: 0,
      reply_to_id: asNum(replyingTo?.id),
      reply_to: replyingTo ? {
        id: replyingTo.id,
        user_id: replyingTo.user_id,
        username: replyingTo.username,
        full_name: replyingTo.full_name,
        role: replyingTo.role,
        text: replyingTo.text,
        msg_type: replyingTo.msg_type,
        file_url: replyingTo.file_url ?? null,
        file_name: replyingTo.file_name ?? null,
      } : null,
    };

    // Keep newest-first order for inverted FlatList
    setMessages(prev => [temp, ...prev]);
    setReplyingTo(null);
    setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 0);

    try {
      const form = new FormData();
      form.append('room_id', String(currentRoom.id));
      if (temp.reply_to_id) form.append('reply_to_id', String(temp.reply_to_id));
      form.append('file', {
        uri: effectiveFile.uri,
        type: effectiveFile.type,
        name: effectiveFile.name
      } as any);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getBaseUrl()}/chat/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e: any) => {
        if (e && e.lengthComputable) {
          const p = Math.max(0, Math.min(1, e.loaded / e.total));
          setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, upload_progress: p } : m)));
        }
      };
      xhr.onload = () => {
        try {
          const status = xhr.status;
          const j = JSON.parse(xhr.responseText || '{}');
          if (status < 200 || status >= 300) throw new Error(j?.error || 'UPLOAD_FAILED');
          if (j?.id) {
            setMessages(prev => prev.map(m =>
              (m.localId === localId
                ? {
                    ...m,
                    id: j.id,
                    status: 'sent',
                    file_url: j.file_url ?? m.file_url,
                    upload_progress: null,
                    file_duration: m.file_duration ?? null,
                  }
                : m)
            ));
          } else {
            setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sent', upload_progress: null } : m)));
          }
        } catch (e: any) {
          setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sending' } : m)));
          showAlert(t('chatUploadFailed'), e?.message || t('chatTryAgain'));
        }
      };
      xhr.onerror = () => {
        setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sending' } : m)));
        showAlert(t('chatUploadFailed'), t('chatNetworkError'));
      };
      xhr.send(form as any);
    } catch (e: any) {
      setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sending' } : m)));
      showAlert(t('chatUploadFailed'), e?.message || t('chatTryAgain'));
    }
  }, [currentRoom, me, getToken, replyingTo, t, compressVideoSourceIfNeeded]);

  // ======= multi-images upload =======
  const uploadImagesMulti = useCallback(async (assets: Asset[]) => {
    if (!currentRoom || !me) return;
    const token = await getToken();
    if (!token) return showAlert(t('chatNotLoggedIn'));

    const preparedAssets: Asset[] = [];
    setIsPreparingUpload(true);
    try {
      for (let idx = 0; idx < assets.length; idx += 1) {
        const a = assets[idx];
        const uri = String(a.uri || '').trim();
        if (!uri) continue;

        const compressed = await compressVideoSourceIfNeeded({
          uri,
          type: a.type,
          fileName: a.fileName,
          fileSize: a.fileSize,
        });

        preparedAssets.push({
          ...a,
          uri: compressed.uri || uri,
          type: compressed.type || a.type || 'application/octet-stream',
          fileSize: compressed.fileSize ?? a.fileSize ?? undefined,
          fileName: a.fileName || buildAttachmentFallbackName(a, idx),
        });
      }
    } finally {
      setIsPreparingUpload(false);
    }

    if (!preparedAssets.length) {
      showAlert(t('chatUploadFailed'), t('chatCannotPickFile'));
      return;
    }

    const caption = text.trim();
    const replyToId = asNum(replyingTo?.id);

    // optimistic messages
    const localIds: string[] = [];
    const temps: ChatMessage[] = preparedAssets.map((a, i) => {
      const localId = makeLocalId();
      localIds.push(localId);
      return {
        id: 0,
        localId,
        room_id: currentRoom.id,
        user_id: me.id,
        username: me.username,
        full_name: me.full_name,
        role: me.role,
        text: i === 0 ? caption : '',
        created_at: new Date().toISOString(),
        msg_type: (a.type || '').startsWith('image/') ? 'image' : 'file',
        file_url: a.uri || '',
        file_name: a.fileName || t('chatFile'),
        file_size: a.fileSize || null,
        file_duration: normalizeDurationSeconds((a as any).duration),
        mime_type: a.type || 'application/octet-stream',
        status: 'sending',
        upload_progress: 0,
        reply_to_id: replyToId,
        reply_to: replyingTo ? {
          id: replyingTo.id,
          user_id: replyingTo.user_id,
          username: replyingTo.username,
          full_name: replyingTo.full_name,
          role: replyingTo.role,
          text: replyingTo.text,
          msg_type: replyingTo.msg_type,
          file_url: replyingTo.file_url ?? null,
          file_name: replyingTo.file_name ?? null,
        } : null,
      };
    });

    // Keep newest-first order for inverted FlatList
    setMessages(prev => [...temps, ...prev]);
    setReplyingTo(null);
    if (caption) setText('');
    setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 0);

    try {
      const form = new FormData();
      form.append('room_id', String(currentRoom.id));
      if (replyToId) form.append('reply_to_id', String(replyToId));
      if (caption) form.append('caption', caption);

      preparedAssets.forEach((a, idx) => {
        if (!a.uri) return;
        const type = a.type || 'application/octet-stream';
        const name = a.fileName || buildAttachmentFallbackName(a, idx);
        (form as any).append('files', { uri: a.uri, name, type } as any);
      });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getBaseUrl()}/chat/upload-multi`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      const localIdSet = new Set(localIds);
      let lastProgressBucket = -1;
      let lastProgressAt = 0;
      xhr.upload.onprogress = (e: any) => {
        if (e && e.lengthComputable) {
          const rawP = Math.max(0, Math.min(1, e.loaded / e.total));
          const bucket = rawP >= 0.995 ? 100 : Math.floor(rawP * 20); // 5% per update
          const now = Date.now();
          if (bucket === lastProgressBucket && now - lastProgressAt < 180) return;

          lastProgressBucket = bucket;
          lastProgressAt = now;
          const p = bucket >= 100 ? 1 : bucket / 20;

          setMessages(prev => {
            let changed = false;
            const next = prev.map(m => {
              const lid = m.localId || '';
              if (!lid || !localIdSet.has(lid)) return m;
              if (m.upload_progress === p) return m;
              changed = true;
              return { ...m, upload_progress: p };
            });
            return changed ? next : prev;
          });
        }
      };
      xhr.onload = () => {
        try {
          const status = xhr.status;
          const j = JSON.parse(xhr.responseText || '{}');
          if (status < 200 || status >= 300) throw new Error(j?.error || 'UPLOAD_FAILED');
          const realList: ChatMessage[] = Array.isArray(j?.data) ? j.data : [];
          setMessages(prev => {
            let copy = [...prev];
            realList.forEach((real, i) => {
              const lid = localIds[i];
              const idx = copy.findIndex(m => m.localId === lid);
              if (idx >= 0) {
                const localDuration = normalizeDurationSeconds(copy[idx].file_duration);
                copy[idx] = {
                  ...real,
                  file_duration: localDuration ?? normalizeDurationSeconds((real as any)?.file_duration),
                  status: 'sent',
                  upload_progress: null,
                };
              }
            });
            return copy;
          });
        } catch (e: any) {
          setMessages(prev => prev.map(m => (localIdSet.has(m.localId || '') ? { ...m, status: 'sending' } : m)));
          showAlert(t('chatUploadFailed'), e?.message || t('chatTryAgain'));
        }
      };
      xhr.onerror = () => {
        setMessages(prev => prev.map(m => (localIdSet.has(m.localId || '') ? { ...m, status: 'sending' } : m)));
        showAlert(t('chatUploadFailed'), t('chatNetworkError'));
      };
      xhr.send(form as any);
    } catch (e: any) {
      const localIdSet = new Set(localIds);
      setMessages(prev => prev.map(m =>
        (localIdSet.has(m.localId || '') ? { ...m, status: 'sending' } : m)
      ));
      showAlert(t('chatUploadFailed'), e?.message || t('chatTryAgain'));
    }
  }, [currentRoom, me, getToken, replyingTo, text, t, compressVideoSourceIfNeeded]);

  // send text
  const sendMessage = useCallback(async () => {
    if (isPreparingUpload) return;

    // 1. เธ–เนเธฒเธกเธตเธฃเธนเธเธ าพรอส่ง เนเธซเนเธชเนเธเธฃเธนเธเธ าพ (เธเธฃเนเธญเธกเนเธเธเธเธฑเนเธเธ–้ามี)
    if (selectedImages.length > 0) {
      await uploadImagesMulti(selectedImages);
      setSelectedImages([]);
      // uploadImagesMulti เธเธฐเน€คลียร์ text เนเธซเนเน€เธญเธเธ–้ามี caption
      return;
    }

    // 2. เธ–้าไม่มีรูป เธเนเธชเนเธเธเนเธญเธเธงเธฒเธกเธ•เธฒเธกเธเธเธ•เธด
    const trimmedText = text.trim();
    if (!trimmedText || !currentRoom || !me) return;

    const localId = makeLocalId();
    const temp: ChatMessage = {
      id: 0,
      localId,
      room_id: currentRoom.id,
      user_id: me.id,
      username: me.username,
      full_name: me.full_name,
      role: me.role,
      text: trimmedText,
      created_at: new Date().toISOString(),
      msg_type: 'text',
      status: 'sending',
      reply_to_id: asNum(replyingTo?.id),
      reply_to: replyingTo ? {
        id: replyingTo.id,
        user_id: replyingTo.user_id,
        username: replyingTo.username,
        full_name: replyingTo.full_name,
        role: replyingTo.role,
        text: replyingTo.text,
        msg_type: replyingTo.msg_type,
        file_url: replyingTo.file_url ?? null,
        file_name: replyingTo.file_name ?? null,
      } : null,
    };

    // Keep newest-first order for inverted FlatList
    setMessages(prev => [temp, ...prev]);
    setText('');
    setReplyingTo(null);
    setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 0);

    try {
      const token = await getToken();
      const body: any = { room_id: currentRoom.id, text: trimmedText };
      if (temp.reply_to_id) body.reply_to_id = temp.reply_to_id;

      const res = await fetch(`${getBaseUrl()}/chat/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'SEND_FAILED');

      if (j?.id) {
        setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, id: j.id, status: 'sent' } : m)));
      } else {
        setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sent' } : m)));
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => (m.localId === localId ? { ...m, status: 'sending' } : m)));
      showAlert(t('chatSendFailed'), e?.message || t('chatTryAgain'));
    }
  }, [text, currentRoom, me, getToken, replyingTo, selectedImages, uploadImagesMulti, t, isPreparingUpload]);

  // pickers
  const pickDocument = useCallback(async () => {
    try {
      composerInputRef.current?.blur();
      Keyboard.dismiss();
      if (Platform.OS === 'android') await new Promise(r => setTimeout(r, 350));
      const res = await pick({ type: [types.allFiles], allowMultiSelection: true });
      const newAssets = res.map(r => ({
        uri: r.uri,
        fileName: r.name || 'file',
        type: r.type || 'application/octet-stream',
        fileSize: r.size || 0,
      } as Asset));
      
      setSelectedImages(prev => [...prev, ...newAssets]);
    } catch (e: any) {
      if (!(isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED)) {
        showAlert(t('chatPickFailed'), e?.message || t('chatCannotPickFile'));
      }
    }
  }, [t]);

  const pickImagesMulti = useCallback(async () => {
    composerInputRef.current?.blur();
    Keyboard.dismiss();
    if (Platform.OS === 'android') await new Promise(r => setTimeout(r, 350));
    const res = await launchImageLibrary({
      mediaType: 'mixed',
      quality: 0.8,
      selectionLimit: 15,
      includeExtra: true,
    });
    const assets = (res.assets || []).filter(a => !!a.uri);
    if (!assets.length) return;
    
    // Instead of auto-upload, set to state
    setSelectedImages(prev => [...prev, ...assets]);
  }, []);

  const onCameraCaptured = useCallback((asset: Asset) => {
    const uri = String(asset?.uri || '').trim();
    if (!uri) return;

    const inferredVideo = String(asset.type || '').startsWith('video/')
      || Number((asset as any).duration || 0) > 0
      || /\.(mp4|m4v|mov|avi|wmv|webm|mkv|3gp)(?:$|[?#])/i.test(String(asset.fileName || ''));
    const fallbackType = inferredVideo ? 'video/mp4' : 'image/jpeg';
    const fallbackExt = inferredVideo ? 'mp4' : 'jpg';
    const modeTag = inferredVideo ? 'video' : 'photo';
    const normalized: Asset = {
      ...asset,
      uri,
      type: asset.type || fallbackType,
      fileName: asset.fileName || `camera_${modeTag}_${Date.now()}.${fallbackExt}`,
    };

    setSelectedImages(prev => [...prev, normalized]);
  }, []);

  const takePhoto = useCallback(async () => {
    composerInputRef.current?.blur();
    Keyboard.dismiss();
    if (Platform.OS === 'android') await new Promise(r => setTimeout(r, 350));
    setCameraPickerVisible(true);
  }, []);

  // effects
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      initNotifications();
    });
    return () => task.cancel();
  }, []);
  useEffect(() => { fetchMe(); }, [fetchMe]);
  useEffect(() => { if (initialRoom) setCurrentRoom(initialRoom); }, [initialRoom]);

  useEffect(() => {
    const typingSweepTimer = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const copy: Record<string, number> = {};
        Object.entries(prev).forEach(([k, v]) => {
          if (v > now) copy[k] = v;
        });
        return copy;
      });
    }, 800);
    return () => clearInterval(typingSweepTimer);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appState.current = next;
      setIsForeground(next === 'active');
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let mounted = true;
    const roomId = currentRoom?.id;

    (async () => {
      if (!roomId) return;

      // เน€เธเนเธเนเธซเนเธเนเธญเธเธงเธฒเธกเธเธถเนเธเนเธงเธ—เธตเนเธชเธธเธ”ก่อน แล้วค่อยรันงานรอง
      await loadInitial(roomId);
      if (!mounted) return;

      connectSocket(roomId).catch(() => {});

      InteractionManager.runAfterInteractions(() => {
        if (!mounted) return;
        clearUnread(roomId).catch(() => {});
        markRoomReadOnServer(roomId).catch(() => {});
        syncBadgeFromServer().catch(() => {});
        loadPinned(roomId).catch(() => {});
      });
    })();

    return () => {
      mounted = false;
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch { }
        socketRef.current = null;
      }
    };
  }, [currentRoom?.id])  // connectSocket, loadInitial, etc. are now stable via refs/getToken
  // open url
  const openUrl = (url: string) => {
    try {
      const absolute = url.startsWith('http') ? url : `${getBaseUrl()}${url}`;
      Linking.openURL(absolute).catch(() => {});
    } catch {}
  };

  // show popover
  const showPopoverFor = useCallback((key: string, item: ChatMessage) => {
    if (!currentRoom) return;
    const isPinned = pinnedList.some(p => (p.id && p.id === item.id) || (p.localId && p.localId === item.localId));
    setPopover({ visible: true, x: 0, y: 0, w: 0, h: 0, mine: item.user_id === me?.id, target: item, isPinned });
    loadReactionsForMessage(item).catch(() => {});
  }, [currentRoom?.id, pinnedList, me?.id, loadReactionsForMessage]);
  const onMessageLongPress = useCallback((key: string, item: ChatMessage) => {
    suppressPressAfterLongPressRef.current = { key, at: Date.now() };
    showPopoverFor(key, item);
  }, [showPopoverFor]);
  const shouldSkipPressAfterLongPress = useCallback((key: string) => {
    const last = suppressPressAfterLongPressRef.current;
    if (!last) return false;
    return last.key === key && (Date.now() - last.at) < 700;
  }, []);
  const closePopover = useCallback(() => {
    setPopover(POPOVER_CLOSED_STATE);
  }, []);

  /* ===== Render Units (with image grid grouping) ===== */
  const renderUnits = useMemo(() => toRenderUnits(messages, me?.id), [messages, me?.id]);
  const listData = meResolved ? renderUnits : [];

  // สร้าง map จาก message ID โ’ renderUnit index
  const idRenderIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    renderUnits.forEach((unit, i) => {
      if (unit.kind === 'msg') {
        const mid = asNum(unit.msg.id);
        if (mid) map.set(mid, i);
      } else if (unit.kind === 'grid') {
        unit.items.forEach(item => {
          const mid = asNum(item.id);
          if (mid) map.set(mid, i);
        });
      }
    });
    return map;
  }, [renderUnits]);

  const [scrollingToId, setScrollingToId] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const scrollToMessageIndex = useCallback((targetIdx: number, msgId: number) => {
    if (targetIdx < 0 || renderUnits.length === 0) return;
    const safeIdx = Math.min(targetIdx, renderUnits.length - 1);
    setHighlightId(msgId);
    flatRef.current?.scrollToIndex({ index: safeIdx, animated: true, viewPosition: 0.5 });
    setTimeout(() => {
      setHighlightId(prev => (prev === msgId ? null : prev));
    }, 1500);
  }, [renderUnits.length]);

  const tryScrollToMessage = useCallback((msgId: number) => {
    const mapIdx = idRenderIndexMap.get(msgId);
    if (mapIdx == null) return false;
    scrollToMessageIndex(mapIdx, msgId);
    return true;
  }, [idRenderIndexMap, scrollToMessageIndex]);

  useEffect(() => {
    if (!scrollingToId) return;
    if (!tryScrollToMessage(scrollingToId)) return;
    setScrollingToId(null);
  }, [scrollingToId, tryScrollToMessage]);

  const goToMessage = useCallback(async (msgId?: number | null) => {
    const id = asNum(msgId);
    if (!id || !currentRoom) return;

    // เธ–้าอยู่ใน list แล้ว โ’ scroll เน€เธฅเธข
    if (tryScrollToMessage(id)) {
      return;
    }

    // ลอง match แบบ loose (ป้องกัน type mismatch string vs number)
    const looseMatch = messages.findIndex(m => asNum(m.id) === id);
    if (looseMatch >= 0) {
      // เธซเธฒ renderUnit index เธ—เธตเนเธ•รงกับ message นี้
      for (let ui = 0; ui < renderUnits.length; ui++) {
        const u = renderUnits[ui];
        if (u.kind === 'msg' && asNum(u.msg.id) === id) { scrollToMessageIndex(ui, id); return; }
        if (u.kind === 'grid' && u.items.some(x => asNum(x.id) === id)) { scrollToMessageIndex(ui, id); return; }
      }
    }

    // เธ–เนเธฒเธขเธฑเธเนเธกเนเนเธซเธฅเธ” โ’ เนเธซเธฅเธ”เน€เธเธดเนเธกเธเธเธเธงเนเธฒเธเธฐเน€จอ (เธฃเธญเธเธฃเธฑเธเธเนเธญเธเธงเธฒเธกเน€ก่ามาก)
    setScrollingToId(id);
    let attempts = 0;
    const maxAttempts = 80;
    let currentMessages = [...messages];
    let lastBeforeId: number | null = null;

    const getBeforeId = (list: ChatMessage[]) => {
      const ids = list
        .map(m => asNum(m.id))
        .filter((n): n is number => !!n && n > 0);
      if (!ids.length) return null;
      return Math.min(...ids);
    };

    while (attempts < maxAttempts) {
      attempts++;
      const beforeId = getBeforeId(currentMessages);
      if (!beforeId || beforeId === lastBeforeId) break;
      lastBeforeId = beforeId;

      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) break;
        let url = `${getBaseUrl()}/chat/messages?room_id=${currentRoom.id}&limit=${PAGE_SIZE}`;
        url += `&before_id=${beforeId}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        const more: ChatMessage[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);

        if (more.length === 0) {
          setHasMore(false);
          break;
        }

        // เน€เธเธดเนเธกเธเนเธญเธเธงเธฒเธกเนเธซเธกเนเน€ข้า state
        const existingIds = new Set(currentMessages.map(m => asNum(m.id)).filter(Boolean));
        const deduped = more.filter(m => {
          const mid = asNum(m.id);
          return !mid || !existingIds.has(mid);
        });
        if (deduped.length === 0) {
          if (more.length < PAGE_SIZE) setHasMore(false);
          continue;
        }

        currentMessages = [...currentMessages, ...deduped];
        setMessages(currentMessages);

        if (more.length < PAGE_SIZE) setHasMore(false);

        // เน€เธเนเธเธงเนเธฒเน€เธเธญเธเนเธญเธเธงเธฒเธกเน€ป้าหมายยัง
        const found = currentMessages.find(m => asNum(m.id) === id);
        if (found) {
          // ให้ effect เธเธฑเธ”การ scroll เธ”้วย index map เธฅเนเธฒเธชเธธเธ” หลัง FlatList render เน€สร็จ
          return;
        }
      } catch {
        break;
      }
    }

    // Fallback: เธ”เธถเธเธเนเธญเธเธงเธฒเธกเน€เธเนเธฒเธซเธกเธฒเธขเธ”้วย id เนเธ”เธขเธ•เธฃเธเธเธฑเธเธเธฅเธฒเธ”จาก pagination
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const res = await fetch(`${getBaseUrl()}/chat/messages/${id}?room_id=${currentRoom.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const payload = await res.json().catch(() => ({}));
        const foundById: ChatMessage | null = (payload?.data && asNum(payload.data.id) === id)
          ? payload.data
          : ((asNum((payload as any)?.id) === id) ? (payload as ChatMessage) : null);

        if (foundById) {
          setScrollingToId(id);
          setMessages(prev => {
            if (prev.some(m => asNum(m.id) === id)) return prev;
            const next = [...prev];
            const targetId = asNum(foundById.id) || 0;
            let insertAt = next.length;
            for (let i = 0; i < next.length; i++) {
              const currId = asNum(next[i].id) || 0;
              if (currId > 0 && currId < targetId) {
                insertAt = i;
                break;
              }
            }
            next.splice(insertAt, 0, foundById);
            return next;
          });
          return;
        }
      }
    } catch {
      // เน€งียบไว้แล้วไป fallback เน€เธ”เธดเธก
    }

    setScrollingToId(null);
    Platform.OS === 'android'
      ? ToastAndroid.show(t('chatMessageNotFound'), ToastAndroid.SHORT)
      : showAlert(t('chatMessageNotFound'), t('chatMessageTooOld'));
  }, [currentRoom, messages, renderUnits, t, tryScrollToMessage, scrollToMessageIndex]);

  /* ===== Avatar & common small components ===== */
  const Avatar = ({ name }: { name: string }) => (
    <View style={[styles.avatar, { backgroundColor: '#E7EEEA', borderColor: '#9CB8AC' }]}>
      <Text style={{ color: '#4F6F63', fontWeight: '700' }}>{getInitial(name)}</Text>
    </View>
  );

  const renderMessageRow = useCallback(({ msg, idx, showDayHeader }: { msg: ChatMessage; idx: number; showDayHeader: boolean }) => {
    const mine = msg.user_id === me?.id;
    const prev = (idx > 0) ? messagesRef.current[idx - 1] : undefined;
    const next = (idx + 1 < messagesRef.current.length) ? messagesRef.current[idx + 1] : undefined;

    const attachToPrev = !!(prev && isSameSender(prev?.user_id, msg.user_id) && isSameMinute(prev.created_at, msg.created_at));
    const attachToNext = !!(next && isSameSender(next?.user_id, msg.user_id) && isSameMinute(next.created_at, msg.created_at));
    // In inverted list, show sender on the top-most message of a grouped block.
    const showAvatar = !attachToNext;
    const showTimeMeta = !attachToPrev;

    const attachmentKind = getAttachmentKind({
      mimeType: msg.mime_type,
      fileName: msg.file_name,
      fileUrl: msg.file_url,
      text: msg.text,
    });
    const isPdf = attachmentKind === 'pdf';
    const isWord = attachmentKind === 'word';
    const isExcel = attachmentKind === 'excel';
    const isVideo = attachmentKind === 'video';
    const isDocxDocument = isWord && (
      hasDocxSuffix(msg.file_name) || hasDocxSuffix(msg.file_url) || hasDocxSuffix(msg.text)
    );
    const isImage = msg.msg_type === 'image' && !isPdf;
    const isFile = msg.msg_type === 'file' || isPdf;
    const isDocumentCard = isFile && !!msg.file_url;
    const textLink = !isImage && !isFile ? extractFirstLink(msg.text) : '';
    const fileUrl = absoluteUrl(msg.file_url);
    const videoThumbKey = isVideo
      ? buildVideoThumbKey({ id: msg.id, localId: msg.localId, fileUrl })
      : '';
    const videoThumbMeta = videoThumbKey
      ? videoThumbByKeyRef.current[videoThumbKey]
      : undefined;
    const serverVideoThumbUri = isVideo
      ? normalizeImageUri(absoluteUrl(msg.video_thumb_url || ''))
      : '';
    const localVideoThumbUri = videoThumbKey
      ? normalizeImageUri(videoThumbMeta?.uri || '')
      : '';
    const videoThumbUri = serverVideoThumbUri || localVideoThumbUri;
    const videoCardSize = isVideo ? getVideoCardRenderSize(videoThumbMeta) : null;

    const onOpenFile = async () => {
      try {
        if (isPdf) {
          const previewCandidates = buildFileOpenUrlCandidates(fileUrl!);
          const warmupTarget = previewCandidates[0] || fileUrl!;
          setVideoPreview((state) => ({ ...state, visible: false }));
          setPdfPreview({
            visible: true,
            url: warmupTarget,
            name: msg.file_name || t('chatDocument'),
            size: Number.isFinite(Number(msg.file_size)) ? Number(msg.file_size) : null,
            fallbackUrls: previewCandidates.slice(1),
          });
          return;
        }

        if (isVideo) {
          const previewCandidates = buildFileOpenUrlCandidates(fileUrl!);
          const warmupTarget = previewCandidates[0] || fileUrl!;
          const sourceName = decodeDisplayFileName(msg.file_name) || decodeDisplayFileName(msg.text) || t('chatAttachment');
          setPdfPreview((state) => ({ ...state, visible: false }));
          setVideoPreview({
            visible: true,
            url: warmupTarget,
            name: sourceName,
            size: Number.isFinite(Number(msg.file_size)) ? Number(msg.file_size) : null,
            fallbackUrls: previewCandidates.slice(1),
          });
          return;
        }

        if (isDocxDocument) {
          const previewUrl = toDocxPreviewUrl(fileUrl!);
          if (previewUrl) {
            const sourceName = decodeDisplayFileName(msg.file_name) || decodeDisplayFileName(msg.text) || 'document.docx';
            setPdfPreview({
              visible: true,
              url: previewUrl,
              name: sourceName,
              size: null,
              fallbackUrls: [],
            });
            return;
          }
        }

        const displayName = decodeDisplayFileName(msg.file_name) || decodeDisplayFileName(msg.text) || t('chatAttachment');
        await openAttachmentFromUrl(fileUrl!, displayName, msg.mime_type || undefined);
      } catch (e: any) {
        showAlert(t('chatOpenFileFailed'), e?.message || t('chatCannotOpenFile'));
      }
    };

    const onDownloadOriginal = async () => {
      if (!isDocxDocument || !fileUrl) return;

      try {
        const downloadUrl = toOriginalDownloadUrl(fileUrl, msg.file_name || msg.text || 'document.docx');
        if (!downloadUrl) throw new Error('DOWNLOAD_URL_INVALID');

        const displayName = decodeDisplayFileName(msg.file_name) || decodeDisplayFileName(msg.text) || 'document.docx';
        if (Platform.OS === 'android') {
          ToastAndroid.show(t('chatDownloadStarted'), ToastAndroid.SHORT);
        }

        await downloadOriginalAttachment(downloadUrl, displayName, msg.mime_type || undefined);

        if (Platform.OS === 'android') {
          ToastAndroid.show(t('chatDownloadCompleted'), ToastAndroid.SHORT);
        } else {
          showAlert(t('chatSaveSuccess'), t('chatDownloadCompleted'));
        }
      } catch (e: any) {
        showAlert(t('chatDownloadFailed'), e?.message || t('chatTryAgain'));
      }
    };

    const fileTypeTag = isVideo ? 'VIDEO' : (isExcel ? 'XLS' : (isWord ? 'DOC' : (isPdf ? 'PDF' : 'FILE')));
    const documentIconName = isVideo ? 'videocam-outline' : (isExcel ? 'grid-outline' : (isWord ? 'document-text-outline' : (isPdf ? 'document-text' : 'document-outline')));
    const documentIconColor = isVideo ? '#3D6B8A' : (isExcel ? '#3B6D88' : (isWord ? '#5E62A8' : '#4C7F6C'));
    const videoSizeLabel = msg.file_size
      ? (msg.file_size >= 1048576
        ? `${(msg.file_size / 1048576).toFixed(2)} MB`
        : `${(msg.file_size / 1024).toFixed(2)} KB`)
      : '';
    const videoDurationLabel = formatVideoDurationLabel(normalizeDurationSeconds(msg.file_duration));
    const estimatedDurationLabel = formatVideoDurationLabel(estimateVideoDurationSecondsFromSize(msg.file_size));
    const videoOverlayLabel = videoDurationLabel || estimatedDurationLabel || t('chatVideoLabel');

    const radius = {
      borderTopLeftRadius: mine ? 16 : (attachToPrev ? 4 : 16),
      borderTopRightRadius: mine ? (attachToPrev ? 4 : 16) : 16,
      borderBottomLeftRadius: mine ? 16 : (attachToNext ? 4 : 16),
      borderBottomRightRadius: mine ? (attachToNext ? 4 : 16) : 16,
    };

    const key = String(msg.id || msg.localId || idx);
    const hasReply = !!(msg.reply_to || asNum(msg.reply_to_id));
    const repliedId = asNum(msg.reply_to?.id) || asNum(msg.reply_to_id);
    const replySnap = makeReplySnapshot(msg, messagesRef.current, t);
    const senderDisplayName = formatSenderName({
      role: msg.role,
      fullName: msg.full_name,
      username: msg.username,
    });
    const reactionSummary = summarizeReactions(msg.reactions, me?.id);

    const onPressReaction = (emoji: string) => {
      if (!asNum(msg.id)) return;
      reactToMessage(msg, emoji);
    };

    const renderTicks = (s?: MsgStatus) => {
      if (!mine) return null;
      let icon: any = 'checkmark';
      if (s === 'delivered' || s === 'read') icon = 'checkmark-done';
      const color = s === 'read' ? colors.primary : '#94A3B8';
      return <Ionicons name={icon} size={14} color={color} />;
    };

    const isHighlighted = highlightId != null && asNum(msg.id) === highlightId;

    return (
      <View>
        {showDayHeader && (
          <View style={styles.dayRow}>
            <Text style={[styles.dayChip, { backgroundColor: colors.dayChip, color: colors.subtext }]}>
              {formatDayText(msg.created_at)}
            </Text>
          </View>
        )}

        <View style={[
          styles.row,
          { flexDirection: mine ? 'row-reverse' : 'row' },
          isHighlighted && { backgroundColor: 'rgba(79, 143, 119, 0.16)', borderRadius: 12 },
        ]}>
          {!mine ? ((showAvatar)
            ? <Avatar name={msg.full_name || msg.username || ''} />
            : <View style={styles.avatarSpace} />) : null}

          <View
            style={[
              styles.messageContentWrap,
              isFile ? styles.messageContentWrapFile : null,
              {
                alignItems: isFile ? 'stretch' : (mine ? 'flex-end' : 'flex-start'),
                alignSelf: mine ? 'flex-end' : 'flex-start',
              },
            ]}
          >
            {!mine && showAvatar && (
              <Text
                style={[styles.nameText, { color: colors.subtext, marginLeft: 2, marginBottom: 4 }]}
                numberOfLines={1}
              >
                {renderSenderNameWithAdminPrefix(senderDisplayName)}
              </Text>
            )}

            <View
              ref={(el) => { bubbleRefs.current[key] = el; }}
              onStartShouldSetResponder={() => false}
            >
              {isImage && msg.file_url ? (
                <TouchableOpacity
                  onPress={() => {
                    if (shouldSkipPressAfterLongPress(key)) return;
                    openGalleryByUri(msg.file_url!);
                  }}
                  onLongPress={() => onMessageLongPress(key, msg)}
                  delayLongPress={220}
                  activeOpacity={0.9}
                >
                  {hasReply && (
                    <ReplyPill
                      reply={replySnap ?? { reply_to_id: repliedId! } as any}
                      mine={mine}
                      t={t}
                      onPress={() => goToMessage(repliedId)}
                    />
                  )}

                  <View style={styles.imageWrapNoFrame}>
                    <SafeChatImage
                      source={{ uri: fileUrl! }}
                      style={[styles.imageNoFrame, { maxHeight: SCREEN_H * 0.5 }]}
                      resizeMode="cover"
                    />
                  {msg.status === 'sending' ? (
                      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{`${Math.round((msg.upload_progress ?? 0) * 100)}%`}</Text>
                      </View>
                    ) : null}
                  </View>

                  {!!msg.text && (
                    <Text style={[styles.imageCaption, { color: colors.text }]}>{msg.text}</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  activeOpacity={textLink ? 0.82 : 0.9}
                  onPress={isVideo ? undefined : (isDocumentCard ? onOpenFile : (textLink ? async () => {
                    try {
                      await Linking.openURL(textLink);
                    } catch (e: any) {
                      showAlert(t('chatOpenFileFailed'), e?.message || t('chatCannotOpenFile'));
                    }
                  } : undefined))}
                  onLongPress={() => onMessageLongPress(key, msg)}
                  delayLongPress={220}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      isFile ? styles.messageBubbleFile : null,
                      isVideo ? styles.messageBubbleVideo : {
                        ...radius,
                        backgroundColor: mine ? '#E8EEEB' : '#F4F6F5',
                        borderColor: mine ? '#CEDAD5' : '#DEE4E1',
                      },
                    ]}
                  >
                    {hasReply && (
                      <ReplyPill
                        reply={replySnap ?? { reply_to_id: repliedId! } as any}
                        mine={mine}
                        t={t}
                        onPress={() => goToMessage(repliedId)}
                      />
                    )}

                    {isFile && msg.file_url ? (
                      <View style={styles.bubbleWithShareWrap}>
                        {isVideo ? (
                          <View
                            style={[
                              styles.videoPreviewTouch,
                              videoCardSize
                                ? { width: videoCardSize.width, alignSelf: mine ? 'flex-end' : 'flex-start' }
                                : null,
                            ]}
                          >
                            <View style={styles.videoPreviewCard}>
                              <TouchableOpacity
                                onPress={() => {
                                  if (shouldSkipPressAfterLongPress(key)) return;
                                  onOpenFile();
                                }}
                                onLongPress={() => onMessageLongPress(key, msg)}
                                delayLongPress={220}
                                activeOpacity={0.9}
                                style={styles.videoPreviewPressArea}
                              >
                                <View style={[styles.videoPreviewBackdrop, videoCardSize ? { height: videoCardSize.height } : null]}>
                                {videoThumbUri ? (
                                  <Image
                                    source={{ uri: videoThumbUri }}
                                    style={styles.videoPreviewImage}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <View style={styles.videoPreviewFallback}>
                                    <Ionicons name="videocam-outline" size={28} color="#B7CFE0" style={styles.videoPreviewGhostIcon} />
                                  </View>
                                )}

                                <LinearGradient
                                  pointerEvents="none"
                                  colors={['rgba(5, 9, 16, 0.3)', 'rgba(5, 9, 16, 0.04)', 'rgba(5, 9, 16, 0.45)']}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 0, y: 1 }}
                                  style={styles.videoPreviewShade}
                                />

                                <View pointerEvents="none" style={styles.videoPlayButton}>
                                  <Ionicons name="play" size={30} color="#F8FCFF" style={{ marginLeft: 3 }} />
                                </View>

                                <View pointerEvents="none" style={styles.videoDurationChip}>
                                  <Text style={styles.videoDurationChipText}>{videoOverlayLabel}</Text>
                                </View>
                              </View>
                              </TouchableOpacity>

                              {msg.status === 'sending' ? (
                                <View style={styles.videoUploadingBarWrap}>
                                  <View style={styles.videoUploadingBarTrack}>
                                    <View style={[styles.videoUploadingBarFill, { width: `${Math.round((msg.upload_progress ?? 0) * 100)}%` }]} />
                                  </View>
                                  <Text style={styles.videoUploadingText}>{`${Math.round((msg.upload_progress ?? 0) * 100)}%`}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity onPress={onOpenFile} activeOpacity={0.85} style={styles.fileOpenTouch}>
                            <View style={styles.fileCardPdfFull}>
                              <View style={styles.fileIconBadgePdfLarge}>
                                <Ionicons name={documentIconName} size={24} color={documentIconColor} />
                              </View>
                              <View style={styles.fileTextColPdf}>
                                <Text style={styles.fileNameTextPdf} numberOfLines={2}>
                                  {decodeDisplayFileName(msg.file_name) || decodeDisplayFileName(msg.text) || t('chatAttachment')}
                                </Text>
                                <View style={styles.fileMetaLinePdf}>
                                  <View style={styles.fileTypePill}>
                                    <Text style={styles.fileTypePillText}>{fileTypeTag}</Text>
                                  </View>
                                  {!!msg.file_size && (
                                    <Text style={styles.fileSizeTextPdf}>
                                      {msg.file_size >= 1048576
                                        ? `${(msg.file_size / 1048576).toFixed(2)} MB`
                                        : `${(msg.file_size / 1024).toFixed(2)} KB`}
                                    </Text>
                                  )}
                                </View>
                                {msg.status === 'sending' ? (
                                  <View style={{ marginTop: 8 }}>
                                    <View style={{ height: 6, backgroundColor: '#DEE4E1', borderRadius: 4, overflow: 'hidden' }}>
                                      <View style={{ height: '100%', width: `${Math.round((msg.upload_progress ?? 0) * 100)}%`, backgroundColor: '#7FAE9B' }} />
                                    </View>
                                    <Text style={{ marginTop: 4, fontSize: 11, color: '#6A757C' }}>{`${Math.round((msg.upload_progress ?? 0) * 100)}%`}</Text>
                                  </View>
                                ) : null}
                              </View>
                              {isDocxDocument ? (
                                <TouchableOpacity
                                  onPress={onDownloadOriginal}
                                  activeOpacity={0.85}
                                  style={styles.fileDownloadDocxBtn}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <Ionicons name="download-outline" size={18} color="#3F6E5A" />
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <Text style={[styles.messageText, { color: '#24313A' }, textLink ? styles.messageLinkText : null]}>{msg.text}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
            </View>

            {reactionSummary.length > 0 ? (
              <View style={[styles.reactionBadge, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                {reactionSummary.map((reaction) => (
                  <TouchableOpacity
                    key={`${String(msg.id || msg.localId || idx)}_${reaction.emoji}`}
                    activeOpacity={0.85}
                    onPress={() => onPressReaction(reaction.emoji)}
                    style={[styles.reactionChip, reaction.mine ? styles.reactionChipMine : null]}
                  >
                    <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                    {reaction.count > 1 ? <Text style={styles.reactionCount}>{reaction.count}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {showTimeMeta ? (
              <View style={[styles.timeContainer, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                <Text style={styles.timeText}>
                  {(parseServerDateTime(msg.created_at) || new Date(msg.created_at)).toLocaleTimeString('th-TH', {
                    timeZone: 'Asia/Bangkok',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </Text>
                {renderTicks(msg.status)}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }, [colors, me?.id, goToMessage, highlightId, reactToMessage, t, formatDayText, onMessageLongPress, shouldSkipPressAfterLongPress]);

  /* ===== Render: grid block (3 เธเธญเธฅเธฑเธกเธเนเน€มื่อ ≥3 รูป + overlay) ===== */
  const renderGridRow = useCallback((unit: Extract<RenderUnit, { kind: 'grid' }>) => {
    const mine = unit.items[0]?.user_id === me?.id;
    const first = unit.items[0];

    const hasReply = !!(first.reply_to || asNum(first.reply_to_id));
    const repliedId = asNum(first.reply_to?.id) || asNum(first.reply_to_id);
    const replySnap = makeReplySnapshot(first, messagesRef.current, t);
    const caption = first.text || '';
    const avatarName = first.full_name || first.username || '';
    const name = formatSenderName({
      role: first.role,
      fullName: first.full_name,
      username: first.username,
    });

    // เธเธฃเธดเธ”: บังคับ 2 เธเธญเธฅเธฑเธกเธเนเน€เธชเธกเธญ (เธชเธนเธเธชเธธเธ” 2 เนเธ–เธง)
    const CONTAINER_MAX = Math.floor((SCREEN_W - 24) * 0.78); // account for row side padding
    const GAP = 6;
    const count = unit.items.length;
    const COLS = 2;
    const MAX_ROWS = 2;
    const maxTiles = COLS * MAX_ROWS; // 4 tiles
    const overlayMode = count > maxTiles; // เน€ริ่ม overlay เธ•เธฑเนเธเนเธ•เนเธฃเธนเธเธ—ี่ 5
    const toShow = unit.items.slice(0, overlayMode ? maxTiles : Math.min(maxTiles, count));
    const hidden = overlayMode ? (count - maxTiles) : (count - toShow.length);
    const rows = Math.max(1, Math.ceil(toShow.length / COLS));
    const visibleCols = Math.min(COLS, Math.max(1, toShow.length));
    const MAX_GRID_H = SCREEN_H * 0.5;
    const tileSizeByWidth = Math.floor((CONTAINER_MAX - GAP * (COLS - 1)) / COLS);
    const tileSizeByHeight = Math.floor((MAX_GRID_H - GAP * (rows - 1)) / rows);
    const GRID_SCALE = 0.6; // shrink tiles a bit
    const baseTile = Math.min(tileSizeByWidth, tileSizeByHeight);
    const tileW = Math.max(40, Math.floor(baseTile * GRID_SCALE));
    const tileH = tileW;
    const gridWidth = visibleCols * (tileW + GAP);

    const openImg = (m: ChatMessage) => { if (m.file_url) openGalleryByUri(m.file_url); };
    return (
      <View>
        {unit.showDayHeader && (
          <View style={styles.dayRow}>
            <Text style={[styles.dayChip, { backgroundColor: colors.dayChip, color: colors.subtext }]}>
              {formatDayText(unit.created_at)}
            </Text>
          </View>
        )}

        <View style={[styles.row, { flexDirection: mine ? 'row-reverse' : 'row' }]}>
          {!mine ? <Avatar name={avatarName} /> : null}

          <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
            {!mine && (
              <Text style={[styles.nameText, { color: colors.subtext, marginLeft: 2, marginBottom: 4 }]} numberOfLines={1}>
                {renderSenderNameWithAdminPrefix(name)}
              </Text>
            )}

            <View
              style={[
                { padding: 0 },
                { alignSelf: mine ? 'flex-end' : 'flex-start' },
              ]}
            >
              {hasReply && (
                <ReplyPill
                  reply={replySnap ?? ({ reply_to_id: repliedId! } as any)}
                  mine={mine}
                  t={t}
                  onPress={() => goToMessage(repliedId)}
                />
              )}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -GAP / 2, width: gridWidth }}>
                {toShow.map((m, i) => {
                  const uri = m.file_url?.startsWith('http') ? m.file_url! : `${getBaseUrl()}${m.file_url ?? ''}`;
                  const isLastAndHidden = (i === toShow.length - 1) && hidden > 0;
                  const tileKey = `grid_${unit.key}_${m.id || m.localId || i}`;
                  return (
                    <View
                      key={`${unit.key}_${i}`}
                      ref={(el) => { bubbleRefs.current[tileKey] = el; }}
                    >
                      <TouchableOpacity
                        onPress={() => openImg(m)}
                        onLongPress={() => showPopoverFor(tileKey, m)}
                        delayLongPress={220}
                        style={{ padding: GAP / 2 }}
                        activeOpacity={0.9}
                      >
                        <View
                          style={[
                            { width: tileW, height: tileH, borderRadius: 12, overflow: 'hidden', backgroundColor: '#E3E8E6' },
                          ]}
                        >
                          <SafeChatImage source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          {m.status === 'sending' ? (
                            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: '#fff', fontWeight: '800' }}>{`${Math.round((m.upload_progress ?? 0) * 100)}%`}</Text>
                            </View>
                          ) : null}
                          {isLastAndHidden && (
                            <View
                              style={{
                                ...StyleSheet.absoluteFillObject,
                                backgroundColor: 'rgba(0,0,0,0.35)',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{`+${hidden}`}</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>

              {!!caption && (
                <Text style={[styles.imageCaption, { color: '#24313A', marginTop: 8 }]}>{caption}</Text>
              )}
            </View>

            <View style={[
              styles.timeContainer,
              { justifyContent: mine ? 'flex-end' : 'flex-start' },
            ]}>
              <Text style={styles.timeText}>
                {(parseServerDateTime(unit.created_at) || new Date(unit.created_at)).toLocaleTimeString('th-TH', {
                  timeZone: 'Asia/Bangkok',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </Text>
              {mine ? <Ionicons name="checkmark-done" size={14} color={colors.primary} /> : null}
            </View>
          </View>
        </View>
      </View>
    );
  }, [colors, me?.id, goToMessage, showPopoverFor, t, formatDayText]);

  // typing input
  const onChangeText = (nextText: string) => {
    setText(nextText);
    if (!currentRoom) return;
    emitTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 1500);
  };

  const typingText = useMemo(() => {
    const names = Object.keys(typingUsers);
    if (names.length === 0) return '';
    if (names.length === 1) return t('chatTypingOne', { name: names[0] });
    if (names.length === 2) return t('chatTypingTwo', { name1: names[0], name2: names[1] });
    return t('chatTypingMany');
  }, [typingUsers, t]);

  const latestPinned = useMemo(
    () => (pinnedList.length ? sortPinnedListDesc(pinnedList)[0] : null),
    [pinnedList]
  );
  const latestPinnedText = useMemo(() => pinnedPreviewText(latestPinned, t), [latestPinned, t]);

  const renderItem = useCallback(({ item }: { item: RenderUnit }) => {
    try {
      if (item.kind === 'grid') return renderGridRow(item);
      return renderMessageRow({ msg: item.msg, idx: item.idx, showDayHeader: item.showDayHeader });
    } catch (e) {
      // Prevent a single broken message from crashing the entire chat screen
      return <View style={{ padding: 8 }}><Text style={{ color: '#999', fontSize: 12 }}>⚠</Text></View>;
    }
  }, [renderGridRow, renderMessageRow]);
  // ====== Gallery state ======
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryImages, setGalleryImages] = useState<{ uri: string }[]>([]);
  const [pdfPreview, setPdfPreview] = useState<{ visible: boolean; url: string; name: string; size: number | null; fallbackUrls: string[] }>({
    visible: false,
    url: '',
    name: '',
    size: null,
    fallbackUrls: [],
  });
  const [videoPreview, setVideoPreview] = useState<{ visible: boolean; url: string; name: string; size: number | null; fallbackUrls: string[] }>({
    visible: false,
    url: '',
    name: '',
    size: null,
    fallbackUrls: [],
  });
  const [videoThumbByKey, setVideoThumbByKey] = useState<Record<string, VideoThumbMeta>>({});
  const videoThumbByKeyRef = useRef<Record<string, VideoThumbMeta>>({});
  const videoThumbPendingRef = useRef<Set<string>>(new Set());
  const videoThumbRetryAtRef = useRef<Map<string, number>>(new Map());
  const videoThumbServerPendingRef = useRef<Set<number>>(new Set());
  const videoThumbServerRetryAtRef = useRef<Map<number, number>>(new Map());
  const createVideoThumbnailFnRef = useRef<CreateVideoThumbnailFn | null | undefined>(undefined);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  useEffect(() => {
    videoThumbByKeyRef.current = videoThumbByKey;
  }, [videoThumbByKey]);

  const closePdfPreview = useCallback(() => {
    setPdfPreview(prev => ({ ...prev, visible: false }));
  }, []);

  const openPdfPreviewExternal = useCallback(async () => {
    if (!pdfPreview.url) return;
    const candidates = Array.from(new Set([
      ...buildFileOpenUrlCandidates(pdfPreview.url),
      ...pdfPreview.fallbackUrls,
    ].filter(Boolean)));

    for (const targetUrl of candidates) {
      try {
        await openPdfFromUrl(targetUrl, pdfPreview.name || t('chatDocument'));
        return;
      } catch {
        // try next candidate
      }
    }

    for (const targetUrl of candidates) {
      try {
        await Linking.openURL(encodeURI(targetUrl));
        return;
      } catch {
        // try next candidate
      }
    }

    showAlert(t('chatOpenFileFailed'), t('chatCannotOpenFile'));
  }, [pdfPreview.url, pdfPreview.name, pdfPreview.fallbackUrls, t]);

  const openPdfPreviewInBrowser = useCallback(async () => {
    if (!pdfPreview.url) return;
    const baseCandidates = Array.from(new Set([
      ...buildFileOpenUrlCandidates(pdfPreview.url),
      ...pdfPreview.fallbackUrls,
    ].filter(Boolean)));
    const browserCandidates = Array.from(new Set([
      ...baseCandidates.map((value) => toPdfBrowserViewerUrl(value)),
      ...baseCandidates,
    ].filter(Boolean)));

    for (const targetUrl of browserCandidates) {
      try {
        await Linking.openURL(encodeURI(targetUrl));
        return;
      } catch {
        // try next candidate
      }
    }

    showAlert(t('chatOpenFileFailed'), t('chatCannotOpenFile'));
  }, [pdfPreview.url, pdfPreview.fallbackUrls, t]);

  const sharePdfPreview = useCallback(async () => {
    if (!pdfPreview.url) return;
    try {
      const message = pdfPreview.name
        ? `${pdfPreview.name}\n${pdfPreview.url}`
        : pdfPreview.url;
      await Share.share({ message });
    } catch {
      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatShareFailed'), ToastAndroid.SHORT)
        : showAlert(t('chatShareFailed'));
    }
  }, [pdfPreview.url, pdfPreview.name, t]);

  const closeVideoPreview = useCallback(() => {
    setVideoPreview(prev => ({ ...prev, visible: false }));
  }, []);

  const downloadVideoPreview = useCallback(async () => {
    if (!videoPreview.url) return;
    const candidates = Array.from(new Set([
      ...buildFileOpenUrlCandidates(videoPreview.url),
      ...videoPreview.fallbackUrls,
    ].filter(Boolean)));

    const preferredName = decodeDisplayFileName(videoPreview.name) || 'video.mp4';

    for (const targetUrl of candidates) {
      try {
        const downloadUrl = toOriginalDownloadUrl(targetUrl, preferredName) || targetUrl;
        if (Platform.OS === 'android') {
          ToastAndroid.show(t('chatDownloadStarted'), ToastAndroid.SHORT);
        }
        await downloadOriginalAttachment(downloadUrl, preferredName, 'video/mp4');

        if (Platform.OS === 'android') {
          ToastAndroid.show(t('chatDownloadCompleted'), ToastAndroid.SHORT);
        } else {
          showAlert(t('chatSaveSuccess'), t('chatDownloadCompleted'));
        }
        return;
      } catch {
        // try next candidate
      }
    }

    showAlert(t('chatDownloadFailed'), t('chatTryAgain'));
  }, [videoPreview.url, videoPreview.name, videoPreview.fallbackUrls, t]);

  const shareVideoPreview = useCallback(async () => {
    if (!videoPreview.url) return;
    try {
      const message = videoPreview.name
        ? `${videoPreview.name}\n${videoPreview.url}`
        : videoPreview.url;
      await Share.share({ message });
    } catch {
      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatShareFailed'), ToastAndroid.SHORT)
        : showAlert(t('chatShareFailed'));
    }
  }, [videoPreview.url, videoPreview.name, t]);

  // Keep stable refs to avoid re-renders causing flicker
  const galleryImagesRef = useRef<{ uri: string }[]>([]);
  const galleryIndexRef = useRef(0);
  useEffect(() => { galleryImagesRef.current = galleryImages; }, [galleryImages]);
  useEffect(() => { galleryIndexRef.current = galleryIndex; }, [galleryIndex]);

  // Caching helpers for gallery images (defined before any usage)
  const prefetchMemo = useRef(new Set<string>());
  const imgCache = useRef<Map<string, string>>(new Map()); // remote -> local file:// path
  const pdfPrefetchMemo = useRef(new Set<string>());
  const PDF_PREFETCH_LIMIT = 24;
  const DOC_PREVIEW_PREFETCH_LIMIT = 4;
  const PDF_PREFETCH_PRIORITY_COUNT = 4;
  const PDF_PREFETCH_MAX_BYTES = 40 * 1024 * 1024;
  const PDF_PREFETCH_RETRY_INTERVAL_MS = 2500;
  const PDF_PREFETCH_RETRY_ROUNDS = 8;

  const cachePathFor = useCallback((absUri: string) => {
    const safe = absUri.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `${RNFS.CachesDirectoryPath}/iv_${safe}`;
  }, []);

  const pdfCachePathFor = useCallback((remoteUrl: string) => {
    const safe = String(remoteUrl || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    return `${RNFS.CachesDirectoryPath}/pdf_preview_${safe}.pdf`;
  }, []);

  const setVideoThumbnail = useCallback((key: string, meta: VideoThumbMeta) => {
    if (!key || !meta?.uri) return;
    setVideoThumbByKey((prev) => {
      const current = prev[key];
      if (
        current
        && current.uri === meta.uri
        && current.width === meta.width
        && current.height === meta.height
      ) {
        return prev;
      }
      const next = { ...prev, [key]: meta };
      videoThumbByKeyRef.current = next;
      return next;
    });
  }, []);

  const getCreateVideoThumbnailFn = useCallback(() => {
    if (createVideoThumbnailFnRef.current !== undefined) {
      return createVideoThumbnailFnRef.current;
    }
    const resolved = resolveCreateVideoThumbnailFn();
    createVideoThumbnailFnRef.current = resolved;
    return resolved;
  }, []);

  const ensureVideoThumbnail = useCallback(async (key: string, rawUri: string) => {
    const abs = absoluteUrl(rawUri);
    if (!key || !abs) return;
    if (videoThumbByKeyRef.current[key]) return;
    if (videoThumbPendingRef.current.has(key)) return;

    const retryAt = videoThumbRetryAtRef.current.get(key) || 0;
    if (retryAt > Date.now()) return;

    const createVideoThumbnailFn = getCreateVideoThumbnailFn();
    if (!createVideoThumbnailFn) return;

    const createThumbFromSource = async (source: string) => {
      const thumb = await createVideoThumbnailFn({
        url: source,
        timeStamp: 800,
        format: 'jpeg',
        dirSize: 60,
        maxWidth: 720,
      });

      const thumbUri = normalizeImageUri(thumb?.path || '');
      if (!thumbUri) return false;

      const thumbWidth = Number(thumb?.width || 0);
      const thumbHeight = Number(thumb?.height || 0);
      const aspectRatio = (thumbWidth > 0 && thumbHeight > 0)
        ? (thumbWidth / thumbHeight)
        : 0;

      setVideoThumbnail(key, {
        uri: thumbUri,
        width: Number.isFinite(thumbWidth) ? thumbWidth : 0,
        height: Number.isFinite(thumbHeight) ? thumbHeight : 0,
        aspectRatio: Number.isFinite(aspectRatio) ? aspectRatio : 0,
      });
      return true;
    };

    const remoteCandidates = Array.from(new Set([
      abs,
      encodeURI(abs),
    ].filter(Boolean)));

    videoThumbPendingRef.current.add(key);
    try {
      for (const candidate of remoteCandidates) {
        try {
          const ok = await createThumbFromSource(candidate);
          if (ok) {
            videoThumbRetryAtRef.current.delete(key);
            return;
          }
        } catch {
          // try next source candidate
        }
      }

      if (abs.startsWith('http')) {
        const extMatch = decodeDisplayFileName(abs).match(/\.(mp4|m4v|mov|avi|wmv|webm|mkv|3gp)(?:$|[?#])/i);
        const ext = extMatch ? `.${String(extMatch[1]).toLowerCase()}` : '.mp4';
        const localVideoPath = `${cachePathFor(abs)}_vthumb${ext}`;

        for (const candidate of remoteCandidates) {
          try {
            const exists = await RNFS.exists(localVideoPath);
            if (exists) {
              const st = await RNFS.stat(localVideoPath);
              if (Number(st?.size || 0) <= 0) {
                await RNFS.unlink(localVideoPath).catch(() => {});
              }
            }

            const stillExists = await RNFS.exists(localVideoPath);
            if (!stillExists) {
              const dl = RNFS.downloadFile({
                fromUrl: candidate,
                toFile: localVideoPath,
                background: false,
                discretionary: false,
                cacheable: true,
              });
              const { statusCode } = await dl.promise;
              if (!statusCode || statusCode < 200 || statusCode >= 300) {
                await RNFS.unlink(localVideoPath).catch(() => {});
                continue;
              }
            }

            const localCandidates = [`file://${localVideoPath}`, localVideoPath];
            for (const localSource of localCandidates) {
              try {
                const ok = await createThumbFromSource(localSource);
                if (ok) {
                  videoThumbRetryAtRef.current.delete(key);
                  return;
                }
              } catch {
                // try next local source
              }
            }
          } catch {
            await RNFS.unlink(localVideoPath).catch(() => {});
          }
        }
      }

      videoThumbRetryAtRef.current.set(key, Date.now() + VIDEO_THUMB_RETRY_DELAY_MS);
    } catch {
      videoThumbRetryAtRef.current.set(key, Date.now() + VIDEO_THUMB_RETRY_DELAY_MS);
    } finally {
      videoThumbPendingRef.current.delete(key);
    }
  }, [setVideoThumbnail, getCreateVideoThumbnailFn, cachePathFor]);

  const syncVideoThumbFromServer = useCallback(async (messageId: number, roomId: number) => {
    if (!messageId || !roomId) return false;

    if (videoThumbServerPendingRef.current.has(messageId)) return false;

    const retryAt = videoThumbServerRetryAtRef.current.get(messageId) || 0;
    if (retryAt > Date.now()) return false;

    videoThumbServerPendingRef.current.add(messageId);
    try {
      const token = await getToken();
      if (!token) return false;

      const res = await fetch(`${getBaseUrl()}/chat/messages/${messageId}?room_id=${roomId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'VIDEO_THUMB_REFRESH_FAILED');

      const serverThumbUrl = String(payload?.data?.video_thumb_url || '').trim();
      if (!serverThumbUrl) {
        videoThumbServerRetryAtRef.current.set(messageId, Date.now() + VIDEO_THUMB_SERVER_SYNC_RETRY_DELAY_MS);
        return false;
      }

      videoThumbServerRetryAtRef.current.delete(messageId);
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          const mid = asNum(m.id);
          if (!mid || mid !== messageId) return m;
          if (String(m.video_thumb_url || '') === serverThumbUrl) return m;
          changed = true;
          return { ...m, video_thumb_url: serverThumbUrl };
        });
        return changed ? next : prev;
      });

      return true;
    } catch {
      videoThumbServerRetryAtRef.current.set(messageId, Date.now() + VIDEO_THUMB_SERVER_SYNC_RETRY_DELAY_MS);
      return false;
    } finally {
      videoThumbServerPendingRef.current.delete(messageId);
    }
  }, [getToken]);

  const ensurePdfCached = useCallback(async (rawUri: string) => {
    const abs = absoluteUrl(rawUri);
    if (!abs.startsWith('http')) return;
    if (pdfPrefetchMemo.current.has(abs)) return;
    pdfPrefetchMemo.current.add(abs);

    let cachedSuccessfully = false;

    const candidates = (() => {
      const encoded = encodeURI(abs);
      if (encoded && encoded !== abs) return [abs, encoded];
      return [abs];
    })();

    for (const candidate of candidates) {
      const localPath = pdfCachePathFor(candidate);
      const tempPath = `${localPath}.part`;

      try {
        const exists = await RNFS.exists(localPath);
        if (exists) {
          const st = await RNFS.stat(localPath);
          if (Number(st?.size || 0) > 0) return;
          await RNFS.unlink(localPath).catch(() => {});
        }

        await RNFS.unlink(tempPath).catch(() => {});
        const task = RNFS.downloadFile({
          fromUrl: candidate,
          toFile: tempPath,
          background: false,
          discretionary: false,
          cacheable: true,
        });

        const res = await task.promise;
        if (!res.statusCode || res.statusCode >= 400) throw new Error('PREFETCH_DOWNLOAD_FAILED');

        const tempStat = await RNFS.stat(tempPath);
        if (Number(tempStat?.size || 0) <= 0) throw new Error('PREFETCH_EMPTY_FILE');

        await RNFS.unlink(localPath).catch(() => {});
        await RNFS.moveFile(tempPath, localPath);
        cachedSuccessfully = true;
        return;
      } catch {
        await RNFS.unlink(tempPath).catch(() => {});
      }
    }

    if (!cachedSuccessfully) {
      // Allow retry on next prefetch cycle when network/server is temporarily slow.
      pdfPrefetchMemo.current.delete(abs);
    }
  }, [pdfCachePathFor]);

  const ensureCached = useCallback(async (rawUri: string) => {
    const abs = absoluteUrl(rawUri);
    if (!abs.startsWith('http')) return null;
    if (imgCache.current.has(abs)) return imgCache.current.get(abs)!;

    const dest = cachePathFor(abs);
    const exists = await RNFS.exists(dest);
    if (exists) {
      const fileUri = `file://${dest}`;
      imgCache.current.set(abs, fileUri);
      return fileUri;
    }
    if (prefetchMemo.current.has(`dl:${abs}`)) return null;
    prefetchMemo.current.add(`dl:${abs}`);
    try {
      const dl = RNFS.downloadFile({ fromUrl: abs, toFile: dest });
      const { statusCode } = await dl.promise;
      if (statusCode >= 200 && statusCode < 300) {
        const fileUri = `file://${dest}`;
        imgCache.current.set(abs, fileUri);
        return fileUri;
      }
    } catch {}
    return null;
  }, [cachePathFor]);

  const toCachedUri = useCallback((rawUri: string) => {
    const abs = absoluteUrl(rawUri);
    return imgCache.current.get(abs) || abs;
  }, []);

  // Concurrency-limited prefetch (load up to 6 images at once)
  const PREFETCH_CONCURRENCY = 6;
  const prefetchHighQueueRef = useRef<string[]>([]);
  const prefetchLowQueueRef = useRef<string[]>([]);
  const prefetchQueuedRef = useRef<Set<string>>(new Set());
  const prefetchActiveRef = useRef(0);

  const processPrefetchQueue = useCallback(() => {
    while (
      prefetchActiveRef.current < PREFETCH_CONCURRENCY &&
      (prefetchHighQueueRef.current.length > 0 || prefetchLowQueueRef.current.length > 0)
    ) {
      const uri = prefetchHighQueueRef.current.shift() ?? prefetchLowQueueRef.current.shift();
      if (!uri) break;
      prefetchQueuedRef.current.delete(uri);
      prefetchActiveRef.current += 1;
      (async () => {
        try {
          await ensureCached(uri);
          const cached = toCachedUri(uri);
          await Image.prefetch(cached).catch(() => {});
          Image.getSize(cached, () => {}, () => {});
        } finally {
          prefetchActiveRef.current -= 1;
          setTimeout(() => processPrefetchQueue(), 0);
        }
      })();
    }
  }, [ensureCached, toCachedUri]);

  const schedulePrefetch = useCallback((input: string | Array<string | undefined | null>, priority: 'high' | 'low' = 'low') => {
    const list = Array.isArray(input) ? input : [input];
    for (const raw of list) {
      if (!raw) continue;
      const abs = absoluteUrl(raw);
      if (!abs) continue;
      // avoid queueing cached images
      if (imgCache.current.has(abs)) continue;
      // Promote to high or enqueue if not queued
      if (prefetchQueuedRef.current.has(abs)) {
        // remove from both queues and reinsert if high
        const removeFrom = (arr: string[]) => {
          const idx = arr.indexOf(abs);
          if (idx >= 0) arr.splice(idx, 1);
        };
        removeFrom(prefetchLowQueueRef.current);
        if (priority === 'high') {
          removeFrom(prefetchHighQueueRef.current);
          prefetchHighQueueRef.current.unshift(abs);
        } else {
          prefetchLowQueueRef.current.push(abs);
        }
      } else {
        prefetchQueuedRef.current.add(abs);
        if (priority === 'high') prefetchHighQueueRef.current.unshift(abs);
        else prefetchLowQueueRef.current.push(abs);
      }
    }
    processPrefetchQueue();
  }, [processPrefetchQueue]);

  useEffect(() => {
    const pdfTargets: string[] = [];
    const docPreviewTargets: string[] = [];
    const seen = new Set<string>();

    for (const m of messages) {
      if (!m.file_url) continue;

      const size = Number(m.file_size || 0);
      if (Number.isFinite(size) && size > 0 && size > PDF_PREFETCH_MAX_BYTES) {
        continue;
      }

      const attachmentKind = getAttachmentKind({
        mimeType: m.mime_type,
        fileName: m.file_name,
        fileUrl: m.file_url,
        text: m.text,
      });

      const directPdf = attachmentKind === 'pdf'
        ? (buildFileOpenUrlCandidates(String(m.file_url || ''))[0] || '')
        : '';
      const docxPreview = (attachmentKind === 'word' && hasDocxSuffix(m.file_name || m.file_url || m.text))
        ? toDocxPreviewUrl(m.file_url)
        : '';

      const target = directPdf || docxPreview;
      if (!target || seen.has(target)) continue;

      seen.add(target);
      if (directPdf) {
        pdfTargets.push(target);
      } else {
        docPreviewTargets.push(target);
      }

      if ((pdfTargets.length + docPreviewTargets.length) >= PDF_PREFETCH_LIMIT) break;
    }

    const targets = [
      ...pdfTargets,
      ...docPreviewTargets.slice(0, DOC_PREVIEW_PREFETCH_LIMIT),
    ].slice(0, PDF_PREFETCH_LIMIT);

    if (!targets.length) return;

    const priorityTargets = targets.slice(0, PDF_PREFETCH_PRIORITY_COUNT);
    const backgroundTargets = targets.slice(PDF_PREFETCH_PRIORITY_COUNT);
    const retryTargets = targets.slice(0, Math.min(Math.max(PDF_PREFETCH_PRIORITY_COUNT * 2, 6), targets.length));
    let cancelled = false;
    let backgroundStarted = false;
    let retryRunning = false;
    let retryRound = 0;

    const prefetchList = async (list: string[], delayMs: number) => {
      for (const fileUrl of list) {
        if (cancelled) return;
        await ensurePdfCached(fileUrl);
        if (cancelled || delayMs <= 0) continue;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    };

    prefetchList(priorityTargets, 0).catch(() => {});

    const startBackgroundPrefetch = () => {
      if (backgroundStarted) return;
      backgroundStarted = true;
      prefetchList(backgroundTargets, 40).catch(() => {});
    };

    const runRetryRound = async () => {
      if (cancelled || retryRunning || !retryTargets.length) return;
      retryRunning = true;
      try {
        await prefetchList(retryTargets, 0);
      } finally {
        retryRunning = false;
      }
    };

    // Start soon so first open is stable, but keep an interaction-based fallback.
    const immediateTimer = setTimeout(startBackgroundPrefetch, 120);
    const retryKickoffTimer = setTimeout(() => {
      runRetryRound().catch(() => {});
    }, 900);
    const retryTimer = setInterval(() => {
      if (cancelled) return;
      retryRound += 1;
      if (retryRound > PDF_PREFETCH_RETRY_ROUNDS) {
        clearInterval(retryTimer);
        return;
      }
      runRetryRound().catch(() => {});
    }, PDF_PREFETCH_RETRY_INTERVAL_MS);

    const task = InteractionManager.runAfterInteractions(() => {
      startBackgroundPrefetch();
    });

    return () => {
      cancelled = true;
      clearTimeout(immediateTimer);
      clearTimeout(retryKickoffTimer);
      clearInterval(retryTimer);
      task.cancel();
    };
  }, [
    currentRoom?.id,
    messages,
    ensurePdfCached,
  ]);

  useEffect(() => {
    videoThumbServerPendingRef.current.clear();
    videoThumbServerRetryAtRef.current.clear();
  }, [currentRoom?.id]);

  // Debounced video thumbnail prefetch — only runs 500ms after messages stop changing
  const videoThumbDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const roomId = Number(currentRoom?.id || 0);
    if (!roomId) return;

    // Clear any pending debounce
    if (videoThumbDebounceRef.current) {
      clearTimeout(videoThumbDebounceRef.current);
      videoThumbDebounceRef.current = null;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

    videoThumbDebounceRef.current = setTimeout(() => {
      if (cancelled) return;

      const serverTargets: Array<{ messageId: number; key: string; source: string }> = [];
      const localTargets: Array<{ key: string; source: string }> = [];
      const seenServer = new Set<number>();
      const seenLocal = new Set<string>();

      for (const m of messages) {
        if (!m.file_url) continue;

        const attachmentKind = getAttachmentKind({
          mimeType: m.mime_type,
          fileName: m.file_name,
          fileUrl: m.file_url,
          text: m.text,
        });
        if (attachmentKind !== 'video') continue;
        if (m.video_thumb_url) continue;

        const source = absoluteUrl(m.file_url);
        if (!source) continue;

        const key = buildVideoThumbKey({
          id: m.id,
          localId: m.localId,
          fileUrl: source,
        });
        if (!key) continue;

        const persistedId = asNum(m.id);
        if (persistedId && persistedId > 0) {
          if (!seenServer.has(persistedId)) {
            seenServer.add(persistedId);
            if (serverTargets.length < 28) {
              serverTargets.push({ messageId: persistedId, key, source });
            }
          }
          continue;
        }

        // Keep local thumbnail generation only for optimistic/local messages.
        if (!key || seenLocal.has(key)) continue;

        seenLocal.add(key);
        localTargets.push({ key, source });
        if (localTargets.length >= 24) continue;
      }

      if (!serverTargets.length && !localTargets.length) return;

      const runPass = async () => {
        for (const target of serverTargets) {
          if (cancelled) return;
          const synced = await syncVideoThumbFromServer(target.messageId, roomId);
          if (synced) continue;
          if (videoThumbByKeyRef.current[target.key]) continue;
          await ensureVideoThumbnail(target.key, target.source);
        }

        for (const target of localTargets) {
          if (cancelled) return;
          if (videoThumbByKeyRef.current[target.key]) continue;
          await ensureVideoThumbnail(target.key, target.source);
        }
      };

      interactionTask = InteractionManager.runAfterInteractions(() => {
        runPass().catch(() => {});
      });

      const maxRetryRounds = Math.max(
        localTargets.length ? VIDEO_THUMB_PREFETCH_RETRY_ROUNDS : 0,
        serverTargets.length ? VIDEO_THUMB_SERVER_PREFETCH_RETRY_ROUNDS : 0,
      );
      const retryDelayMs = Math.max(VIDEO_THUMB_RETRY_DELAY_MS, VIDEO_THUMB_SERVER_SYNC_RETRY_DELAY_MS);

      let retryRound = 0;
      retryTimer = setInterval(() => {
        if (cancelled) return;
        retryRound += 1;
        if (retryRound > maxRetryRounds) {
          if (retryTimer) clearInterval(retryTimer);
          return;
        }
        runPass().catch(() => {});
      }, retryDelayMs);
    }, 500); // 500ms debounce

    return () => {
      cancelled = true;
      if (videoThumbDebounceRef.current) {
        clearTimeout(videoThumbDebounceRef.current);
        videoThumbDebounceRef.current = null;
      }
      if (retryTimer) clearInterval(retryTimer);
      if (interactionTask) interactionTask.cancel();
    };
  }, [currentRoom?.id, messages, ensureVideoThumbnail, syncVideoThumbFromServer]);

  // เธฃเธงเธกเธฃเธนเธเธ—เธฑเนเธเธซเธกเธ”ในห้อง (เธ•เธฒเธกเธฅเธณเธ”เธฑเธเน€เธงเธฅเธฒ)
  const buildAllImages = useCallback(() => {
    return messages
      .filter(m => m.msg_type === 'image' && m.file_url)
      .map(m => ({ uri: absoluteUrl(m.file_url!) }));
  }, [messages]);

  // เน€เธเธดเธ”เนเธเธฅเน€เธฅเธญเธฃเธตเนเนเธ”เธขเน€เธฃเธดเนเธกเธ—เธตเนเธฃเธนเธเธ—เธตเนเธ–เธนเธเนเธ•เธฐ
  const openGalleryByUri = useCallback(async (uri: string) => {
    const all = buildAllImages();
    const abs = absoluteUrl(uri);
    const idx = Math.max(0, all.findIndex(i => i.uri === abs));
    setGalleryImages(all);
    galleryIndexRef.current = idx < 0 ? 0 : idx;
    setGalleryIndex(idx < 0 ? 0 : idx);
    setGalleryVisible(true);
    // Try load current image asap
    try {
      await ensureCached(abs);
      await Image.prefetch(toCachedUri(abs));
    } catch {}
    // Queue prefetch for the rest (concurrency-limited)
    schedulePrefetch(all.map(i => i.uri), 'low');
  }, [buildAllImages, ensureCached, toCachedUri, schedulePrefetch]);

  // เธเธญเธชเธดเธ—เธเธดเนเน€ขียนรูป (Android)
  async function ensurePhotoPermission() {
    if (Platform.OS !== 'android') return true;
    // Android 13+ ใช้ READ_MEDIA_IMAGES, เธ•่ำกว่านั้นใช้ WRITE_EXTERNAL_STORAGE
    const sdk = Number(Platform.Version) || 33;
    const perm = sdk >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

    const has = await PermissionsAndroid.check(perm);
    if (has) return true;

    const res = await PermissionsAndroid.request(perm);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  }

  // เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธฃเธนเธเธ—เธตเนเธ”ูอยู่ลง Photos
  const onDownloadCurrent = useCallback(async () => {
    try {
      const imgs = galleryImagesRef.current;
      const idx = galleryIndexRef.current;
      if (!imgs.length) return;
      const currentUri = imgs[idx]?.uri;
      if (!currentUri) return;

      if (Platform.OS === 'android') {
        const ok = await ensurePhotoPermission();
        if (!ok) {
          showAlert(t('chatCannotSave'), t('chatNoGalleryPermission'));
          return;
        }
      }

      const filename = `chat_${Date.now()}.jpg`;
      const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;
      const dl = RNFS.downloadFile({ fromUrl: currentUri, toFile: tmpPath });
      const { statusCode } = await dl.promise;

      if (statusCode < 200 || statusCode >= 300) throw new Error(t('chatDownloadFailed'));

      await CameraRoll.save(tmpPath, { type: 'photo' });

      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatSavedImage'), ToastAndroid.SHORT)
        : showAlert(t('chatSaveSuccess'), t('chatImageSavedInPhotos'));
    } catch (e: any) {
      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatSaveFailed'), ToastAndroid.SHORT)
        : showAlert(t('chatSaveFailed'), e?.message || t('chatTryAgain'));
    }
  }, [t]);

  // เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธ—เธธเธเธ เธฒเธเนเธเนเธเธฅเน€ลอรี่ลง Photos (เธชเธฃเนเธฒเธเธญเธฑเธฅเธเธฑเนเธกเธ•เธฒเธกเธเธทเนเธญเธซเนเธญเธเธ–้ามี)
  const onDownloadAll = useCallback(async () => {
    try {
      const imgs = galleryImagesRef.current;
      if (!imgs.length) return;

      if (Platform.OS === 'android') {
        const ok = await ensurePhotoPermission();
        if (!ok) {
          showAlert(t('chatCannotSave'), t('chatNoGalleryPermission'));
          return;
        }
      }

      // unique เธ•เธฒเธก uri เน€เธเธทเนเธญเนเธกเนเธเธฑเธเธ—ึกซ้ำ
      const uniq = Array.from(new Set(imgs.map(i => i?.uri).filter(Boolean) as string[]));
      const album = currentRoom?.name || 'Chat';

      setBulkSaving(true);
      setBulkProgress({ done: 0, total: uniq.length });

      for (let i = 0; i < uniq.length; i++) {
        const src = uniq[i];
        try {
          if (src.startsWith('file://')) {
            await CameraRoll.save(src, { type: 'photo', album });
          } else {
            const filename = `chat_${Date.now()}_${i}.jpg`;
            const tmpPath = `${RNFS.CachesDirectoryPath}/${filename}`;
            const dl = RNFS.downloadFile({ fromUrl: src, toFile: tmpPath });
            const { statusCode } = await dl.promise;
            if (statusCode >= 200 && statusCode < 300) {
              await CameraRoll.save(tmpPath, { type: 'photo', album });
            }
          }
        } catch {}
        setBulkProgress({ done: i + 1, total: uniq.length });
        // yield UI
        await new Promise(r => setTimeout(r, 0));
      }

      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatSavedAllImages'), ToastAndroid.SHORT)
        : showAlert(t('chatSaveSuccess'), t('chatSavedAllImages'));
    } catch (e: any) {
      Platform.OS === 'android'
        ? ToastAndroid.show(t('chatSaveFailed'), ToastAndroid.SHORT)
        : showAlert(t('chatSaveFailed'), e?.message || t('chatTryAgain'));
    } finally {
      setBulkSaving(false);
    }
  }, [currentRoom?.name, t]);

  // Prefetch nearby images when gallery opens or index changes
  const prefetchAround = useCallback((center: number) => {
    const imgs = galleryImagesRef.current;
    if (!imgs.length) return;
    const AHEAD = 3;
    const BEHIND = 2;
    const start = Math.max(0, center - BEHIND);
    const end = Math.min(imgs.length - 1, center + AHEAD);
    const targets = [] as string[];
    for (let i = start; i <= end; i++) {
      const uri = imgs[i]?.uri;
      if (uri) targets.push(uri);
    }
    schedulePrefetch(targets, 'high');
  }, [schedulePrefetch]);

  useEffect(() => {
    if (!galleryVisible) return;
    // Delay prefetch to prevent open animation jank
    const prefetchTimer = setTimeout(() => {
      // Prefetch all images gradually with concurrency limit
      schedulePrefetch(galleryImagesRef.current.map(i => i.uri), 'low');
      // Also ensure nearby are prioritized
      prefetchAround(galleryIndexRef.current);
    }, 500);
    return () => clearTimeout(prefetchTimer);
  }, [galleryVisible, prefetchAround, schedulePrefetch]);

  const closeGallery = useCallback(() => setGalleryVisible(false), []);
  const onImageIndexChangeStable = useCallback((i: number) => {
    galleryIndexRef.current = i;

    prefetchAround(i);

    // Prefetch around current image without toggling React state (avoid viewer flicker)
    const imgs = galleryImagesRef.current;
    const uri = imgs[i]?.uri;

    if (uri) {
      (async () => {
        try {
          await ensureCached(uri);
          await Image.prefetch(toCachedUri(uri));
        } catch {}
      })();
    }
  }, [prefetchAround, ensureCached, toCachedUri]);
  // Pre-calculate images to show (stable unless galleryImages changes)
  const galleryItems = useMemo(() => {
    return galleryImages.map(({ uri }) => ({ uri: toCachedUri(uri) }));
  }, [galleryImages, toCachedUri]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.headBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
        ) : <View style={styles.headBtn} />}

        <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
        <Text style={[styles.headTitle, { color: colors.text }]} numberOfLines={1}>
          {currentRoom?.name || t('titleChat')}
        </Text>
        <View style={styles.headBtn} />
      </View>

      {/* pinned list */}
      {pinnedList.length > 0 && (
        <TouchableOpacity
          style={[styles.pinnedBar, { borderBottomColor: colors.border, backgroundColor: colors.cardBg }]}
          activeOpacity={0.88}
          onPress={() => setPinnedOpen(true)}
        >
          <Ionicons name="pin" size={16} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
              {latestPinnedText}
            </Text>
          </View>
          <Text style={{ color: colors.subtext, fontSize: 11, fontWeight: '600', marginRight: 6 }}>
            ({pinnedList.length})
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </TouchableOpacity>
      )}

      {/* typing indicator */}
      {!!typingText && (
        <View style={[styles.typingBar, { backgroundColor: '#FFFFFF', borderBottomColor: colors.border }]}>
          <Text style={{ color: colors.subtext, fontSize: 12 }}>{typingText}</Text>
        </View>
      )}

      {/* List */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        enabled={Platform.OS === 'ios'}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatRef}
          data={listData}
          style={{ flex: 1 }}
          keyExtractor={it => it.key}
          renderItem={renderItem}
          inverted
          contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 4 }}
          // === Performance & memory optimizations ===
          windowSize={7}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          initialNumToRender={12}
          removeClippedSubviews={false}
          onScroll={(e) => {
            const y = Number(e?.nativeEvent?.contentOffset?.y || 0);
            isNearLatestRef.current = y <= AUTO_SCROLL_NEAR_LATEST_PX;
          }}
          scrollEventThrottle={16}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onScrollToIndexFailed={(info) => {
            const safeIndex = Math.max(0, Math.min(info.index, Math.max(0, renderUnits.length - 1)));
            const offset = safeIndex * (info.averageItemLength || 50);
            flatRef.current?.scrollToOffset({ offset, animated: true });
            setTimeout(() => {
              if (scrollingToId && idRenderIndexMap.has(scrollingToId)) {
                flatRef.current?.scrollToIndex({ index: idRenderIndexMap.get(scrollingToId)!, animated: true, viewPosition: 0.5 });
                return;
              }
              flatRef.current?.scrollToIndex({ index: safeIndex, animated: true, viewPosition: 0.5 });
            }, 140);
          }}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 10 }} /> : null}
          ListEmptyComponent={
            (!meResolved || msgLoading) ? (
              <View style={{ paddingTop: 40 }}><ActivityIndicator size="large" color={colors.primary} /></View>
            ) : (
              <View style={styles.fullScreenEmpty}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.myBubble }]}>
                  <Ionicons name="chatbubbles-outline" size={54} color={colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('chatNoMessagesYet')}</Text>
                <Text style={{ color: colors.subtext }}>{t('chatStartConversation')}</Text>
              </View>
            )
          }
        />

      {/* Popover */}
      {popover.visible ? (
        <MessageActionsModal
          visible={popover.visible}
          isPinned={!!popover.isPinned}
          targetMessage={popover.target || null}
          toAbsoluteUrl={absoluteUrl}
          activeReactionEmoji={
            Array.isArray(popover.target?.reactions)
              ? (popover.target?.reactions.find((row) => Number(row.user_id || 0) === Number(me?.id || 0))?.emoji || null)
              : null
          }
          onReact={(emoji) => {
            if (!popover.target) return;
            reactToMessage(popover.target, emoji);
            closePopover();
          }}
          onReply={() => {
            if (!popover.target) return;
            setReplyingTo(popover.target);
            closePopover();
          }}
          onPinToggle={() => {
            if (!currentRoom || !popover.target) return;
            togglePin(currentRoom.id, popover.target);
            closePopover();
          }}
          onCopy={() => {
            if (!popover.target) return;
            const copied = buildCopyText(popover.target, t);
            if (!copied) {
              Platform.OS === 'android'
                ? ToastAndroid.show(t('chatNoTextToCopy'), ToastAndroid.SHORT)
                : showAlert(t('chatNoTextToCopy'));
            } else {
              Clipboard.setString(copied);
              Platform.OS === 'android'
                ? ToastAndroid.show(t('chatCopied'), ToastAndroid.SHORT)
                : showAlert(t('chatCopied'));
            }
            closePopover();
          }}
          onShare={() => {
            if (!popover.target) return;
            shareFileMessage(popover.target, t);
            closePopover();
          }}
          onClose={closePopover}
        />
      ) : null}

      {pinnedOpen ? (
        <PinnedMessagesModal
          visible={pinnedOpen}
          messages={pinnedList}
          toAbsoluteUrl={absoluteUrl}
          onClose={() => setPinnedOpen(false)}
          onOpenMessage={(msg) => {
            setPinnedOpen(false);
            const targetId = asNum(msg.id);
            if (targetId) goToMessage(targetId);
          }}
          onUnpin={(msg) => {
            if (!currentRoom) return;
            const id = msg.id || msg.localId || '';
            unpinOne(currentRoom.id, id);
          }}
        />
      ) : null}

        {/* Reply bar */}
        {!!replyingTo && (
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingHorizontal: 14, paddingVertical: 8,
              backgroundColor: '#FFFFFF',
              borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE3E0'
            }}
          >
            <View style={{ width: 3, height: 38, backgroundColor: '#8FA99D', borderRadius: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: '#55626A', fontWeight: '700', marginBottom: 2 }}>
                {t('chatReplyingTo', {
                  name: formatSenderName({
                    role: replyingTo.role,
                    fullName: replyingTo.full_name,
                    username: replyingTo.username,
                  }),
                })}
              </Text>
              <Text style={{ fontSize: 13, color: '#24313A' }} numberOfLines={1}>
                {(() => {
                  const isPdf = isPdfLike({
                    mimeType: replyingTo.mime_type,
                    fileName: replyingTo.file_name,
                    fileUrl: replyingTo.file_url,
                    text: replyingTo.text,
                  });
                  if (replyingTo.msg_type === 'text') return ellipsize(replyingTo.text);
                  if (replyingTo.msg_type === 'image' && !isPdf) return t('chatImageLabel');
                  return `📎 ${decodeDisplayFileName(replyingTo.file_name) || t('chatAttachment')}`;
                })()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 4 }}>
              <Ionicons name="close" size={18} color="#6A757C" />
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Section (Preview + Composer) */}
        <View style={{ backgroundColor: colors.cardBg }}>
           {/* Image Preview Bar */}
          {selectedImages.length > 0 && (
            <View style={{ 
              backgroundColor: colors.cardBg, 
              borderTopWidth: 1, 
              borderTopColor: colors.border,
              paddingVertical: 12,
              paddingLeft: 10
            }}>
               <FlatList
                data={selectedImages}
                horizontal
                keyExtractor={(item, index) => `${item.uri}_${index}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 20, gap: 12 }}
                renderItem={({ item, index }) => {
                  const isImage = (item.type || '').startsWith('image/') || (item.fileName || '').match(/\.(jpg|jpeg|png|gif|webp)$/i);
                  const attachmentKind = getAttachmentKind({
                    mimeType: item.type,
                    fileName: item.fileName,
                    fileUrl: item.uri,
                    text: item.fileName,
                  });
                  const docIcon = attachmentKind === 'video'
                    ? 'videocam-outline'
                    : attachmentKind === 'excel'
                    ? 'grid-outline'
                    : (attachmentKind === 'word' ? 'document-text-outline' : (attachmentKind === 'pdf' ? 'document-text' : 'document-outline'));
                  const docTag = attachmentKind === 'video'
                    ? 'VIDEO'
                    : attachmentKind === 'excel'
                    ? 'XLS'
                    : (attachmentKind === 'word' ? 'DOC' : (attachmentKind === 'pdf' ? 'PDF' : 'FILE'));
                  return (
                    <View style={{ width: 72, height: 72, marginRight: 2 }}>
                      {isImage ? (
                        <Image 
                          source={{ uri: item.uri }} 
                          style={{ width: '100%', height: '100%', borderRadius: 12, borderWidth: 1, borderColor: '#DEE4E1', backgroundColor: '#F1F4F3' }} 
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{ 
                          width: '100%', height: '100%', borderRadius: 12, borderWidth: 1, borderColor: '#DEE4E1', backgroundColor: '#F7FAF8',
                          alignItems: 'center', justifyContent: 'center', padding: 4
                        }}>
                          <Ionicons name={docIcon} size={26} color="#5E737D" />
                          <Text style={{ fontSize: 9, color: '#587064', marginTop: 2, fontWeight: '700' }}>{docTag}</Text>
                          <Text style={{ fontSize: 10, color: '#55626A', marginTop: 2, textAlign: 'center' }} numberOfLines={1}>
                            {item.fileName || t('chatFile')}
                          </Text>
                        </View>
                      )}
                    <TouchableOpacity 
                      style={{ 
                        position: 'absolute', top: -6, right: -6, 
                        backgroundColor: '#FDFEFE', borderRadius: 12, width: 24, height: 24,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: '#DEE4E1',
                        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => {
                         setSelectedImages(prev => prev.filter((_, i) => i !== index));
                      }}
                    >
                      <Ionicons name="close" size={14} color="#C96060" />
                    </TouchableOpacity>
                  </View>
                );
              }}
               />
            </View>
          )}

          {/* Composer */}
          <View style={[styles.composerWrap, { borderTopColor: colors.border, backgroundColor: colors.cardBg }]}>
            {/* Messenger Style: เธ–้าพิมพ์อยู่ ให้ซ่อน Tools แล้วโชว์ลูกศร > เนเธ—น */}
            {!toolsVisible ? (
               <TouchableOpacity
                 onPress={() => {
                   // Keyboard.dismiss(); 
                   // เนเธกเนเธเธฑเธเธเธตเธขเนเธเธญเธฃเนเธ” เนเธ•เนเนเธซเนเน€ลื่อน icon ออกมา
                   // LayoutAnimation disabled — causes crashes with FlatList
                   // LayoutAnimation.configureNext({ duration: 250, update: { type: LayoutAnimation.Types.easeInEaseOut } });
                   setToolsVisible(true);
                   // เธ–้าอยากให้ typing แล้วหุบกลับ เธ•้องไปแก้ onChangeText เน€พิ่ม
                 }}
                 style={styles.iconBtn}
               >
                 <Ionicons name="chevron-forward" size={24} color={colors.primary} />
               </TouchableOpacity>
            ) : (
              <>
                {/* เธเธธเนเธกเน€ลือกรูปหลายรูป */}
                <TouchableOpacity
                  onPress={pickImagesMulti}
                  style={styles.iconBtn}
                >
                  <Ionicons name="image-outline" size={24} color={colors.primary} />
                </TouchableOpacity>
  
                <TouchableOpacity onPress={takePhoto} style={styles.iconBtn}>
                  <Ionicons name="camera-outline" size={24} color={colors.primary} />
                </TouchableOpacity>
  
                <TouchableOpacity onPress={pickDocument} style={styles.iconBtn}>
                  <Ionicons name="document-attach-outline" size={22} color={colors.primary} />
                </TouchableOpacity>
              </>
            )}
  
            <View style={[styles.inputPill, { borderColor: colors.border }]}>
              <TextInput
                ref={composerInputRef}
                style={[styles.inputText, { color: colors.text }]}
                placeholder={currentRoom ? t('chatTypeMessage') : t('chatSelectRoomFirst')}
                placeholderTextColor={colors.subtext}
                value={text}
                editable={!!currentRoom}
                maxLength={2000}
                multiline
                onChangeText={onChangeText}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
                onFocus={() => {
                  if (Platform.OS === 'android') {
                   setKeyboardUsing(true);
                   setToolsVisible(false); // ซ่อน tools
                  }
                }}
              />
            </View>
  
            <TouchableOpacity
              onPress={sendMessage}
              disabled={isPreparingUpload || ((!text.trim() && selectedImages.length === 0) || !currentRoom)}
              style={[styles.sendFab, { opacity: isPreparingUpload || ((!text.trim() && selectedImages.length === 0) || !currentRoom) ? 0.5 : 1, backgroundColor: colors.primary }]}
              activeOpacity={0.9}
            >
              {isPreparingUpload ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Gallery Viewer */}
      {videoPreview.visible ? (
        <VideoQuickPreviewModal
          visible={videoPreview.visible}
          url={videoPreview.url}
          fallbackUrls={videoPreview.fallbackUrls}
          onClose={closeVideoPreview}
          onDownload={downloadVideoPreview}
          onShare={shareVideoPreview}
        />
      ) : null}

      {pdfPreview.visible ? (
        <PdfQuickPreviewModal
          visible={pdfPreview.visible}
          url={pdfPreview.url}
          fallbackUrls={pdfPreview.fallbackUrls}
          displayName={pdfPreview.name}
          fileSize={pdfPreview.size}
          onClose={closePdfPreview}
          onOpenExternal={openPdfPreviewExternal}
          onOpenInBrowser={openPdfPreviewInBrowser}
          onShare={sharePdfPreview}
        />
      ) : null}

      {galleryVisible ? (
        <ChatImageViewer
          images={galleryItems}
          initialIndex={galleryIndex}
          visible={galleryVisible}
          onRequestClose={closeGallery}
          onImageIndexChange={onImageIndexChangeStable}
          onDownloadAll={onDownloadAll}
          onDownloadCurrent={onDownloadCurrent}
          bulkSaving={bulkSaving}
          bulkProgress={bulkProgress}
        />
      ) : null}

      <ChatCameraModal
        visible={cameraPickerVisible}
        onClose={() => setCameraPickerVisible(false)}
        onCapture={onCameraCaptured}
      />
    </View>
  );
};

/* ===== Error Boundary: prevents chat render errors from killing the app ===== */
class ChatScreenErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Silently log — prevents app crash
    console.warn('[ChatScreen] Render error caught by boundary:', error?.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#333' }}>
            เกิดข้อผิดพลาด
          </Text>
          <Text style={{ color: '#666', textAlign: 'center', marginBottom: 16 }}>
            ไม่สามารถแสดงแชทได้ กรุณาลองใหม่อีกครั้ง
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false })}
            style={{ backgroundColor: '#4F8F77', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>ลองใหม่</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const ChatScreenWithBoundary: React.FC<ChatScreenProps> = (props) => (
  <ChatScreenErrorBoundary>
    <ChatScreen {...props} />
  </ChatScreenErrorBoundary>
);

export default ChatScreenWithBoundary;
