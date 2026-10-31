package expenses_test

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
)

// receiptHash is the SHA-256 the client computed of the original photo.
const receiptHash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

// uploaded plays `upload-url` plus the browser PUT: a temporary
// `<ID>.jpg` file in the month folder of date. It returns the file's ID.
func uploaded(t *testing.T, f fixture, date string) string {
	t.Helper()
	d, _ := time.Parse(ledger.DateLayout, date)
	month, err := receiptstore.EnsureMonthFolder(context.Background(), f.store, householdID, d)
	if err != nil {
		t.Fatal(err)
	}
	uri, err := f.store.OpenUpload(context.Background(), receiptstore.Upload{FolderID: month.ID, Name: newID + ".jpg", MIMEType: "image/jpeg", Size: 245_000})
	if err != nil {
		t.Fatal(err)
	}
	return f.store.Complete(uri).ID
}

// folderPath is where a file sits, e.g. "Receipts/2026/10-October".
func folderPath(t *testing.T, f fixture, fileID string) string {
	t.Helper()
	file := f.store.FileByID(fileID)
	if file == nil {
		t.Fatalf("no file %s", fileID)
	}
	path, id := "", file.ParentID
	for id != householdID {
		parent, err := f.store.File(context.Background(), id)
		if err != nil {
			t.Fatalf("walking up from %s: %v", fileID, err)
		}
		path = "/" + parent.Name + path
		id = parent.Parents[0]
	}
	return path[1:]
}

func withReceipt(fileID string) map[string]any {
	req := validCreate()
	req["driveFileId"] = fileID
	req["fileHash"] = receiptHash
	return req
}

func TestSavingWithAReceiptRenamesItAndLinksItInTheRow(t *testing.T) {
	f := newFixture(t)
	fileID := uploaded(t, f, "2026-10-30")

	status, body, raw := post(t, f, withReceipt(fileID))

	if status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}
	file := f.store.FileByID(fileID)
	if file.Name != "2026-10-30_Medical-Pharmacy_medicines-for-Papa_450.jpg" {
		t.Errorf("file name = %q, want date_category_merchant_amount.jpg", file.Name)
	}
	if got := folderPath(t, f, fileID); got != "Receipts/2026/10-October" {
		t.Errorf("file is in %s, want Receipts/2026/10-October", got)
	}
	viewURL := "https://drive.google.com/file/d/" + fileID + "/view?usp=drivesdk"
	row := f.ledger.Tab(ledger.Expenses).Rows[0]
	if got := []string{row[11], row[12], row[13]}; !reflect.DeepEqual(got, []string{fileID, viewURL, receiptHash}) {
		t.Errorf("Drive_File_ID, Drive_View_URL, File_Hash = %q", got)
	}
	if body["driveFileId"] != fileID || body["driveViewUrl"] != viewURL || body["fileHash"] != receiptHash {
		t.Errorf("body = %s, want the Receipt fields", raw)
	}
}

func TestTheFinalNameUsesShortASCIISlugs(t *testing.T) {
	f := newFixture(t)
	fileID := uploaded(t, f, "2026-10-30")
	req := withReceipt(fileID)
	req["category"] = "Groceries & Vegetables"
	req["merchantNote"] = "Sri Krishna Sweets & Bakery — Ganesh Nagar"
	req["amount"] = 1234.5

	if status, _, raw := post(t, f, req); status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}

	if got := f.store.FileByID(fileID).Name; got != "2026-10-30_Groceries-Vegetables_Sri-Krishna-Sweets-B_1234.50.jpg" {
		t.Errorf("file name = %q", got)
	}
}

func TestSlugsAreASCIIAndAtMostTwentyCharacters(t *testing.T) {
	for in, want := range map[string]string{
		"Medical & Pharmacy":         "Medical-Pharmacy",
		"  D-Mart, Andheri (W)  ":    "D-Mart-Andheri-W",
		"दूध और ब्रेड":               "",
		"Café Coffee Day":            "Caf-Coffee-Day",
		"abcdefghijklmnopqrstuvwxyz": "abcdefghijklmnopqrst",
		"nineteen-characters x":      "nineteen-characters",
		"=HYPERLINK(\"x\")":          "HYPERLINK-x",
	} {
		if got := receiptstore.Slug(in); got != want {
			t.Errorf("Slug(%q) = %q, want %q", in, got, want)
		}
	}
	if got := receiptstore.FinalName("2026-10-30", "Other", "दूध", 80, "pdf"); got != "2026-10-30_Other_80.pdf" {
		t.Errorf("FinalName with a blank merchant slug = %q, want the part left out", got)
	}
}

