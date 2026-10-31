package expenses_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

const newID = "6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10"

// validCreate is what the Quick Expense form sends for ₹450 of medicines.
func validCreate() map[string]any {
	return map[string]any{
		"id":            newID,
		"expenseDate":   "2026-10-30",
		"loggedBy":      "ramesh",
		"amount":        450,
		"category":      "Medical & Pharmacy",
		"merchantNote":  "medicines for Papa",
		"paymentMethod": "Cash",
	}
}

func post(t *testing.T, f fixture, body any) (int, map[string]any, string) {
	t.Helper()
	var raw []byte
	switch b := body.(type) {
	case string:
		raw = []byte(b)
	default:
		raw, _ = json.Marshal(b)
	}
	req, _ := http.NewRequest(http.MethodPost, f.srv.URL+"/api/expenses", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(pairedCookie(t))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	return decode(t, res)
}

func decode(t *testing.T, res *http.Response) (int, map[string]any, string) {
	t.Helper()
	out, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	_ = json.Unmarshal(out, &decoded)
	return res.StatusCode, decoded, string(out)
}

func TestCreatingAnExpenseAppendsOneRowAndAnswers201(t *testing.T) {
	f := newFixture(t)

	status, body, raw := post(t, f, validCreate())

	if status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}
	wantRow := []string{
		newID, "2026-10-31T09:15:00+05:30", "2026-10-31T09:15:00+05:30", "2026-10-30", "ramesh", "ramesh",
		"450", "INR", "Medical & Pharmacy", "medicines for Papa", "Cash", "", "", "", "none", "active",
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; !reflect.DeepEqual(rows, [][]string{wantRow}) {
		t.Errorf("Expenses tab = %q\nwant           %q", rows, [][]string{wantRow})
	}
	want := map[string]any{
		"id": newID, "createdAt": "2026-10-31T09:15:00+05:30", "updatedAt": "2026-10-31T09:15:00+05:30",
		"expenseDate": "2026-10-30", "loggedBy": "ramesh", "paidBy": "ramesh", "amount": 450.0, "currency": "INR",
		"category": "Medical & Pharmacy", "merchantNote": "medicines for Papa", "paymentMethod": "Cash",
		"driveFileId": "", "driveViewUrl": "", "fileHash": "", "reimbursementStatus": "none", "status": "active",
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("body = %v\nwant   %v", body, want)
	}
}

func TestPaidFromOwnPocketIsPendingReimbursementForThePayer(t *testing.T) {
	f := newFixture(t)
	req := validCreate()
	req["loggedBy"] = "kid1"
	req["paidBy"] = "kid1"
	req["category"] = "Groceries & Vegetables"
	req["reimbursementStatus"] = "pending"
	req["amount"] = 120.5
	req["merchantNote"] = "  chips  "

	status, body, raw := post(t, f, req)

	if status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}
	for key, want := range map[string]any{"reimbursementStatus": "pending", "paidBy": "kid1", "amount": 120.5, "merchantNote": "chips"} {
		if body[key] != want {
			t.Errorf("%s = %v, want %v", key, body[key], want)
		}
	}
}

func TestTheCategoryAndPaymentMethodAreMatchedLoosely(t *testing.T) {
	f := newFixture(t)
	req := validCreate()
	req["category"] = "  medical & pharmacy "

	status, body, raw := post(t, f, req)

	if status != http.StatusCreated || body["category"] != "Medical & Pharmacy" {
		t.Fatalf("status = %d body = %s, want 201 with the Ledger's spelling of the Category", status, raw)
	}
}

func TestAReplayedIDAnswers200WithTheStoredRowAndAppendsNothing(t *testing.T) {
	f := newFixture(t)
	stored := ledger.Expense{
		ID: newID, CreatedAt: "2026-10-30T20:00:00+05:30", UpdatedAt: "2026-10-30T20:00:00+05:30",
		ExpenseDate: "2026-10-30", LoggedBy: "ramesh", PaidBy: "ramesh", Amount: 450, Currency: "INR",
		Category: "Medical & Pharmacy", MerchantNote: "first try", PaymentMethod: ledger.Cash,
		Reimbursement: ledger.ReimbursementNone, Status: ledger.StatusActive,
	}
	f.ledger.Seed(ledger.Expenses, stored.Row())
	before := f.ledger.Dump()
	writes := f.ledger.Writes
	req := validCreate()
	req["merchantNote"] = "second try, different body"
	req["amount"] = 0 // even an invalid replay is answered with the stored row

	status, body, raw := post(t, f, req)

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	if body["merchantNote"] != "first try" || body["createdAt"] != "2026-10-30T20:00:00+05:30" || body["amount"] != 450.0 {
		t.Errorf("body = %v, want the stored row", body)
	}
	if f.ledger.Writes != writes || !reflect.DeepEqual(f.ledger.Dump(), before) {
		t.Errorf("the Ledger changed on a replay")
	}
}

