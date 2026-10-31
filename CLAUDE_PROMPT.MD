# Project Specification: Family Expense Manager (Offline-First React PWA + Vercel Go Serverless)

## 1. Role & Objective
You are a Staff Full-Stack & Cloud Architect. Build a production-ready, open-source **Family Expense Manager** web application designed to be deployed on **Vercel** with a **Google Drive + Google Sheets** backend.
- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4 + `vite-plugin-pwa` + Dexie.js (IndexedDB) + TanStack Query v5 + Lucide Icons.
- **Backend:** Go (Golang 1.23+) Serverless Functions in `/api/*.go` + Shared internal Go packages in `/pkg/*`.
- **Database & Storage:** Everything lives inside a single user-owned Google Drive folder (`GOOGLE_DRIVE_FOLDER_ID`). A multi-tab Google Sheet (`Expenses_Database`) serves as the relational ledger, and a structured `Receipts/YYYY/MM-Month/` folder tree stores uploaded bills.
- **AI Receipt OCR:** Google Gemini 2.5 Flash API (`gemini-2.5-flash`) parses camera photos, gallery images (`.jpg`, `.png`, `.webp`, `.heic`), and digital invoices (`.pdf`) into structured JSON.

---

## 2. Target Audience & UI/UX Design System
This app will be used daily by a multi-generational household: **Elderly Parents, Kids, and the Admin**.
- **Color Palette (Warm Minimalism):**
  - Primary Background: Warm White (`#F3EDE1`)
  - Secondary Card / Surface: Sand Textile (`#D8C9AE`)
  - Primary Text / Dark Surface: Mocha Walnut (`#4A3728`)
  - Primary Accent / Positive: Olive Sage Green (`#6E7250`)
  - Secondary Accent / Alert: Terracotta (`#A9603F`)
  - Highlight / Badges: Brushed Brass (`#A98545`)
- **Multi-Generational Accessibility Constraints:**
  - Minimum base font size `18px` (`text-lg`), high-contrast AAA text, and minimum touch target size of `56px × 56px` on all interactive buttons.
  - Zero hidden swipe gestures (always render explicit, labeled buttons with icons).
  - **Two Role-Based Modes:**
    1. **Simple Mode (Parents & Kids):** Displays a greeting, 2 giant primary action cards (**"Scan / Attach Bill"** and **"Quick Expense"**), a voice-input mic button, and their last 5 entries with receipt thumbnails.
    2. **Admin Mode:** Full monthly burn-rate progress bars, category breakdowns, family member filter, reimbursable queue, Pairing QR Code modal, and a direct button to open the underlying Google Sheet.

---

## 3. Repository & Directory Structure
Scaffold the exact structure below. Note: Vercel compiles every `.go` file inside `/api` as an isolated Serverless Function entrypoint (`package handler`), so all shared Go code MUST reside inside `/pkg`.