func TestAReceiptDatedIntoAnotherMonthMovesToThatMonthsFolder(t *testing.T) {
	f := newFixture(t)
	fileID := uploaded(t, f, "2026-10-01") // shot on the 1st, then the date was changed
	req := withReceipt(fileID)
	req["expenseDate"] = "2026-09-30"

	if status, _, raw := post(t, f, req); status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}

	if got := folderPath(t, f, fileID); got != "Receipts/2026/09-September" {
		t.Errorf("file is in %s, want Receipts/2026/09-September", got)
	}
	if got := f.store.FileByID(fileID).Name; got != "2026-09-30_Medical-Pharmacy_medicines-for-Papa_450.jpg" {
		t.Errorf("file name = %q", got)
	}
}

func TestAFileOutsideTheReceiptStoreIsRefused(t *testing.T) {
	cases := map[string]func(f fixture) string{
		"unknown file ID": func(fixture) string { return "no-such-file-id" },
		"file elsewhere in Drive": func(f fixture) string {
			f.store.AddFile(receiptstore.FakeFile{ID: "tax-return-2025", ParentID: "someone-elses-folder", Name: "tax.pdf", MIMEType: "application/pdf"})
			return "tax-return-2025"
		},
		"file directly in the Household folder": func(f fixture) string {
			f.store.AddFile(receiptstore.FakeFile{ID: "loose-file-1", ParentID: householdID, Name: "loose.jpg", MIMEType: "image/jpeg"})
			return "loose-file-1"
		},
		"a Receipts folder under another root": func(f fixture) string {
			month, _ := receiptstore.EnsureMonthFolder(context.Background(), f.store, "another-household", time.Date(2026, 10, 1, 0, 0, 0, 0, ledger.IST))
			f.store.AddFile(receiptstore.FakeFile{ID: "other-receipt", ParentID: month.ID, Name: "x.jpg", MIMEType: "image/jpeg"})
			return "other-receipt"
		},
		"a trashed Receipt": func(f fixture) string {
			id := uploaded(t, f, "2026-10-30")
			f.store.Files[len(f.store.Files)-1].Trashed = true
			return id
		},
	}
	for name, place := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			fileID := place(f)
			before := f.store.FileByID(fileID)

			status, body, raw := post(t, f, withReceipt(fileID))

			if status != http.StatusUnprocessableEntity || body["code"] != "RECEIPT_NOT_IN_STORE" {
				t.Fatalf("status = %d body = %s, want 422 RECEIPT_NOT_IN_STORE", status, raw)
			}
			if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 0 {
				t.Errorf("appended %q", rows)
			}
			if after := f.store.FileByID(fileID); !reflect.DeepEqual(before, after) {
				t.Errorf("the file was changed: %+v -> %+v", before, after)
			}
		})
	}
}

