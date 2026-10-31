# Family Expense Manager

A household expense ledger used daily by a multi-generational family, stored entirely in the Admin's Google Drive.

## Language

### People

**Household**:
The family unit whose spending the app tracks. One Household per deployment.
_Avoid_: family, group, team

**Member**:
A person in the Household who logs Expenses. Every Member has a Role.
_Avoid_: profile, user, family member, account

**Role**:
A Member's permission tier: `admin`, `parent`, or `kid`.

**Admin**:
The Role that owns the Google account and the Ledger and can enter Admin Mode.
_Avoid_: owner, superuser, parent (when meaning the admin)

**PIN**:
A 4-digit code a Member types to select themselves on a shared device. Required for Admins, optional for others.
_Avoid_: password, passcode

### Money

**Expense**:
One spend event recorded in the Ledger.
_Avoid_: transaction, entry, record, item

**Quick Expense**:
An Expense logged by hand without a Receipt.

**Category**:
One of the Household's spending buckets. Each has a monthly Budget and a list of Roles that can see it.

**Budget**:
The monthly spending limit on a Category.

**Burn Rate**:
Spend so far in the current calendar month as a fraction of Budget.

**Payment Method**:
How an Expense was paid: UPI, Cash, Card, or Bank Transfer.

**Logged By**:
The Member who recorded the Expense.

**Paid By**:
The Member whose money paid for the Expense. Defaults to Logged By.

**Reimbursement**:
Money the Household owes a Member who paid from their own pocket. Each Expense's Reimbursement is `none`, `pending`, or `done`.
_Avoid_: refund, settlement, payback

**Reimbursable Queue**:
The Admin's list of Expenses whose Reimbursement is `pending`.

**Recurring Rule**:
A known monthly expense (rent, school fee) the Admin expects to see logged each month.
_Avoid_: subscription, scheduled expense

### Receipts

**Receipt**:
The image or PDF attached to an Expense as proof.
_Avoid_: bill, invoice, attachment, scan (as a noun)

**Receipt Store**:
The `Receipts/YYYY/MM-Month` folder tree in Google Drive.

**Scan**:
Capturing or picking a Receipt and running it through OCR.

**OCR**:
Extracting structured fields (merchant, date, amount, category, payment method) from a Receipt via the Gemini API.
_Avoid_: AI parse, extraction, recognition

### Data

**Ledger**:
The Google Sheet holding all Expenses plus the Members, Categories, and Recurring Rules tabs.
_Avoid_: database, spreadsheet, sheet (in code and docs)

**Bootstrap**:
Ensuring the Receipt Store and Ledger exist with the expected tabs, headers, and seed rows.

**Soft Delete**:
Marking an Expense `deleted` in the Ledger rather than removing its row.

### Devices and access

**Pairing**:
Granting a device a long-lived Session so it can use the app.
_Avoid_: login, sign-in, authentication

**Access Code**:
The shared Household secret typed on a device to pair it.
_Avoid_: passcode, password, family code

**Pair Token**:
A short-lived secret minted by an Admin that pairs a device without typing the Access Code. Shown both as a QR code link and as a Pair Code.

**Pair Code**:
The 8-character typeable form of a Pair Token, for devices where a QR link cannot pair the installed app.

**Session**:
The year-long cookie a paired device holds. It identifies the device, never a Member.

**Gatekeeper**:
The screen an unpaired device sees. It accepts an Access Code or a Pair Token.

### Modes

**Simple Mode**:
The parent and kid view: greeting, Scan, Quick Expense, mic, and the Member's last five Expenses.

**Admin Mode**:
The Admin view: Burn Rate bars, Category breakdown, Member filter, Reimbursable Queue, pairing QR, and a link to the Ledger.

### Offline

**Offline Queue**:
Expenses, edits, deletes, and Receipts saved on the device while offline, waiting to Sync.
_Avoid_: outbox, pending list, cache

**Sync**:
Replaying the Offline Queue to the server once the device is online.
