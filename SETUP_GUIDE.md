# Setup & Deployment Guide: Google Cloud Console + Vercel

This guide walks through connecting your **Expense Manager** Google Drive folder to your Vercel deployment using a permanent, non-expiring OAuth 2.0 Refresh Token.

---

## Step 1: Get Your Google Drive Folder ID

1. Open [Google Drive](https://drive.google.com/) in your browser and open your **`Expense Manager`** folder.
2. Look at the URL in your browser address bar:
   ```text
   [https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz123456](https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz123456)
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
   [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
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
   [https://www.googleapis.com/auth/drive](https://www.googleapis.com/auth/drive) [https://www.googleapis.com/auth/spreadsheets](https://www.googleapis.com/auth/spreadsheets)
   ```
4. Click **Authorize APIs**:
   - Sign in with the Google account that owns the `Expense Manager` folder.
   - When prompted with *"Google hasn't verified this app"*, click **Advanced** -> **Go to Family Expense Manager (unsafe)** -> **Continue**.
5. In **Step 2 (Exchange authorization code for tokens)**, click **Exchange authorization code for tokens**.
6. Copy the **`refresh_token`** value (starts with `1//0...`). This is your **`GOOGLE_REFRESH_TOKEN`**.

---

## Step 4: Get a Free Gemini API Key (For Receipt & PDF OCR)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API Key** and select your `Family-Expense-Manager` Google Cloud project.
3. Copy the key — this is your **`GEMINI_API_KEY`**.

---

## Step 5: Local Development & Folder Bootstrap

1. Create a `.env.local` file in the root of your project (never committed to Git):
   ```ini
   # Google OAuth2 Credentials
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-your-client-secret"
   GOOGLE_REFRESH_TOKEN="1//0g-your-permanent-refresh-token"

   # Google Drive & Sheets IDs
   GOOGLE_DRIVE_FOLDER_ID="your-expense-manager-folder-id"
   GOOGLE_SHEET_ID=""

   # Gemini Vision OCR
   GEMINI_API_KEY="AIzaSy-your-gemini-api-key"

   # Family Security & Device Pairing
   FAMILY_ACCESS_CODE="choose-a-secret-family-passphrase"
   JWT_SECRET="generate-a-random-32-char-secret-string"
   ```
2. Run the initialization script once to create the `Expenses_Database` Google Sheet and `Receipts/YYYY/MM` subfolders inside your `Expense Manager` folder:
   ```bash
   npx tsx scripts/init-drive.ts
   ```
3. Copy the `GOOGLE_SHEET_ID` printed in your terminal and paste it into `.env.local`.

---

## Step 6: Deploy to Vercel

1. Push your repository to GitHub (confirm `.env.local` is listed in `.gitignore`).
2. Go to [Vercel Dashboard](https://vercel.com/new) and import your GitHub repository.
3. Framework Preset: **Vite** (Vercel automatically detects `/api/*.go` as Go Serverless Functions alongside Vite).
4. Expand **Environment Variables** and add all 7 variables from your `.env.local`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `GOOGLE_SHEET_ID`
   - `GEMINI_API_KEY`
   - `FAMILY_ACCESS_CODE`
   - `JWT_SECRET`
5. Click **Deploy**.

---

## Step 7: Onboard Family Devices (Parents & Kids)

1. Open your deployed Vercel URL on your phone, enter your `FAMILY_ACCESS_CODE`, and select **Admin**.
2. Open the **Pair Family Device** modal to display the pairing QR code.
3. Scan the QR code with your parents' and kids' phones:
   - **On Android (Chrome):** Tap the banner or menu (`⋮`) -> **Add to Home screen / Install app**.
   - **On iPhone/iPad (Safari):** Tap the **Share** icon -> **Add to Home Screen**.
4. Select their profile card on their phone once—the app will remember their profile and work both online and offline.