func TestTheSameReceiptTwiceIsADuplicateUnlessForced(t *testing.T) {
	f := newFixture(t)
	existing := ledger.Expense{
		ID: "0b5c8f9e-1111-4c2a-9d55-0b9e1c3f7a10", CreatedAt: "2026-10-29T19:00:00+05:30", UpdatedAt: "2026-10-29T19:00:00+05:30",
		ExpenseDate: "2026-10-29", LoggedBy: "admin", PaidBy: "admin", Amount: 1250, Currency: "INR",
		Category: "Groceries & Vegetables", MerchantNote: "D-Mart", PaymentMethod: ledger.UPI,
		DriveFileID: "file-earlier", DriveViewURL: "https://drive.google.com/file/d/file-earlier/view", FileHash: receiptHash,
		Reimbursement: ledger.ReimbursementNone, Status: ledger.StatusActive,
	}
	f.ledger.Seed(ledger.Expenses, existing.Row())
	fileID := uploaded(t, f, "2026-10-30")

	status, body, raw := post(t, f, withReceipt(fileID))

	if status != http.StatusConflict || body["code"] != "DUPLICATE_RECEIPT" {
		t.Fatalf("status = %d body = %s, want 409 DUPLICATE_RECEIPT", status, raw)
	}
	dup, _ := body["expense"].(map[string]any)
	if dup["id"] != existing.ID || dup["expenseDate"] != "2026-10-29" || dup["amount"] != 1250.0 {
		t.Errorf("expense = %v, want the Expense that already has this Receipt", body["expense"])
	}
	if msg, _ := body["message"].(string); msg == "" {
		t.Errorf("no message in %s", raw)
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 1 {
		t.Errorf("appended on a duplicate: %q", rows)
	}
	if got := f.store.FileByID(fileID).Name; got != newID+".jpg" {
		t.Errorf("the duplicate upload was renamed to %q before the user chose", got)
	}

	forced := withReceipt(fileID)
	forced["force"] = true
	status, _, raw = post(t, f, forced)

	if status != http.StatusCreated {
		t.Fatalf("forced: status = %d body = %s, want 201", status, raw)
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 2 || rows[1][13] != receiptHash {
		t.Errorf("rows = %q, want the forced Expense appended with its hash", rows)
	}
}

func TestADeletedExpensesReceiptIsNotADuplicate(t *testing.T) {
	f := newFixture(t)
	gone := ledger.Expense{
		ID: "0b5c8f9e-2222-4c2a-9d55-0b9e1c3f7a10", CreatedAt: "2026-10-29T19:00:00+05:30", UpdatedAt: "2026-10-29T19:30:00+05:30",
		ExpenseDate: "2026-10-29", LoggedBy: "admin", PaidBy: "admin", Amount: 1250, Currency: "INR",
		Category: "Groceries & Vegetables", PaymentMethod: ledger.UPI, FileHash: receiptHash,
		Reimbursement: ledger.ReimbursementNone, Status: ledger.StatusDeleted,
	}
	f.ledger.Seed(ledger.Expenses, gone.Row())

	if status, _, raw := post(t, f, withReceipt(uploaded(t, f, "2026-10-30"))); status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}
}

func TestAReplayWithTheReceiptIsAnsweredWithTheStoredRow(t *testing.T) {
	f := newFixture(t)
	fileID := uploaded(t, f, "2026-10-30")
	if status, _, raw := post(t, f, withReceipt(fileID)); status != http.StatusCreated {
		t.Fatalf("first: %d %s", status, raw)
	}

	status, body, raw := post(t, f, withReceipt(fileID))

	if status != http.StatusOK || body["driveFileId"] != fileID {
		t.Errorf("replay: status = %d body = %s, want 200 with the stored row, not a 409 against itself", status, raw)
	}
}

func TestMalformedReceiptFieldsAreRejected(t *testing.T) {
	cases := map[string]map[string]any{
		"hash is not hex SHA-256": {"driveFileId": "file-1", "fileHash": "abc"},
		"hash without a file":     {"fileHash": receiptHash},
		"file ID with a slash":    {"driveFileId": "../../etc", "fileHash": receiptHash},
	}
	for name, patch := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			req := validCreate()
			for k, v := range patch {
				req[k] = v
			}

			status, body, raw := post(t, f, req)

			if status != http.StatusUnprocessableEntity || body["code"] != "INVALID_RECEIPT" {
				t.Errorf("status = %d body = %s, want 422 INVALID_RECEIPT", status, raw)
			}
		})
	}
}

func TestADriveFailureDuringTheRenameAppendsNothing(t *testing.T) {
	f := newFixture(t)
	fileID := uploaded(t, f, "2026-10-30")
	f.store.Err = errors.New("drive: 503 backendError")

	status, body, raw := post(t, f, withReceipt(fileID))

	if status != http.StatusBadGateway || body["code"] != "GOOGLE_ERROR" {
		t.Fatalf("status = %d body = %s, want 502 GOOGLE_ERROR", status, raw)
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 0 {
		t.Errorf("appended %q although the Receipt was not renamed", rows)
	}
}