func TestEachValidationFailureIsRejectedAndNothingIsAppended(t *testing.T) {
	cases := []struct {
		name   string
		change func(map[string]any)
		code   string
	}{
		{"missing ID", func(r map[string]any) { delete(r, "id") }, "INVALID_ID"},
		{"ID not a UUID", func(r map[string]any) { r["id"] = "expense-1" }, "INVALID_ID"},
		{"zero amount", func(r map[string]any) { r["amount"] = 0 }, "INVALID_AMOUNT"},
		{"negative amount", func(r map[string]any) { r["amount"] = -5 }, "INVALID_AMOUNT"},
		{"over one crore", func(r map[string]any) { r["amount"] = 10000000.01 }, "INVALID_AMOUNT"},
		{"three decimals", func(r map[string]any) { r["amount"] = 1.005 }, "INVALID_AMOUNT"},
		{"missing amount", func(r map[string]any) { delete(r, "amount") }, "INVALID_AMOUNT"},
		{"unknown Category", func(r map[string]any) { r["category"] = "Fireworks" }, "UNKNOWN_CATEGORY"},
		{"blank Category", func(r map[string]any) { r["category"] = "" }, "UNKNOWN_CATEGORY"},
		{"Payment Method outside the enum", func(r map[string]any) { r["paymentMethod"] = "Cheque" }, "INVALID_PAYMENT_METHOD"},
		{"missing Payment Method", func(r map[string]any) { delete(r, "paymentMethod") }, "INVALID_PAYMENT_METHOD"},
		{"two days ahead", func(r map[string]any) { r["expenseDate"] = "2026-11-02" }, "INVALID_DATE"},
		{"not a date", func(r map[string]any) { r["expenseDate"] = "31/10/2026" }, "INVALID_DATE"},
		{"impossible date", func(r map[string]any) { r["expenseDate"] = "2026-02-30" }, "INVALID_DATE"},
		{"unknown Logged_By", func(r map[string]any) { r["loggedBy"] = "stranger" }, "UNKNOWN_MEMBER"},
		{"missing Logged_By", func(r map[string]any) { delete(r, "loggedBy") }, "UNKNOWN_MEMBER"},
		{"unknown Paid_By", func(r map[string]any) { r["paidBy"] = "stranger" }, "UNKNOWN_MEMBER"},
		{"unknown Reimbursement", func(r map[string]any) { r["reimbursementStatus"] = "maybe" }, "INVALID_REIMBURSEMENT"},
		{"note too long", func(r map[string]any) { r["merchantNote"] = string(bytes.Repeat([]byte("a"), 501)) }, "INVALID_NOTE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			req := validCreate()
			c.change(req)

			status, body, raw := post(t, f, req)

			if status != http.StatusUnprocessableEntity || body["code"] != c.code {
				t.Fatalf("status = %d body = %s, want 422 %s", status, raw, c.code)
			}
			if msg, _ := body["message"].(string); msg == "" {
				t.Errorf("no message in %s", raw)
			}
			if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 0 {
				t.Errorf("appended %q on a rejected request", rows)
			}
		})
	}
}

func TestTomorrowIsTheLatestDateAccepted(t *testing.T) {
	f := newFixture(t)
	req := validCreate()
	req["expenseDate"] = "2026-11-01"

	if status, _, raw := post(t, f, req); status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201 for tomorrow (IST)", status, raw)
	}
}

func TestAnUnreadableBodyIsABadRequest(t *testing.T) {
	for _, body := range []string{"", "not json", `{"amount":"450"}`, `[1,2]`} {
		f := newFixture(t)

		status, decoded, raw := post(t, f, body)

		if status != http.StatusBadRequest || decoded["code"] != "BAD_REQUEST" {
			t.Errorf("body %q: status = %d %s, want 400 BAD_REQUEST", body, status, raw)
		}
	}
}

func TestAFormulaNoteIsStoredAndReadBackAsText(t *testing.T) {
	f := newFixture(t)
	req := validCreate()
	req["merchantNote"] = `=HYPERLINK("https://evil.example","x")`

	if status, _, raw := post(t, f, req); status != http.StatusCreated {
		t.Fatalf("status = %d body = %s, want 201", status, raw)
	}
	model, _ := readModel(t, f)

	got := list(t, model, "expenses")
	if len(got) != 1 || got[0]["merchantNote"] != `=HYPERLINK("https://evil.example","x")` {
		t.Errorf("expenses = %v, want the note as literal text", got)
	}
}

func TestCreateNeedsASession(t *testing.T) {
	f := newFixture(t)

	status, raw := call(t, f.srv, http.MethodPost, nil)

	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s, want 401", status, raw)
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 0 {
		t.Errorf("appended without a Session")
	}
}
