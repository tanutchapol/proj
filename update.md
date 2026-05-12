# Update Log

## 12 May 2026
- **Fix Payment Sync Issue**: Resolved an issue where payments were successfully verified with Slip2Go API (slip generated and approved) but the system still showed the status as "unpaid" (ยังไม่ได้ชำระ).
- **Fix Financial Summary**: As a result of fixing the payment sync issue, the income/expense (รายรับ รายจ่าย) page now correctly pulls in the paid installments automatically.
- **Details**: Updated `backend/src/routes/slipok.js` to correctly update the `payment_installments` table status to `paid` along with the `payment_intents` when a slip verification succeeds.
- **Prevent Frontend Crash**: Fixed a potential issue where a missing house number could result in a null transaction title and cause the app to crash when generating financial reports.
- **Payment UX Improvement**: Auto-navigate back to the payment history page after a successful QR payment verification. The receipt slip is still shown to the user and automatically saved to the device before navigating back.
- **Data Freshness (Payment History)**: Added cache-busting headers (Cache-Control: no-cache and _t=Date.now()) to payment history fetch requests (PaymentHistory.tsx, PaymentStatus.tsx, and App.tsx) to ensure the payment status updates immediately when the user navigates back from the QR payment screen.
- **Payment Verification**: Fixed an issue where the slip verification API would fail to validate the receiver's name because the bank API returned the name as a multi-language object (th/en) instead of a simple string. The system now extracts both languages properly to compare with the expected receiver name.
- **Receipt Slip Redesign**: Redesigned the digital receipt (bank slip) SVG to match the NitiSmart HTML template — white card with blue accent bar, Thai branding (NitiSmart + ทำรายการสำเร็จ), timeline nodes for sender/receiver, Thai date format (Buddhist Era), centered amount box, Thai reference footer, and orange save-hint text. Frontend modal also updated to match.
- **Fix Server Crash on Slip Upload**: Fixed a critical typo where extractName() was called instead of extractNameObj() in the receiver name validation, causing a ReferenceError crash on every slip upload. Also replaced feDropShadow SVG filter with librsvg-compatible filter primitives to prevent sharp rendering failures.

- **Financial Visibility Thresholds**:
  - Adjusted PaymentHistory and Home screens to only display upcoming installments based on their payment cycles:
    - General / Monthly: Show within 15 days of due date.
    - Quarterly (3 months): Show within 1 month.
    - Bi-annually (6 months): Show within 3 months.
    - Annually (12 months): Show within 6 months.
  - Overdue installments always take precedence and are visible immediately.
  - Auto-close and return to history screen when a receipt is successfully saved/downloaded.

- **Code Quality / IDE Warnings**:
  - Fixed missing dependency `onBack` in `useCallback` in `Qrcode.tsx`.
  - Refactored inline style into StyleSheet for `NitiSmart` brand title in `Qrcode.tsx`.
  - Removed shadowed/duplicate declaration of `MAX_MESSAGES_IN_MEMORY` in `ChatScreen.tsx`.

- **UX Fix - All Paid Card**:
  - เมื่อผู้ใช้ไม่มีงวดค้างชำระ และงวดถัดไปยังไม่ถึง threshold จะแสดงการ์ด "ชำระครบแล้ว ยังไม่มีงวดถัดไป" แทนการแสดงงวดเก่าที่จ่ายไปแล้ว (ซึ่งทำให้ผู้ใช้สับสน)
  - แก้ไข `pickNextInstallment` fallback ใน `PaymentHistory.tsx` + เพิ่ม style `allPaidCard` + i18n key `phAllPaid`

---

### ผลการ Test ระบบการเงิน (12 พ.ค. 2569)

**Backend (Code Review)**:
| Module | File | Status |
|--------|------|--------|
| อัปโหลด + ตรวจสลิป (10 ขั้นตอน) | `slipok.js` | ผ่าน |
| สร้าง QR PromptPay + งวดชำระ | `promptpay.js` | ผ่าน |
| รายรับ-รายจ่าย (CRUD/Export/Approval) | `financial.js` | ผ่าน |
| ประวัติการชำระต่อบ้าน | `payments.js` | ผ่าน |

**Frontend (Code Review)**:
| Module | File | Status |
|--------|------|--------|
| แสดงงวดตาม threshold (15d/30d/90d/180d) | `PaymentHistory.tsx` | ผ่าน |
| อัปโหลดสลิป + auto-save receipt + กลับหน้าประวัติ | `Qrcode.tsx` | ผ่าน |
| คำนวณยอดค้าง Home ตาม threshold | `App.tsx` | ผ่าน |

**Test Scenarios (Logic Walkthrough)**:
| # | Scenario | ผลลัพธ์ |
|---|----------|---------|
| 1 | ผู้ใช้ไม่มียอดค้าง - เข้าหน้าประวัติ | เห็น "ชำระครบแล้ว" |
| 2 | ผู้ใช้มียอดค้าง 1 งวด - จ่าย - บันทึกสลิป | กลับหน้าประวัติอัตโนมัติ |
| 3 | ผู้ใช้ราย 3 เดือน, เหลือ 2 เดือน - เข้าหน้าประวัติ | ไม่แสดงงวดถัดไป |
| 4 | ผู้ใช้รายปี, เหลือ 5 เดือน - เข้าหน้าประวัติ | แสดงงวดนี้ (threshold 180 วัน) |
| 5 | ส่งสลิปที่ชื่อผู้รับไม่ตรง | แจ้ง "ชื่อบัญชีผู้รับไม่ตรง" |
| 6 | ส่งสลิปซ้ำ | แจ้ง "สลิปซ้ำ กรุณาแจ้งเจ้าหน้าที่" |
| 7 | QR หมดอายุ - อัปโหลดสลิป | แจ้ง "QR หมดอายุ" + สร้าง QR ใหม่ |

- **Redesign Digital Receipt**: 
  - อัปเดตโครงสร้างภาพ SVG ของใบเสร็จ (สลิปโอนเงิน) ใน `backend/src/routes/slipok.js` ให้ตรงกับดีไซน์ HTML ล่าสุดที่เพิ่มพื้นหลังแยกไฮไลท์ `บ้านเลขที่` ให้ดูสวยงามและชัดเจนมากขึ้น
