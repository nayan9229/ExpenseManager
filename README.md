# Family Expenses

A phone-first expense ledger for one Household. Parents and kids log a spend
in a few seconds on their own phones (even with no signal); the Admin sees the
month at a glance. Every Expense lands in a Google Sheet (the **Ledger**) and
every Receipt in a Drive folder tree (the **Receipt Store**), both inside the
Admin's own Google account. There is no database, no per-person Google sign-in
and nothing to pay for beyond a few paise of Gemini OCR per receipt.

It is an installable web app (PWA): a Vite + React front end and seven small Go
functions on Vercel that hold the Admin's Google credentials. The vocabulary
used below (Member, Session, Pair Code, Offline Queue, ...) is defined in
[GLOSSARY.md](GLOSSARY.md).

## The two modes

**Simple Mode** (parents and kids). A greeting with the Member's name, two
giant buttons, **Scan Receipt** and **Quick Expense**, a mic button where the
browser can listen, and the Member's own last five Expenses with Receipt
thumbnails. Quick Expense is an amount keypad (digits, +50, +100, +500), a
Category grid filtered by the Member's Role, Payment Method chips, Today /
Yesterday / a date, a note and an "I paid from my own pocket" switch. Scan
Receipt takes a photo (or a gallery image or PDF), shrinks it on the phone,
uploads it straight to Drive and lets Gemini fill in the form, including the
Receipt Number printed on the Receipt; the Member only checks and taps Save. The same
Receipt added twice (the same file, or the same Receipt Number and amount) gets an
"already added … Add anyway" warning. Tapping an Expense opens it to fix or delete. With no
signal, a save waits on the phone ("Saved on phone") and Syncs by itself when
the phone is back online. Text is 18px or larger, every button at least 56px.

**Admin Mode** (the Admin, behind a 4-digit PIN). Burn Rate bars per Category
for the month (terracotta when over Budget) and a Household total, a Category
breakdown, a Member filter, each Expense's Receipt Number under its note, month-to-month navigation, the Reimbursable Queue
grouped by Member with "Mark done", a "Due this month, not logged" card from
the Recurring Rules with one-tap prefill, and buttons to open the Ledger,
Repair (re-run Bootstrap), Pair a device (QR + Pair Code), Scan Receipt, Quick
Expense and Switch Member. Admin Mode closes after five minutes in the
background and asks for the PIN on every entry.

## What a new Admin does, in order

