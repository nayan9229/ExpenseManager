# Setup & Deployment Guide: Google Cloud Console + Vercel

This guide walks through connecting your **Expense Manager** Google Drive folder to your Vercel deployment using a permanent, non-expiring OAuth 2.0 Refresh Token.

> **Faster:** `bash scripts/setup-wizard.sh` walks you through these same steps one screen at a time, writes `.env` and pushes every variable to Vercel. This page is the same procedure by hand. The full deploy, pairing and Ledger guide is [README.md](README.md).

---

## Step 1: Get Your Google Drive Folder ID

1. Open [Google Drive](https://drive.google.com/) in your browser and open your **`Expense Manager`** folder.
2. Look at the URL in your browser address bar:
   ```text
   https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz123456
   ```
3. Copy the string after `/folders/` — this is your **`GOOGLE_DRIVE_FOLDER_ID`**.

---

## Step 2: Configure Google Cloud Console

### 2.1 Create Project & Enable APIs
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown in the top bar -> **New Project** -> Name it `Family-Expense-Manager` -> Click **Create**.
3. Go to **APIs & Services -> Library** in the left sidebar.
4. Search for and **Enable** these two APIs:
   - **Google Drive API**
   - **Google Sheets API**

### 2.2 Configure OAuth Consent Screen & Publish to Production
> **Why this matters:** Google Cloud projects left in "Testing" mode automatically revoke refresh tokens every **7 days**. Publishing the app to "Production" makes your refresh token permanent. Because only you will ever use this OAuth screen once to generate the token, you do **not** need to submit for Google verification.

1. Go to **APIs & Services -> OAuth consent screen** (or **Google Auth Platform -> Audience**).
2. Select **External** and click **Create**.
3. Fill in the required fields:
   - **App name:** `Family Expense Manager`
   - **User support email:** Your Gmail address
   - **Developer contact information:** Your Gmail address
4. Click **Save and Continue** through the **Scopes** and **Test users** steps.
5. On the **OAuth consent screen / Audience** overview page, under **Publishing status**, click **Publish App** -> Confirm **Push to production**.

### 2.3 Create OAuth 2.0 Credentials
1. Go to **APIs & Services -> Credentials**.
2. Click **+ Create Credentials -> OAuth client ID**.
3. Select **Application type:** `Web application`.
4. Name it `Expense Manager Web Client`.
5. Under **Authorized redirect URIs**, click **+ Add URI** and paste:
   ```text
   https://developers.google.com/oauthplayground
   ```
6. Click **Create**.
7. Copy your **Client ID** (`GOOGLE_CLIENT_ID`) and **Client Secret** (`GOOGLE_CLIENT_SECRET`).

---

## Step 3: Generate Your Permanent `GOOGLE_REFRESH_TOKEN`

1. Open the [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the **Gear icon (OAuth 2.0 Configuration)** in the top-right corner:
   - Check **"Use your own OAuth credentials"**.
   - Paste your **OAuth Client ID** and **OAuth Client Secret**.
   - Click **Close**.
3. On the left panel under **Step 1 (Select & authorize APIs)**, scroll to the bottom box (*"Input your own scopes"*) and paste:
   ```text
   https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets
   ```
4. Click **Authorize APIs**:
   - Sign in with the Google account that owns the `Expense Manager` folder.
   - When prompted with *"Google hasn't verified this app"*, click **Advanced** -> **Go to Family Expense Manager (unsafe)** -> **Continue**.
5. In **Step 2 (Exchange authorization code for tokens)**, click **Exchange authorization code for tokens**.
6. Copy the **`refresh_token`** value (starts with `1//0...`). This is your **`GOOGLE_REFRESH_TOKEN`**.

---

## Step 4: Get a Gemini API Key (For Receipt & PDF OCR), with billing on

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API Key** and select your `Family-Expense-Manager` Google Cloud project.
3. Copy the key (starts with `AIza`): this is your **`GEMINI_API_KEY`**.
4. **Enable billing on that project before scanning real receipts** (Tier 1, $5 prepay; see the [billing page](https://ai.google.dev/gemini-api/docs/billing)). On the free tier Google may use prompts and answers to improve its products and human reviewers may read them; on the paid tier it does not. A receipt costs well under $0.01.
5. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`; `gemini-3.8-flash` reads more accurately and costs more).

---

## Step 5: Local Development & Bootstrap

1. Copy `.env.example` to `.env` in the root of the project (never committed to Git; `vercel dev` reads `.env`, not `.env.local`) and fill in every value:
   ```ini
   # Google OAuth2 Credentials
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-your-client-secret"
   GOOGLE_REFRESH_TOKEN="1//0g-your-permanent-refresh-token"

   # Google Drive & Sheets IDs (use a separate folder for development)
   GOOGLE_DRIVE_FOLDER_ID="your-expense-manager-folder-id"
   GOOGLE_SHEET_ID=""

   # Gemini Vision OCR
   GEMINI_API_KEY="AIzaSy-your-gemini-api-key"

   # Family Security & Device Pairing
   FAMILY_ACCESS_CODE="choose-a-secret-family-passphrase"
   JWT_SECRET="generate-a-random-32-char-secret-string"
   ```
2. Run `vercel dev --listen 3000`, open http://localhost:3000 and pair with the Access Code. The first paired device runs Bootstrap by itself: it creates the `Receipts` folder and the `Expenses_Database` Ledger (four tabs, headers, seven Categories and an `admin` Member) inside your folder. There is nothing to run by hand, and running it again changes nothing. To watch it directly: `curl -c jar -X POST -H 'Content-Type: application/json' -d '{"accessCode":"..."}' http://localhost:3000/api/pair && curl -b jar -X POST http://localhost:3000/api/bootstrap`.
3. Open the Ledger (the app links to it from the profile switcher) and set the Admin's PIN: Members tab, `PIN_Code` cell of the `admin` row, four digits. Optionally copy the Ledger's ID from its URL into `GOOGLE_SHEET_ID` so the functions skip the folder lookup.

---

## Step 6: Deploy to Vercel

Follow [README.md, "Deploy to Vercel"](README.md#deploy-to-vercel). In short: `vercel link --yes --project family-expenses`, add **every** variable of [README.md, "Environment variables"](README.md#environment-variables) (`FAMILY_ACCESS_CODE`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_SHEET_ID` if used, `GEMINI_API_KEY`, `GEMINI_MODEL`) to **both Production and Preview**, then `vercel deploy --prod`. A variable added after a deploy needs a new deploy.

---

## Step 7: Onboard Family Devices (Parents & Kids)

Follow [README.md, "First pairing"](README.md#first-pairing). In short:

1. Pair your own phone with the `FAMILY_ACCESS_CODE` (on an iPhone: Add to Home Screen first, then pair inside the installed app). This first pairing runs Bootstrap.
2. Set your Admin PIN in the Ledger (Members tab, `PIN_Code` of the `admin` row), then tap the Admin avatar and type it.
3. In Admin Mode tap **Pair a device**: a QR code and a Pair Code.
   - **Android (Chrome):** scan the QR (it pairs at once); then tap **Install the app** when the app offers it, or Chrome's menu `⋮` -> **Install app / Add to Home screen**.
   - **iPhone/iPad:** in Safari tap **Share** -> **Add to Home Screen** -> **Add**, open **Expenses** from the Home Screen and **type the Pair Code** there (a QR scanned with the camera pairs Safari only, not the Home Screen app).