```text
.
├── api/
│   ├── auth.go            # POST /api/auth (Verify family passcode or PIN -> set/verify JWT cookie)
│   ├── bootstrap.go       # POST /api/bootstrap (Auto-create Drive subfolders & Sheet tabs if missing)
│   ├── expenses.go        # GET/POST/DELETE /api/expenses (BatchGet state, Append row, Soft-delete)
│   ├── upload-url.go      # POST /api/upload-url (Generate Google Drive Resumable Upload Session URI)
│   └── ocr.go             # POST /api/ocr (Call Gemini 2.5 Flash multimodal API for receipt extraction)
├── pkg/
│   ├── auth/
│   │   └── jwt.go         # HMAC-SHA256 JWT token signing, cookie parsing, and middleware helper
│   ├── googleclient/
│   │   └── client.go      # OAuth2 Refresh Token -> authenticated Drive v3, Sheets v4 & HTTP clients
│   └── models/
│       └── types.go       # Shared Go structs for Transactions, Categories, Members, OCRResponse
├── src/
│   ├── components/
│   │   ├── GatekeeperModal.tsx   # One-time device pairing passcode / QR token consumer
│   │   ├── ProfileSwitcher.tsx   # Netflix-style large avatar selector with optional 4-digit PIN
│   │   ├── SimpleHome.tsx        # Ultra-clean view for Parents & Kids
│   │   ├── AdminDashboard.tsx    # Analytics, category budgets, filterable ledger, QR generator
│   │   ├── QuickExpenseForm.tsx  # Custom oversized numeric keypad (+50, +100, +500), voice mic, category grid
│   │   ├── BillScanner.tsx       # Camera capture, HEIC/WebP client compression, PDF/CSV/EML handler
│   │   └── ReceiptLightbox.tsx   # In-app modal to preview Drive images/PDFs
│   ├── lib/
│   │   ├── api.ts                # Typed fetch wrappers & direct-to-Drive PUT uploader
│   │   ├── compress.ts           # Canvas image resizer (max 1600px WebP) + heic2any converter + SHA-256 hash
│   │   ├── db.ts                 # Dexie.js IndexedDB schema (offlineQueue, cachedBootstrapData)
│   │   ├── sync.ts               # Offline-to-online sync worker with optimistic UI updates
│   │   └── speech.ts             # Web Speech API parser ("500 rupees for vegetables in cash")
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── scripts/
│   └── init-drive.ts      # Optional CLI bootstrap utility
├── .env.example
├── go.mod
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

---

## 4. Backend Implementation Requirements (Go 1.23+)

### 4.1 Authentication & Security (`pkg/auth/jwt.go` & `api/auth.go`)
- Because this repository is public on GitHub, protect all `/api/*` endpoints using an `httpOnly`, `Secure`, `SameSite=Lax` JWT cookie (`fem_session`, valid for 365 days) signed with `JWT_SECRET`.
- `POST /api/auth` accepts `{ "accessCode": "..." }` (or `?pairToken=...`) and compares it using `subtle.ConstantTimeCompare` against `FAMILY_ACCESS_CODE`. If valid, sets the cookie and returns `{ "authenticated": true }`.
- Every other `/api/*` endpoint must validate this cookie before executing Google API calls.

### 4.2 Google OAuth2 Client (`pkg/googleclient/client.go`)
- Authenticate using `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` via `golang.org/x/oauth2/google`.
- Expose:
  - `NewServices(ctx)` returning `*drive.Service`, `*sheets.Service`, and an authenticated `*http.Client`.
  - Helper `EnsureFolder(ctx, driveSvc, parentID, folderName)` that queries `mimeType='application/vnd.google-apps.folder' and name='...' and '...' in parents and trashed=false` and creates the folder if missing.

### 4.3 Auto-Bootstrap Endpoint (`api/bootstrap.go`)
- Checks inside `GOOGLE_DRIVE_FOLDER_ID` for:
  1. Subfolder `Receipts` -> `<CurrentYear>` -> `<MM-MonthName>` (e.g., `Receipts/2026/10-October`).
  2. Spreadsheet `Expenses_Database` (or uses `GOOGLE_SHEET_ID` if set).
- If the spreadsheet does not exist or lacks tabs, initializes 4 tabs with frozen row 1 headers and default seed data:
  - **`Transactions`**: `ID | Timestamp | Expense_Date | Logged_By | Paid_By | Amount | Currency | Category | Subcategory | Merchant_Note | Payment_Method | Drive_File_ID | Drive_View_URL | Reimbursement_Status | File_Hash`
  - **`Categories`**: `Category_Name | Icon_Emoji | Color_Hex | Monthly_Budget_Limit | Visible_To_Roles`
  - **`Family_Members`**: `Member_ID | Name | Role | Default_Payment_Method | PIN_Code | Avatar_Color`
  - **`Recurring_Rules`**: `Rule_ID | Title | Amount | Category | Frequency | Due_Day_Of_Month | Auto_Remind`

### 4.4 Bypassing Vercel's 4.5MB Payload Limit (`api/upload-url.go`)
- Accepts `{ "fileName": "2026-10-31_Groceries_Dmart_1450.webp", "mimeType": "image/webp", "expenseDate": "2026-10-31" }`.
- Resolves the target `Receipts/YYYY/MM-Month` folder ID in Google Drive.
- Initiates a **Google Drive v3 Resumable Upload Session** (`POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,thumbnailLink`), forwarding the browser's `Origin` header so Google Drive attaches CORS headers for direct browser `PUT` upload.
- Returns `{ "uploadUrl": "...", "folderId": "..." }` to the frontend.

### 4.5 AI Receipt & PDF OCR (`api/ocr.go`)
- Accepts a base64-encoded compressed image or PDF (`<= 3.5MB`) or `driveFileId`.
- Calls Gemini 2.5 Flash (`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY`) with `responseMimeType: "application/json"` and a strict schema:
  ```json
  {
    "merchantName": "string",
    "expenseDate": "YYYY-MM-DD",
    "totalAmount": 0.0,
    "taxAmount": 0.0,
    "currency": "INR",
    "suggestedCategory": "Groceries & Vegetables | Medical & Pharmacy | Utilities & Bills | School & Kids | Household & Help | Dining & Outings | Other",
    "paymentMethod": "UPI | Cash | Card | Bank Transfer",
    "confidence": 0.95,
    "lineItemsSummary": "Short 5-word summary of items"
  }
  ```

### 4.6 Ledger CRUD (`api/expenses.go`)
- `GET /api/expenses`: Uses `Spreadsheets.Values.BatchGet` to retrieve `Transactions!A2:O500`, `Categories!A2:E50`, `Family_Members!A2:F20`, and `Recurring_Rules!A2:G50` in a single round-trip.
- `POST /api/expenses`: Checks `File_Hash` or `(Expense_Date + Amount + Merchant_Note)` within the last 24h to warn on duplicates unless `force=true`, then appends the row to `Transactions!A:O` using `USER_ENTERED`.

---

## 5. Frontend Implementation Requirements (Vite + React + Offline PWA)

1. **Multi-Format Attachment & Compression (`src/lib/compress.ts` & `BillScanner.tsx`):**
   - Support mobile camera (`capture="environment"`), photo gallery (`.jpg`, `.png`, `.webp`, `.heic`, `.heif`), PDF documents (`.pdf`), and raw e-receipts (`.csv`, `.xlsx`, `.eml`, `.txt`).
   - Automatically convert `.heic/.heif` via `heic2any` and compress raster images via HTML5 `<canvas>` to `1600px` max dimension at `0.82` WebP quality (~150–300 KB) before OCR and upload.
   - Compute a SHA-256 hash of the original file via `crypto.subtle.digest` to prevent duplicate uploads.
   - Rename uploaded files cleanly: `YYYY-MM-DD_Category_Merchant_Amount.ext`.
2. **Offline-First IndexedDB Queue (`src/lib/db.ts` & `src/lib/sync.ts`):**
   - Use `Dexie.js` to store pending expenses + file blobs in `offline_queue` whenever `navigator.onLine === false` or an API call fails.
   - Display a reassuring badge ("Saved on phone — will sync to Google Drive when online") so parents never tap Save five times.
   - Auto-sync queued items when the `online` event fires or the app returns to foreground.
3. **Voice Expense Entry (`src/lib/speech.ts`):**
   - Use browser `webkitSpeechRecognition` / `SpeechRecognition` (`en-IN` and `hi-IN` friendly) to parse spoken phrases like *"Paid 450 rupees for medicines by UPI"* into Amount (`450`), Category (`Medical & Pharmacy`), Note (`Medicines`), and Payment Method (`UPI`).

---

## 6. Execution Plan for Claude Code
Execute this build in 5 sequential phases, verifying compilation after each phase:
1. **Phase 1:** Initialize `package.json`, `go.mod`, `vercel.json`, `vite.config.ts`, Tailwind v4 config, and `.env.example`.
2. **Phase 2:** Build `/pkg/models`, `/pkg/auth`, `/pkg/googleclient`, and all 5 Go Serverless Functions in `/api/*.go`. Run `go vet ./...` and `go build ./...` to ensure zero Go compile errors.
3. **Phase 3:** Build the IndexedDB layer (`db.ts`), image/HEIC compression & SHA-256 hashing (`compress.ts`), direct Drive resumable uploader (`api.ts`), and voice parser (`speech.ts`).
4. **Phase 4:** Build the Warm Minimalist UI components (`GatekeeperModal`, `ProfileSwitcher`, `SimpleHome`, `QuickExpenseForm`, `BillScanner`, `AdminDashboard`, `ReceiptLightbox`).
5. **Phase 5:** Run `npm run build` and `go vet ./...`, verify PWA manifest & service worker generation, and create a comprehensive `README.md`.