1. Google Cloud setup: Drive folder, OAuth client, refresh token, Gemini key
   with billing ([below](#google-cloud-setup)).
2. Deploy to Vercel with the environment variables ([below](#deploy-to-vercel)).
3. Pair your own phone, set your Admin PIN, then pair the family
   ([below](#first-pairing)).
4. Adjust Members, Categories, Budgets and Recurring Rules in the Ledger
   ([below](#managing-the-ledger)).

## Google Cloud setup

Run the setup wizard from the repository root. It opens each console page,
tells you what to click, checks what you paste, writes `.env` (mode 0600),
generates the Access Code and JWT secret, links the Vercel project and pushes
every variable to Vercel Production and Preview. It is safe to re-run: Enter
keeps every saved value.

```sh
bash scripts/setup-wizard.sh
# another Vercel project or team:
VERCEL_PROJECT=my-expenses VERCEL_SCOPE=my-team bash scripts/setup-wizard.sh
```

The same procedure by hand is [SETUP_GUIDE.md](SETUP_GUIDE.md). In short:

1. A Drive folder (e.g. `Expense Manager`) whose ID becomes
   `GOOGLE_DRIVE_FOLDER_ID`. Use a **separate** folder for local development.
2. A Google Cloud project with the **Google Drive API** and **Google Sheets
   API** enabled.
3. The OAuth consent screen **published to production**. A project left in
   "Testing" revokes its refresh token after 7 days.
4. A Web-application OAuth client with the redirect URI
   `https://developers.google.com/oauthplayground`.
5. A refresh token from the OAuth Playground for the folder owner's account
   with exactly the scopes `https://www.googleapis.com/auth/drive` and
   `https://www.googleapis.com/auth/spreadsheets` (`drive.file` cannot write
   into a folder you made yourself).
6. A Gemini API key created in the same project, with billing on (next
   section).

### Gemini billing and privacy

Receipt OCR sends the Receipt image or PDF to the Gemini API. **Enable billing
on the key's Google Cloud project before scanning real receipts** (Tier 1, a
$5 prepay). On the free tier Google may use prompts and answers to improve its
products and human reviewers may read them; on the paid tier it does not
([Gemini API terms](https://ai.google.dev/gemini-api/terms)). Every request also sends `"store": false`, so Gemini API request
logging is off. A receipt costs well under $0.01. Gemini's terms describe the
API as not for consumer use and not for apps aimed at under-18s; this is a
personal family tool run by the Admin, and the Admin accepts that.

Without `GEMINI_API_KEY` everything else works: OCR answers
`SERVER_MISCONFIGURED` and the phone shows an empty form to fill by hand.

## Environment variables

Every variable is read by the Go functions on each request. Set them for
**Production and Preview** in Vercel, and in `.env` for local development.
[.env.example](.env.example) holds the same list with longer notes; a test
(`scripts/envDocs.test.ts`, part of `npm test` and CI) keeps this table,
`.env.example` and the Go code in step.

| Variable | Required | What it is |
|---|---|---|
| `FAMILY_ACCESS_CODE` | yes | The Household secret typed on a device to pair it. **At least 10 characters** (`pair` refuses to pair with a shorter one); it is the only thing between a stranger and the Ledger. Changing it does not unpair anyone. |
| `JWT_SECRET` | yes | Signs Session cookies and Pair Codes. At least 32 characters (`openssl rand -base64 32`). **Rotating it unpairs every device**, which is how a lost phone is cut off. |
| `GOOGLE_CLIENT_ID` | yes | The OAuth client ID (`...apps.googleusercontent.com`). |
| `GOOGLE_CLIENT_SECRET` | yes | The OAuth client secret. |
| `GOOGLE_REFRESH_TOKEN` | yes | Long-lived refresh token (starts `1//`) for the Admin's account with the `drive` and `spreadsheets` scopes. |
| `GOOGLE_DRIVE_FOLDER_ID` | yes | The Drive folder that holds the Ledger and the Receipt Store. |
| `GOOGLE_SHEET_ID` | no | ID of an existing Ledger (the ID in its Google Sheets URL). Blank: Bootstrap finds or creates `Expenses_Database` inside the folder. |
| `GEMINI_API_KEY` | for OCR | Gemini API key for Receipt OCR, on a project with billing enabled. |
| `GEMINI_MODEL` | no | Gemini model ID; blank means `gemini-3.5-flash-lite`. `gemini-3.8-flash` is the higher-accuracy option; `gemini-2.5-*` is only served to projects that used it before. |

A missing required variable never crashes anything: the function that needs
it answers 500 `SERVER_MISCONFIGURED` naming what is missing, and the app shows
"The server is not set up yet".

## Deploy to Vercel

The app runs on the free **Hobby** plan: seven functions (Hobby allows twelve),
one region, **`bom1` (Mumbai)**, set in [vercel.json](vercel.json) together
with a 60 s max duration for the Go functions and the SPA rewrite. Do not add
a `builds` section.

1. Install the CLI and log in: `npm i -g vercel`, `vercel login`.
2. In the repository root, link (or create) the project:
   `vercel link --yes --project family-expenses` (add `--scope <team>` if the
   CLI asks for a team; non-interactive runs always need it).
   `vercel link` may append `.env*` to `.gitignore`; undo that
   (`git checkout .gitignore`), the existing rules already cover `.env` and
   `.env*` would hide `.env.example`.
3. Add every variable to **both** Production and Preview. The wizard does it;
   by hand, for each name in the table:
   `printf '%s' "$VALUE" | vercel env add NAME production` and again with
   `preview`. Check with `vercel env ls`.
   **The current production deployment has no variables at all**, so until
   this step `/api/pair` there answers `SERVER_MISCONFIGURED` and no phone can
   pair.
4. Deploy: `vercel deploy --prod`. A variable added later only reaches a new
   deployment, so redeploy after every change. (Connecting the GitHub
   repository in the Vercel dashboard makes every push to `master` a
   production deploy and every other branch a preview.)
5. Check it: open `https://<your-project>.vercel.app/api/pair`; it must answer
   `{"paired":false}`.

Preview URLs (`<project>-<hash>-<team>.vercel.app`) sit behind Vercel
Authentication: they open only in a browser logged in to Vercel, so a QR code
from a preview shows a Vercel login page on a family phone. Pair real devices
against the production URL.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `go vet`,
`go test`, the type-check, Vitest and the production build on every push and
pull request.

## First pairing

A device is paired once and stays paired for a year (an httpOnly `fem_session`
cookie). Pairing proves only that the device belongs to the Household; who is
using it is picked on the device.

1. **Your own phone first.** Open the production URL, type the
   `FAMILY_ACCESS_CODE` under "Or the Household Access Code" and tap "Pair
   with the Access Code". The first paired device runs **Bootstrap**: it
   creates the `Receipts` folder and the `Expenses_Database` Ledger (four
   tabs with headers, eight Categories, one `admin` Member) in your Drive
   folder. Bootstrap is safe to run again ("Repair" in Admin Mode does): it
   recreates a missing tab, freezes row 1, writes the headers into a tab
   whose row 1 is empty, adds headers missing only from the end of row 1 (a
   Ledger made by an older version gets its new columns this way), and never
   overwrites a row 1 that differs otherwise; Repair names that tab and the
   headers it expects.
2. **On an iPhone, install first, then pair inside the installed app.** iOS
   keeps the Home Screen app's storage apart from Safari, so a pairing done in
   Safari does not carry over. In Safari: Share, Add to Home Screen, Add; open
   **Expenses** from the Home Screen and pair there. The app shows these steps
   in Safari before pairing, and again in Simple Mode on a phone that was
   paired in Safari (until dismissed). On Android, Chrome's installed app
   shares Chrome's cookies, so pairing in either is enough; the pairing screen
   and Simple Mode offer an "Install the app" button when Chrome allows it
   (after a tap and about 30 s on the page), otherwise use Chrome's menu,
   Install app.
3. **Set your Admin PIN** (next section), then tap the Admin avatar and type it.
4. **Pair the family** from Admin Mode, "Pair a device": a QR code and an
   8-character Pair Code (`XXXX-XXXX`, valid 10 to 20 minutes, Refresh for a
   new one). On Android, scanning the QR pairs the phone at once. On an
   iPhone, the camera opens the QR link in Safari (which pairs Safari, not the
   Home Screen app): install first as above, then **type the Pair Code** in
   the installed app. The Access Code still works everywhere as a fallback.
5. On each phone, tap the Member's avatar once; the phone remembers it.

## Managing the Ledger

v1 has no admin forms: the Admin edits the Ledger in Google Sheets ("Open the
Ledger" in Admin Mode or on the Member picker). Column order is the
contract: never reorder or rename columns, only append new ones on the right.
Blank or malformed cells are tolerated (the row is skipped or defaulted). The
app picks up edits on its next refresh (within a minute, or on reopening).

**Members** tab: `Member_ID`, `Name`, `Role`, `Default_Payment_Method`,
`PIN_Code`, `Avatar_Color`.

- `Member_ID` is a short slug you choose (`mom`, `papa`, `riya`); Expenses
  store it in `Logged_By` and `Paid_By`, so do not change it once used (an
  unknown ID shows as "Unknown").
- `Role` is `admin`, `parent` or `kid` (anything else reads as `kid`).
- `Default_Payment_Method` is `UPI`, `Cash`, `Card` or `Bank Transfer`.
- `Avatar_Color` is `#RRGGBB`.
- **Setting the Admin PIN:** type four digits in the `PIN_Code` cell of the
  `admin` row (the column is plain text, so a leading `0` is kept). An Admin
  with a blank PIN cannot enter Admin Mode; the app says so. A PIN is optional
  for other Members (with one, their avatar asks for it). The PIN never leaves
  the server, only a hash of it. Anyone who can open the Ledger can read it,
  so share the Ledger with nobody.

**Categories** tab: `Category_Name`, `Icon_Emoji`, `Color_Hex`,
`Monthly_Budget_Limit`, `Visible_To_Roles`.

- `Monthly_Budget_Limit` is the **Budget** in rupees; `0` means no Burn Rate
  bar. The Household total bar is the sum of the Budgets.
- `Visible_To_Roles` is `all` or a comma-separated list of roles
  (`parent,admin`); a kid never sees a Category not visible to `kid`.
- Renaming a Category does not rename it on past Expenses (they keep the old
  name in the `Category` column).
- Receipt OCR picks from exactly the Categories in this tab, read on every
  Scan. When none fits it uses `Other` if the tab has it; otherwise it leaves
  the Category empty and the form asks the Member to pick one.
- A new Ledger starts with eight Categories (Budget `0`, visible to `all`):

  | Category_Name | Icon_Emoji | Color_Hex |
  | --- | --- | --- |
  | Groceries & Vegetables | 🥬 | `#6E7250` |
  | Medical & Pharmacy | 💊 | `#A9603F` |
  | Utilities & Bills | 💡 | `#A98545` |
  | School & Kids | 🎒 | `#4A3728` |
  | Household & Help | 🧹 | `#D8C9AE` |
  | Dining & Outings | 🍽️ | `#A9603F` |
  | Petrol & Transport | 🚗 | `#A98545` |
  | Other | 📦 | `#6E7250` |

- **Adding Petrol & Transport to an existing Ledger.** Bootstrap seeds
  Categories only into an empty tab, so a Ledger made before this Category
  existed does not get it by itself. Add a row by hand: `Petrol & Transport`,
  `🚗`, `#A98545`, `0`, `all` (put it above `Other` to keep that last). Voice
  entry then maps petrol, diesel, CNG, fuel, parking, toll, auto, rickshaw,
  cab, taxi, Uber, Ola and Rapido to it, and Receipt OCR can pick it.

**Recurring_Rules** tab: `Rule_ID`, `Title`, `Amount`, `Category`,
`Due_Day_Of_Month` (1 to 31; monthly only). Each rule appears in Admin Mode's
"Due this month, not logged" card until it is logged for the month: an
Expense in that Category whose note contains the Title (any case) or whose
Amount equals the rule's. Other spend in the Category does not count. One tap
prefills Quick Expense with its Amount, Category and the Title as the note, so
saving it as prefilled always counts. There are no reminders or push
notifications.

**Expenses** tab: `ID`, `Created_At`, `Updated_At`, `Expense_Date`,
`Logged_By`, `Paid_By`, `Amount`, `Currency`, `Category`, `Merchant_Note`,
`Payment_Method`, `Drive_File_ID`, `Drive_View_URL`, `File_Hash`,
`Reimbursement_Status`, `Status`, `Receipt_Number`. Written by the app; edit it
by hand only to fix data. A delete in the app sets `Status` to `deleted` (the
row stays). `Reimbursement_Status` is `none`, `pending` or `done`.
`Receipt_Number` (column Q) is the number the merchant printed on the Receipt,
at most 40 characters, always stored as text (`004521` keeps its zeros); blank
means none. It is set from the Scan form and the Edit screen, never by Quick
Expense or voice. A Ledger made by an older version has no column Q: run
**Repair** in Admin Mode once and it adds the `Receipt_Number` header; older
rows read as having no Receipt Number.

## Local development

Requirements: Node 24 / npm 11, Go 1.26, the Vercel CLI. Use a separate
development Drive folder; there are no mocked Google services outside the
tests.

```sh
npm ci
bash scripts/setup-wizard.sh   # or copy .env.example to .env and fill it
vercel dev --listen 3000       # Vite + the Go functions on one origin
```

Open http://localhost:3000 and pair with the Access Code. `npm run dev` on
its own (port 5173) proxies `/api` to a running `vercel dev`.

Four traps, all already handled in the repository; keep them that way:

1. **Vite must listen on `$PORT`.** `vercel dev` starts `npm run dev` and waits
   on the port it passes in `PORT`; `vite.config.ts` sets `server.port` from it.
   Without that: "Failed to detect a server running on port ...".
2. **Keep Vite's watcher out of `.vercel/`.** `vercel dev` downloads a whole
   Go toolchain into `.vercel/cache/golang` on first start (a few minutes);
   `server.watch.ignored` keeps Vite from reloading on (and reading a
   `tsconfig.json` inside) it.
3. **`package handler` is line 1 of every file in `api/`.** The dev server
   rewrites the first `package <word>` it finds in the file to `package main`;
   a doc comment above the package clause that contains "Package handler"
   gets rewritten instead and every `/api/*` call answers 502
   `NO_RESPONSE_FROM_FUNCTION`. Comments go below the package clause.
4. **`vercel dev` reads `.env`, not `.env.local`.** `vercel env pull` and
   `vercel link` write `.env.local`, which the Go functions never see. Keep
   the values in `.env` (git-ignored).

The local pipeline, the same as CI:

```sh
go vet ./... && go test ./... && npm run typecheck && npm test && npm run build
```

Backend tests drive the HTTP handlers against in-memory fakes of the three
seams (`Ledger`, `ReceiptStore`, `OCR`); frontend tests drive library
functions and the Dexie layer (fake-indexeddb). There are no component tests;
the UI is checked by hand on a real Android phone and a real iPhone.

### The one-time upload proof

Receipts are uploaded by the browser straight to a Drive resumable session.
That this cross-origin PUT works on the deployed origin has not been checked
live yet (no credentials existed while building). The throwaway page
`scripts/receipt-upload-proof.html` checks it. It is **not** in a normal
build; it ships only when the build is asked for it:

1. With the Google variables set for Preview, deploy a preview that includes
   it: `vercel deploy --yes --build-env INCLUDE_RECEIPT_PROOF=1`.
2. Open `https://<that preview>/receipt-upload-proof.html` in a browser logged
   in to Vercel (Chrome, and Safari on an iPhone if you can). If the browser is
   not paired, type the Access Code and tap "Pair this browser". Tap "Run the
   proof" (optionally pick a real receipt first).
3. Pass: the log ends with `PASS: browser PUT succeeded cross-origin, Drive
   file id ...`. Fail: `PUT threw TypeError ...`; DevTools > Network shows
   whether the preflight or the PUT lacked `Access-Control-Allow-Origin`, and
   the fallback (proxying files under 4 MB through `upload-url`) must be
   built.
4. Record the result in ticket 06, delete the test file from Drive, and
   delete `scripts/receipt-upload-proof.html` and the `receiptUploadProof`
   plugin in `vite.config.ts`.

## Offline and updates

The service worker precaches the app shell (HTML, JS, CSS, icons, manifest)
so the app opens with no signal; it never caches `/api/*`. Offline data comes
from the phone's IndexedDB: the last loaded Expenses and the Offline Queue,
which Syncs when the phone is back online or the app returns to the
foreground. The 3 MB HEIC converter is not precached; it is cached the first
time an iPhone HEIC photo is converted online.

A new deploy is picked up when the app is opened or brought back to the
foreground (and hourly while open). The new version takes over at once; the
page reloads the next time the app goes to the background with no form open,
and the home screens show "A new version of the app is ready" with "Reload
now" in the meantime. Nobody is left on an old version, and a half-typed
Expense is never lost to an update. (An Admin in Admin Mode who backgrounds
the app right after a deploy is asked for the PIN again.)

## Known limitations

- **No voice entry in an iPhone Home Screen app.** iOS does not expose speech
  recognition to Home Screen web apps (WebKit bug 225298), so the mic is not
  shown there. It works in iPhone Safari (with Siri & Dictation on) and in
  Chrome on Android, in English (India) or Hindi (India); Hindi number words
  are not understood.
- **Receipt preview capped at 4 MB.** Receipts are shown through the app's
  own `receipt` function, which serves files up to 4 MB (Vercel's response
  limit). A larger file (usually a big PDF) shows its thumbnail and
  an "Open in Google Drive" link. Photos taken in the app are shrunk to about
  300 KB, so this only affects large PDFs.
- **OCR file-size edge.** OCR refuses files over 20 MB. Base64 makes the
  request about 4/3 of the file, so a PDF between about 15 and 20 MB may go
  over Gemini's inline limit; the phone then says "Could not read the
  receipt. Please fill in the details." and the form is filled by hand.
- **No push reminders.** Recurring Rules appear only in Admin Mode's "Due this
  month, not logged" card; nothing is scheduled or sent.
- **Trust is per device, not per person.**
  Any paired phone can act as any Member, and the Admin PIN is checked on the
  phone only. Do not pair a device outside the family; rotate `JWT_SECRET` to
  unpair every device (a lost phone), then pair the others again.
- An iPhone paired by scanning the QR in Safari is paired in Safari only; the
  Home Screen app needs the typed Pair Code (above). Safari also clears a
  site's offline data after 7 days without use, which the Home Screen app does
  not.
- One Household per deployment, rupees only, IST only, English UI.
- Receipts of abandoned scans stay in Drive under their temporary
  `<ID>.jpg` name; nothing cleans them up.

## Repository layout

- `api/` one file per Vercel function (`pair`, `pair-token`, `bootstrap`,
  `expenses`, `upload-url`, `ocr`, `receipt`), each a thin wrapper.
- `pkg/` the Go code and its tests.
- `src/` the React app; `src/lib/` holds the tested logic.
- `scripts/` the setup wizard, the env-list check, the upload proof page.

## License

[LICENSE](LICENSE).
