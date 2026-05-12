const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const axios = require('axios');
const sharp = require('sharp');

const { HOST, PORT, SLIP2GO_API, SLIP2GO_SECRET, PROMPTPAY_ID: ENV_PROMPTPAY_ID } = require('../config/env');
const { UPLOAD_DIR, PROCESSED_DIR } = require('../config/paths');
const { pool } = require('../db/pool');
const { QR_EXPIRY_MINUTES, removeCachedQRByFilename } = require('../utils/qr');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const fileFilter = (req, file, cb) => {
  if (/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype)) cb(null, true);
  else cb(new Error('รองรับเฉพาะไฟล์รูป jpeg/png/webp/heic/heif'), false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const RECEIPT_DIR = path.join(UPLOAD_DIR, 'receipts');
fs.ensureDirSync(RECEIPT_DIR);

const normalize = (u) => String(u || '').replace(/\/+$/,'');
const toNonEmptyString = (v) => {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
};

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatReceiptDateTime(input) {
  const d = input ? new Date(input) : new Date();
  const dt = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function toSingleLineText(value, fallback = '-') {
  const text = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return text || fallback;
}

function extractNameObj(nameObj) {
  if (!nameObj) return '';
  if (typeof nameObj === 'string') return nameObj;
  if (typeof nameObj === 'object') {
    return `${nameObj.th || ''} ${nameObj.en || ''}`.trim();
  }
  return String(nameObj);
}

function maskPromptPay(promptPayId) {
  const digits = String(promptPayId || '').replace(/\D/g, '');
  if (!digits) return '-';
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function compactRef(value) {
  const raw = String(value == null ? '' : value).replace(/\s+/g, '').trim();
  if (!raw) return `REF-${Date.now()}`;
  if (raw.length <= 32) return raw;
  return `${raw.slice(0, 32)}...`;
}

function formatThaiDate(input) {
  const d = input ? new Date(input) : new Date();
  const dt = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n) => String(n).padStart(2, '0');
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const buddhistYear = dt.getFullYear() + 543;
  return `${dt.getDate()} ${thaiMonths[dt.getMonth()]} ${buddhistYear} - ${pad(dt.getHours())}:${pad(dt.getMinutes())} น.`;
}

function buildBankSlipSvg({
  amount,
  senderName,
  sendingBank,
  paidAt,
  houseNumber,
  receiverName,
  promptPayId,
  reference,
  receiptNo,
}) {
  const amountText = formatMoney(amount);
  const dateText = formatThaiDate(paidAt);
  const payerText = toSingleLineText(senderName, 'ไม่ทราบผู้โอน');
  const senderBankText = toSingleLineText(sendingBank, 'ไม่ทราบธนาคาร');
  const receiverText = toSingleLineText(receiverName, 'NitiSmart');
  const houseText = toSingleLineText(houseNumber, '-');
  const promptPayMasked = maskPromptPay(promptPayId);
  const refText = compactRef(reference || receiptNo);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feFlood flood-color="#000000" flood-opacity="0.08" result="flood"/>
      <feComposite in="flood" in2="SourceGraphic" operator="in" result="mask"/>
      <feGaussianBlur in="mask" stdDeviation="15" result="blur"/>
      <feOffset in="blur" dx="0" dy="8" result="offset"/>
      <feMerge>
        <feMergeNode in="offset"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1920" fill="#f0f2f5"/>

  <!-- Card -->
  <rect x="80" y="260" width="920" height="1380" rx="38" fill="#FFFFFF" filter="url(#shadow)"/>

  <!-- Header Stripe -->
  <rect x="80" y="260" width="920" height="30" rx="38" fill="#003399"/>
  <rect x="80" y="275" width="920" height="15" fill="#003399"/>

  <!-- Header Info -->
  <text x="152" y="380" font-family="Tahoma, sans-serif" font-size="48" font-weight="bold" fill="#003399">Payment</text>
  <text x="928" y="380" font-family="Tahoma, sans-serif" font-size="34" font-weight="bold" fill="#1a8a3a" text-anchor="end">ทำรายการสำเร็จ</text>

  <!-- Time Label -->
  <text x="152" y="450" font-family="Tahoma, sans-serif" font-size="32" fill="#6b6b6b">${escapeXml(dateText)}</text>

  <!-- Info Container Line -->
  <line x1="176" y1="530" x2="176" y2="850" stroke="#eeeeee" stroke-width="5"/>

  <!-- Node 1: From -->
  <circle cx="176" cy="530" r="14" fill="#003399"/>
  <circle cx="176" cy="530" r="18" fill="none" stroke="#003399" stroke-width="3"/>
  <text x="224" y="520" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b">จาก</text>
  <text x="224" y="570" font-family="Tahoma, sans-serif" font-size="38" font-weight="bold" fill="#2b2b2b">${escapeXml(payerText)}</text>
  <text x="224" y="615" font-family="Tahoma, sans-serif" font-size="34" fill="#6b6b6b">${escapeXml(senderBankText)}</text>

  <!-- Address Highlight -->
  <rect x="224" y="640" width="680" height="120" rx="19" fill="#f8faff"/>
  <rect x="224" y="640" width="10" height="120" rx="10" fill="#003399"/>
  <rect x="229" y="640" width="5" height="120" fill="#003399"/>
  <text x="260" y="685" font-family="Tahoma, sans-serif" font-size="28" font-weight="bold" fill="#003399">บ้านเลขที่</text>
  <text x="260" y="735" font-family="Tahoma, sans-serif" font-size="36" font-weight="bold" fill="#2b2b2b">${escapeXml(houseText)}</text>

  <!-- Node 2: To -->
  <circle cx="176" cy="850" r="14" fill="#003399"/>
  <circle cx="176" cy="850" r="18" fill="none" stroke="#003399" stroke-width="3"/>
  <text x="224" y="840" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b">ไปยัง</text>
  <text x="224" y="890" font-family="Tahoma, sans-serif" font-size="38" font-weight="bold" fill="#2b2b2b">${escapeXml(receiverText)}</text>
  <text x="224" y="935" font-family="Tahoma, sans-serif" font-size="34" fill="#6b6b6b">PromptPay ${escapeXml(promptPayMasked)}</text>

  <!-- Amount Container -->
  <line x1="152" y1="1020" x2="928" y2="1020" stroke="#dddddd" stroke-dasharray="10, 10" stroke-width="3"/>
  <text x="540" y="1100" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b" text-anchor="middle">จำนวนเงิน (บาท)</text>
  <text x="540" y="1190" font-family="Tahoma, sans-serif" font-size="86" font-weight="bold" fill="#003399" text-anchor="middle">${escapeXml(amountText)}</text>
  <text x="540" y="1250" font-family="Tahoma, sans-serif" font-size="34" fill="#6b6b6b" text-anchor="middle">ค่าธรรมเนียม: 0.00</text>

  <!-- Footer Ref -->
  <line x1="152" y1="1330" x2="928" y2="1330" stroke="#f0f0f0" stroke-width="3"/>
  <text x="152" y="1400" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b">เลขที่อ้างอิง: ${escapeXml(refText)}</text>
  <text x="152" y="1450" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b">ใบเสร็จ: ${escapeXml(receiptNo)}</text>
  <text x="152" y="1500" font-family="Tahoma, sans-serif" font-size="28" fill="#6b6b6b">โอนเงิน PromptPay</text>
  <text x="152" y="1560" font-family="Tahoma, sans-serif" font-size="28" font-weight="bold" fill="#ff6600">ตรวจสอบความถูกต้องได้ที่แอปฯ ธนาคาร</text>

</svg>`;
}

async function createBankSlipImage({
  amount,
  senderName,
  sendingBank,
  paidAt,
  houseNumber,
  receiverName,
  promptPayId,
  reference,
}) {
  const nowMs = Date.now();
  const suffix = `${nowMs}-${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`;
  const receiptNo = `SLIP-${suffix}`;
  const filename = `bank-slip-${suffix}.png`;
  const outputPath = path.join(RECEIPT_DIR, filename);

  const svg = buildBankSlipSvg({
    amount,
    senderName,
    sendingBank,
    paidAt,
    houseNumber,
    receiverName,
    promptPayId,
    reference,
    receiptNo,
  });

  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, quality: 92 })
    .toFile(outputPath);

  return {
    receiptNo,
    filename,
    url: `http://${HOST}:${PORT}/uploads/receipts/${filename}`,
  };
}

async function getRuntimeSetting(app, key, fallbackValue) {
  try {
    if (typeof app?.getSetting === 'function') {
      const val = await app.getSetting(key);
      const normalized = toNonEmptyString(val);
      if (normalized) return normalized;
    }
  } catch (e) {
    console.warn(`[slip-check] getSetting(${key}) failed:`, e.message);
  }
  return toNonEmptyString(fallbackValue);
}

const normalizePromptPayId = (v) => String(v || '').replace(/\D/g, '').trim();

function tryParseJsonObject(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore invalid JSON.
  }
  return null;
}

function toObject(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  return {};
}

function toBooleanLike(input) {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') {
    if (input === 1) return true;
    if (input === 0) return false;
    return null;
  }
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return null;
}

function normalizeImageBase64(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function parsePayloadInput(input) {
  if (typeof input === 'string') return tryParseJsonObject(input) || {};
  return toObject(input);
}

function normalizeCheckCondition(payloadInput, amountFromBody) {
  const checkCondition = toObject(payloadInput.checkCondition);

  const rootCheckDuplicate = toBooleanLike(payloadInput.checkDuplicate);
  if (rootCheckDuplicate !== null && typeof checkCondition.checkDuplicate !== 'boolean') {
    checkCondition.checkDuplicate = rootCheckDuplicate;
  }

  if (payloadInput.checkAmount && !checkCondition.checkAmount) checkCondition.checkAmount = payloadInput.checkAmount;
  if (payloadInput.checkReceiver && !checkCondition.checkReceiver) checkCondition.checkReceiver = payloadInput.checkReceiver;
  if (payloadInput.checkDate && !checkCondition.checkDate) checkCondition.checkDate = payloadInput.checkDate;

  if (typeof checkCondition.checkDuplicate !== 'boolean') {
    checkCondition.checkDuplicate = true;
  }

  if (!checkCondition.checkAmount && !Number.isNaN(amountFromBody) && amountFromBody > 0) {
    checkCondition.checkAmount = { type: 'eq', amount: amountFromBody };
  }

  return checkCondition;
}

async function getRuntimePromptPayId(app) {
  const rawSetting = toNonEmptyString(await getRuntimeSetting(app, 'promptpay_id', ''));
  if (rawSetting) {
    const fromSettings = normalizePromptPayId(rawSetting);
    if (/^\d{10}$/.test(fromSettings)) return fromSettings;
    return '';
  }
  const fromEnv = normalizePromptPayId(ENV_PROMPTPAY_ID);
  if (/^\d{10}$/.test(fromEnv)) return fromEnv;
  return '';
}

// รองรับทั้ง base URL และ endpoint เต็มของ Slip2Go
const resolveSlip2GoUrl = (apiBase) => {
  const base = normalize(apiBase || '');
  const defaultEndpoint = 'https://api.slip2go.com/api/verify-slip/qr-code/info';

  if (!base) return defaultEndpoint;
  if (/slipok\.com/i.test(base)) return defaultEndpoint;
  if (/\/api\/verify-slip\/qr-base64\/info$/i.test(base)) return base.replace(/qr-base64\/info$/i, 'qr-code/info');
  if (/\/api\/verify-slip\/qr-code\/info$/i.test(base)) return base;
  if (/\/api$/i.test(base)) return `${base}/verify-slip/qr-code/info`;
  if (/\/api\/verify-slip$/i.test(base)) return `${base}/qr-code/info`;
  return `${base}/api/verify-slip/qr-code/info`;
};

const resolveSlip2GoBase64Url = (apiBase) => {
  const base = normalize(apiBase || '');
  const defaultEndpoint = 'https://connect.slip2go.com/api/verify-slip/qr-base64/info';

  if (!base) return defaultEndpoint;
  if (/slipok\.com/i.test(base)) return defaultEndpoint;
  if (/\/api\/verify-slip\/qr-base64\/info$/i.test(base)) return base;
  if (/\/api\/verify-slip\/qr-code\/info$/i.test(base)) return base.replace(/qr-code\/info$/i, 'qr-base64/info');
  if (/\/api$/i.test(base)) return `${base}/verify-slip/qr-base64/info`;
  if (/\/api\/verify-slip$/i.test(base)) return `${base}/qr-base64/info`;
  return `${base}/api/verify-slip/qr-base64/info`;
};

function uniqueUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls || []) {
    const u = toNonEmptyString(raw);
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function buildSlip2GoCandidates(apiBase, mode) {
  const base = normalize(apiBase || '');
  const isCode = mode === 'code';
  const endpoint = isCode ? 'qr-code/info' : 'qr-base64/info';
  const candidates = [];

  if (base && !/slipok\.com/i.test(base)) {
    if (/\/api\/verify-slip\/qr-(code|base64)\/info$/i.test(base)) {
      candidates.push(base.replace(/qr-(code|base64)\/info$/i, endpoint));
    } else if (/\/api$/i.test(base)) {
      candidates.push(`${base}/verify-slip/${endpoint}`);
    } else if (/\/api\/verify-slip$/i.test(base)) {
      candidates.push(`${base}/${endpoint}`);
    } else {
      candidates.push(`${base}/api/verify-slip/${endpoint}`);
    }
  }

  if (isCode) {
    candidates.push('https://api.slip2go.com/api/verify-slip/qr-code/info');
    candidates.push('https://connect.slip2go.com/api/verify-slip/qr-code/info');
  } else {
    candidates.push('https://connect.slip2go.com/api/verify-slip/qr-base64/info');
    candidates.push('https://api.slip2go.com/api/verify-slip/qr-base64/info');
  }

  return uniqueUrls(candidates);
}

function providerBodyToText(data) {
  if (typeof data === 'string') return data;
  if (data && typeof data?.message === 'string') return data.message;
  try {
    return JSON.stringify(data || '');
  } catch {
    return String(data || '');
  }
}

function isProviderEndpointNotFound(resp) {
  const status = Number(resp?.status || 0);
  const message = providerBodyToText(resp?.data);
  return status === 404 && /cannot\s+post\s+\/api\/verify-slip\/qr-(code|base64)\/info/i.test(message);
}

async function postWithCandidateUrls(urls, requestFactory) {
  let lastResp = null;
  let lastUrl = null;
  let lastError = null;

  for (const url of urls) {
    try {
      const resp = await requestFactory(url);
      lastResp = resp;
      lastUrl = url;
      if (!isProviderEndpointNotFound(resp)) {
        return { resp, url, tried: urls };
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (lastResp) return { resp: lastResp, url: lastUrl, tried: urls };
  if (lastError) throw lastError;
  throw new Error('No Slip2Go endpoint candidate available');
}

function registerSlipOkRoutes(app) {
  app.post('/upload-and-check', upload.single('file'), async (req, res) => {
    try {
      // Priority: system_settings (new keys -> legacy keys) -> .env
      const slip2goSecret =
        toNonEmptyString(await getRuntimeSetting(app, 'slip2go_secret', ''))
        || toNonEmptyString(await getRuntimeSetting(app, 'slipok_key', ''))
        || toNonEmptyString(SLIP2GO_SECRET);
      const slip2goApi =
        toNonEmptyString(await getRuntimeSetting(app, 'slip2go_api', ''))
        || toNonEmptyString(await getRuntimeSetting(app, 'slipok_api', ''))
        || toNonEmptyString(SLIP2GO_API);
      if (!slip2goSecret) return res.status(500).json({ ok: false, message: 'ยังไม่ได้ตั้ง SLIP2GO_SECRET' });

      const payloadFromBody = parsePayloadInput(req.body?.payload);
      let directImageBase64 = normalizeImageBase64(
        req.body?.imageBase64 || payloadFromBody.imageBase64
      );
      const amountFromBody = Number(req.body?.amount);
      const checkCondition = normalizeCheckCondition(payloadFromBody, amountFromBody);

      let compressedName = null;
      let compressedPath = null;
      let originalUrl = null;
      let compressedUrl = null;
      let providerMode = 'base64';
      let providerEndpoint = '';

      // ===== Compress image + convert to base64 if file uploaded =====
      let resp;
      if (req.file) {
        providerMode = 'image';
        const originalPath = path.join(UPLOAD_DIR, req.file.filename);
        const baseName = path.parse(req.file.filename).name;
        compressedName = `${baseName}-compressed.jpg`;
        compressedPath = path.join(PROCESSED_DIR, compressedName);

        await sharp(originalPath)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(compressedPath);

        originalUrl = `http://${HOST}:${PORT}/uploads/${req.file.filename}`;
        compressedUrl = `http://${HOST}:${PORT}/uploads/repairs/${compressedName}`;

        const compressedBuffer = await fs.readFile(compressedPath);
        directImageBase64 = normalizeImageBase64(compressedBuffer.toString('base64'));
      }

      // ===== ส่ง base64 ไปตรวจผ่าน qr-base64/info =====
      const imageBase64 = directImageBase64;
      if (!imageBase64) {
        return res.status(400).json({
          ok: false,
          message: 'ไม่ได้ส่งไฟล์หรือ imageBase64 มา',
        });
      }

      const providerRequest = {
        payload: {
          imageBase64,
          ...(Object.keys(checkCondition).length ? { checkCondition } : {}),
        },
      };

      const base64Urls = buildSlip2GoCandidates(slip2goApi, 'base64');
      console.log('[slip-check] DEBUG candidate URLs:', base64Urls);
      console.log('[slip-check] DEBUG checkCondition:', JSON.stringify(checkCondition));
      console.log('[slip-check] DEBUG base64 length:', imageBase64.length);

      const base64Result = await postWithCandidateUrls(base64Urls, async (url) => {
        console.log('[slip-check] DEBUG trying URL:', url);
        return axios.post(url, providerRequest, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${slip2goSecret}`,
            Accept: 'application/json',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 20000,
          validateStatus: () => true,
        });
      });
      resp = base64Result.resp;
      providerEndpoint = base64Result.url || '';

      console.log('[slip-check] DEBUG response status:', resp?.status);
      console.log('[slip-check] DEBUG response data:', JSON.stringify(resp?.data, null, 2));

      // ===== ดึงค่าที่ต้องการ =====
      const payload = resp?.data || {};
      const providerCode = String(payload?.code || '');
      const d = payload?.data || {};
      const slipSuccess = ['200000', '200200'].includes(providerCode);
      const slipDuplicate = providerCode === '200501';

      // สลิปซ้ำ (200501) ยังมี data กลับมาให้ตรวจ receiver/amount ได้
      if (!slipSuccess && !slipDuplicate) {
        if (providerCode === '200404') {
          return res.status(400).json({
            ok: false,
            code: 'SLIP_EXPIRED_OR_NO_TXN',
            message: 'สลิปหมดอายุ หรือ ไม่มีรายการ',
            provider: payload,
          });
        }
        if (providerCode === '200401') {
          return res.status(400).json({
            ok: false,
            code: 'INVALID_RECEIVER',
            message: 'บัญชีผู้รับไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่',
            provider: payload,
          });
        }
        if (providerCode === '200402') {
          return res.status(400).json({
            ok: false,
            code: 'AMOUNT_MISMATCH_PROVIDER',
            message: 'จำนวนเงินไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่',
            provider: payload,
          });
        }
        if (providerCode === '200500') {
          return res.status(400).json({
            ok: false,
            code: 'SLIP_FRAUD',
            message: 'สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่',
            provider: payload,
          });
        }
        if (providerCode === '400001' || providerCode === '400002') {
          return res.status(400).json({
            ok: false,
            code: 'NO_QR_IN_IMAGE',
            message: 'รูปภาพไม่ถูกต้องหรือไม่มี QR Code',
            provider: payload,
          });
        }
        if (/^401/.test(providerCode)) {
          return res.status(500).json({
            ok: false,
            code: 'SLIP_PROVIDER_AUTH_FAILED',
            message: 'ตั้งค่า Slip2Go ไม่ถูกต้อง กรุณาตรวจสอบ API Secret',
            provider: payload,
          });
        }

        const statusCode = resp?.status >= 400 && resp?.status < 500 ? 400 : 502;
        console.error('[slip-check] provider error:', payload || resp?.status);
        return res.status(statusCode).json({
          ok: false,
          code: 'SLIP_PROVIDER_FAILED',
          message: payload?.message || 'ตรวจสลิปไม่สำเร็จ',
          provider: payload,
        });
      }

      let intentForCleanup = null;

      // อ่าน intentId ที่ส่งมาด้วย (multipart field: intentId หรือ intent_id)
      const intentId =
        Number(req.body?.intentId || req.body?.intent_id || req.query?.intentId || 0) || null;

      // amount บนสลิป (ถ้ามี) หรือจากฟอร์ม
      const amount =
        d?.amount != null && !Number.isNaN(Number(d.amount))
          ? Number(d.amount)
          : req.body?.amount != null && !Number.isNaN(Number(req.body.amount))
          ? Number(req.body.amount)
          : null;

      const qrcodeData =
        req.body?.qrcodeData
        || d?.decode
        || d?.qrString
        || d?.qrstring
        || d?.qr_code
        || d?.qr
        || null;

      const sendingBank = d?.sender?.bank?.name || d?.sender?.bank?.id || d?.sendingBank || null;
      const senderNameObj = d?.sender?.account?.name || d?.sender?.name || d?.sender?.displayName;
      const senderName = extractNameObj(senderNameObj) || null;

      const dateTimeRaw = d?.dateTime || null;
      let transDate = d?.transDate || null;
      let transTime = d?.transTime || null;
      if (dateTimeRaw) {
        const dt = new Date(dateTimeRaw);
        if (!Number.isNaN(dt.getTime())) {
          const iso = dt.toISOString();
          transDate = iso.slice(0, 10).replace(/-/g, '');
          transTime = iso.slice(11, 19).replace(/:/g, '');
        }
      }

      // slip_datetime: full datetime จากสลิป (MySQL format)
      let slipDatetime = null;
      if (dateTimeRaw) {
        const dt = new Date(dateTimeRaw);
        if (!Number.isNaN(dt.getTime())) {
          slipDatetime = dt.toISOString().slice(0, 19).replace('T', ' ');
        }
      }

      // ===== Validation (ทำทั้ง success และ duplicate เพราะ 200501 ก็มี data) =====
      if (slipSuccess || slipDuplicate) {
        // 1) ตรวจชื่อบัญชีผู้รับ
        const expectedReceiverName = toNonEmptyString(
          await getRuntimeSetting(app, 'receiver_name', '')
        ).toUpperCase();
        
        const receiverNameObj = d?.receiver?.account?.name || d?.receiver?.name || d?.receiver?.displayName;
        const actualReceiverName = toNonEmptyString(extractNameObj(receiverNameObj)).toUpperCase();
        
        if (expectedReceiverName && actualReceiverName
            && !actualReceiverName.includes(expectedReceiverName)
            && !expectedReceiverName.includes(actualReceiverName)) {
          console.warn('[slip-check] receiver name mismatch:',
            { expected: expectedReceiverName, actual: actualReceiverName });
          return res.status(400).json({
            ok: false,
            code: 'RECEIVER_NAME_MISMATCH',
            message: 'ชื่อบัญชีผู้รับไม่ตรง กรุณาติดต่อเจ้าหน้าที่',
            expectedName: expectedReceiverName,
            actualName: actualReceiverName,
          });
        }

        // 2) ตรวจจำนวนเงินตรงกับ payment_intents (ถ้าระบุ intentId)
        if (intentId) {
          const [rows] = await pool.query(
            `SELECT id, installment_id, payment_id, house_number, amount, method, status, qr_id,
                    TIMESTAMPDIFF(SECOND, updated_at, NOW()) AS age_seconds
             FROM payment_intents
             WHERE id = ?
             LIMIT 1`,
            [intentId]
          );
          const intent = Array.isArray(rows) && rows[0] ? rows[0] : null;
          if (!intent) {
            return res.status(404).json({
              ok: false,
              code: 'INTENT_NOT_FOUND',
              message: 'ไม่พบรายการชำระ กรุณาติดต่อเจ้าหน้าที่',
            });
          }

          const ageSeconds = Number(intent.age_seconds || 0);
          const isExpired = String(intent.status || '').toLowerCase() === 'expired'
            || !Number.isFinite(ageSeconds)
            || ageSeconds > QR_EXPIRY_MINUTES * 60;
          if (isExpired) {
            await pool.query(
              `UPDATE payment_intents
               SET status = 'expired', updated_at = NOW()
               WHERE id = ?`,
              [intentId]
            ).catch(() => {});
            return res.status(410).json({
              ok: false,
              code: 'INTENT_EXPIRED',
              message: `QR นี้หมดอายุแล้ว กรุณาสร้างใหม่ (ภายใน ${QR_EXPIRY_MINUTES} นาที)`,
            });
          }

          intentForCleanup = intent;

          if (amount != null && Number(amount).toFixed(2) !== Number(intent.amount).toFixed(2)) {
            return res.status(400).json({
              ok: false,
              code: 'AMOUNT_MISMATCH',
              message: 'จำนวนเงินไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่',
              expected: Number(intent.amount),
              actual: Number(amount),
            });
          }
        }

        // 3) ตรวจเลขปลายทาง PromptPay จากสลิป (4 ตัวท้าย)
        const promptpayId = await getRuntimePromptPayId(app);
        const ppLast4 = promptpayId.slice(-4);
        const recvVal = String(
          d?.receiver?.account?.proxy?.account
          || d?.receiver?.account?.bank?.account
          || d?.receiver?.proxy?.value
          || ''
        );
        const recvDigits = recvVal.replace(/\D/g, '');
        const recvLast4 = recvDigits.slice(-4);
        if (ppLast4 && recvLast4 && recvLast4 !== ppLast4) {
          return res.status(400).json({
            ok: false,
            code: 'DEST_MISMATCH',
            message: 'หมายเลขปลายทางไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่',
            expectedLast4: ppLast4,
            actualLast4: recvLast4,
          });
        }
        if (ppLast4 && !recvLast4) {
          return res.status(400).json({
            ok: false,
            code: 'DEST_NOT_FOUND',
            message: 'ไม่พบหมายเลขปลายทางในสลิป กรุณาติดต่อเจ้าหน้าที่',
          });
        }
      }

      // หากเป็นสลิปซ้ำ (ผ่าน validation แล้ว) → reject
      if (slipDuplicate) {
        return res.status(409).json({
          ok: false,
          code: 'SLIP_DUPLICATE',
          message: 'สลิปซ้ำ กรุณาแจ้งเจ้าหน้าที่',
          provider: payload,
        });
      }
      // ===== End Validation =====

      // เช็คซ้ำด้วย qrcodeData ก่อนบันทึก
      const qrKey = (qrcodeData || '').trim();
      if (qrKey) {
        try {
          const [dup] = await pool.query(
            `SELECT id, amount, sending_bank, trans_date, trans_time, created_at
             FROM slipok_verifications WHERE qrcode_data = ? LIMIT 1`,
            [qrKey]
          );
          if (Array.isArray(dup) && dup.length > 0) {
            return res.status(409).json({
              ok: false,
              code: 'DUPLICATE_QRCODE_DATA',
              message: 'สลิปนี้เคยอัปโหลดแล้ว',
              duplicate: dup[0],
            });
          }
        } catch (e) {
          console.warn('[slip-check] duplicate check error:', e.message);
        }
      }

      // บันทึกลง DB
      let insertedId = null;
      try {
        const [r] = await pool.query(
          `INSERT INTO slipok_verifications
             (amount, qrcode_data, sending_bank, sender_name, trans_date, trans_time, slip_datetime, paid_at, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
          [amount, qrcodeData, sendingBank, senderName, transDate, transTime, slipDatetime, JSON.stringify(payload)]
        );
        insertedId = r?.insertId || null;
      } catch (e) {
        console.error('[slip-check] insert db error:', e.message);
      }

      if (intentId) {
        await pool.query(
          `UPDATE payment_intents
           SET status = 'confirmed', qr_id = NULL, updated_at = NOW()
           WHERE id = ?`,
          [intentId]
        ).catch(() => {});

        if (intentForCleanup && intentForCleanup.installment_id) {
          let proofPath = null;
          if (req.file) {
            proofPath = 'uploads/' + req.file.filename;
          }
          await pool.query(
            `UPDATE payment_installments
             SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), paid_method = 'promptpay',
                 paid_note = 'Auto verified by Slip2Go', proof_image = COALESCE(?, proof_image),
                 paid_by = COALESCE(paid_by, ?), approved_by = 'System (Auto)'
             WHERE id = ?`,
            [proofPath, senderName || 'System', intentForCleanup.installment_id]
          ).catch(e => console.error('[slip-check] update installment error:', e.message));
        }
      }

      const qrFilenameRaw =
        (intentForCleanup && intentForCleanup.qr_id ? String(intentForCleanup.qr_id) : '') ||
        String(req.body?.qrFilename || req.body?.qr_filename || '').trim();
      const qrFilename = qrFilenameRaw ? path.basename(qrFilenameRaw) : '';
      let qrFreed = false;
      if (qrFilename) {
        try {
          await removeCachedQRByFilename(qrFilename);
          qrFreed = true;
        } catch (e) {
          console.warn('[slip-check] qr cleanup failed:', e.message);
        }
      }

      let receiptImage = null;
      try {
        const receiverName = await getRuntimeSetting(app, 'receiver_name', '');
        const promptPayId = await getRuntimePromptPayId(app);
        const refFromProvider =
          d?.transRef
          || d?.transRefId
          || d?.transactionId
          || d?.txnId
          || qrcodeData
          || insertedId
          || Date.now();

        receiptImage = await createBankSlipImage({
          amount,
          senderName,
          sendingBank,
          paidAt: slipDatetime || dateTimeRaw,
          houseNumber: intentForCleanup?.house_number || req.body?.house_number || '',
          receiverName,
          promptPayId,
          reference: refFromProvider,
        });
      } catch (e) {
        console.warn('[slip-check] receipt image generation failed:', e.message);
      }

      return res.json({
        ok: true,
        message: 'อัปโหลด + ตรวจสลิป สำเร็จ',
        file: req.file
          ? {
              original: { filename: req.file.filename, url: originalUrl },
              compressed: { filename: compressedName, url: compressedUrl },
            }
          : null,
        providerMode,
        providerEndpoint: providerEndpoint || null,
        slip2go: payload,
        // Backward compatibility for existing mobile clients.
        slipok: payload,
        saved: { id: insertedId, amount, qrcodeData, sendingBank, senderName, slipDatetime, transDate, transTime },
        receiptImage,
        receipt: receiptImage,
        qrCleanup: { filename: qrFilename || null, freed: qrFreed },
      });
    } catch (err) {
      console.error('[slip-check] upload-and-check error:', err.message);
      return res.status(500).json({ ok: false, message: 'เซิร์ฟเวอร์ผิดพลาด กรุณาลองใหม่อีกครั้ง' });
    }
  });
}

module.exports = {
  registerSlipOkRoutes,
  registerSlip2GoRoutes: registerSlipOkRoutes,
  resolveSlipOkUrl: resolveSlip2GoUrl,
  resolveSlip2GoUrl,
  resolveSlip2GoBase64Url,
};
