package expenses_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
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
		"450", "INR", "Medical & Pharmacy", "medicines for Papa", "Cash", "", "", "", "none", "active", "",
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; !reflect.DeepEqual(rows, [][]string{wantRow}) {
		t.Errorf("Expenses tab = %q\nwant           %q", rows, [][]string{wantRow})
	}
	want := map[string]any{
		"id": newID, "createdAt": "2026-10-31T09:15:00+05:30", "updatedAt": "2026-10-31T09:15:00+05:30",
		"expenseDate": "2026-10-30", "loggedBy": "ramesh", "paidBy": "ramesh", "amount": 450.0, "currency": "INR",
		"category": "Medical & Pharmacy", "merchantNote": "medicines for Papa", "paymentMethod": "Cash",
		"driveFileId": "", "driveViewUrl": "", "fileHash": "", "reimbursementStatus": "none", "status": "active",
		"receiptNumber": "",
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
		name    string
		change  func(map[string]any)
		code    string
		message string
	}{
		{"missing ID", func(r map[string]any) { delete(r, "id") }, "INVALID_ID", "The Expense ID must be a UUID generated by the app"},
		{"ID not a UUID", func(r map[string]any) { r["id"] = "expense-1" }, "INVALID_ID", "The Expense ID must be a UUID generated by the app"},
		{"zero amount", func(r map[string]any) { r["amount"] = 0 }, "INVALID_AMOUNT", "The amount must be more than ₹0 and at most ₹1,00,00,000"},
		{"negative amount", func(r map[string]any) { r["amount"] = -5 }, "INVALID_AMOUNT", "The amount must be more than ₹0 and at most ₹1,00,00,000"},
		{"over one crore", func(r map[string]any) { r["amount"] = 10000000.01 }, "INVALID_AMOUNT", "The amount must be more than ₹0 and at most ₹1,00,00,000"},
		{"three decimals", func(r map[string]any) { r["amount"] = 1.005 }, "INVALID_AMOUNT", "The amount can have at most two decimals"},
		{"missing amount", func(r map[string]any) { delete(r, "amount") }, "INVALID_AMOUNT", "The amount is missing"},
		{"unknown Category", func(r map[string]any) { r["category"] = "Fireworks" }, "UNKNOWN_CATEGORY", "\"Fireworks\" is not a Category in the Ledger"},
		{"blank Category", func(r map[string]any) { r["category"] = "" }, "UNKNOWN_CATEGORY", "\"\" is not a Category in the Ledger"},
		{"Payment Method outside the enum", func(r map[string]any) { r["paymentMethod"] = "Cheque" }, "INVALID_PAYMENT_METHOD", "The Payment Method must be UPI, Cash, Card or Bank Transfer"},
		{"missing Payment Method", func(r map[string]any) { delete(r, "paymentMethod") }, "INVALID_PAYMENT_METHOD", "The Payment Method must be UPI, Cash, Card or Bank Transfer"},
		{"two days ahead", func(r map[string]any) { r["expenseDate"] = "2026-11-02" }, "INVALID_DATE", "The date can be at most one day ahead"},
		{"not a date", func(r map[string]any) { r["expenseDate"] = "31/10/2026" }, "INVALID_DATE", "The date must be YYYY-MM-DD"},
		{"impossible date", func(r map[string]any) { r["expenseDate"] = "2026-02-30" }, "INVALID_DATE", "The date must be YYYY-MM-DD"},
		{"unknown Logged_By", func(r map[string]any) { r["loggedBy"] = "stranger" }, "UNKNOWN_MEMBER", "Logged By \"stranger\" is not a Member in the Ledger"},
		{"missing Logged_By", func(r map[string]any) { delete(r, "loggedBy") }, "UNKNOWN_MEMBER", "Logged By \"\" is not a Member in the Ledger"},
		{"unknown Paid_By", func(r map[string]any) { r["paidBy"] = "stranger" }, "UNKNOWN_MEMBER", "Paid By \"stranger\" is not a Member in the Ledger"},
		{"unknown Reimbursement", func(r map[string]any) { r["reimbursementStatus"] = "maybe" }, "INVALID_REIMBURSEMENT", "Reimbursement must be none, pending or done"},
		{"note too long", func(r map[string]any) { r["merchantNote"] = string(bytes.Repeat([]byte("a"), 501)) }, "INVALID_NOTE", "The note can be at most 500 characters"},
		{"Receipt Number too long", func(r map[string]any) { r["receiptNumber"] = string(bytes.Repeat([]byte("7"), 41)) }, "INVALID_RECEIPT_NUMBER", "The Receipt Number can be at most 40 characters"},
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
			if body["message"] != c.message {
				t.Errorf("message = %q, want %q", body["message"], c.message)
			}
			if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 0 {
				t.Errorf("appended %q on a rejected request", rows)
			}
		})
	}
}

func TestTheReceiptNumberIsStoredTrimmedAsTextInColumnQ(t *testing.T) {
	cases := map[string]string{
		"leading zeros kept": "  004521  ",
		"a slash kept":       "4521/A",
		"forty characters":   string(bytes.Repeat([]byte("9"), 40)),
		"blank is none":      "   ",
	}
	for name, sent := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			req := validCreate()
			req["receiptNumber"] = sent

			status, body, raw := post(t, f, req)

			if status != http.StatusCreated {
				t.Fatalf("status = %d body = %s, want 201", status, raw)
			}
			want := strings.TrimSpace(sent)
			if got := f.ledger.Tab(ledger.Expenses).Rows[0][16]; got != want {
				t.Errorf("Receipt_Number cell = %q, want %q", got, want)
			}
			if body["receiptNumber"] != want {
				t.Errorf("receiptNumber = %v, want %q", body["receiptNumber"], want)
			}
			model, _ := readModel(t, f)
			if got := list(t, model, "expenses"); len(got) != 1 || got[0]["receiptNumber"] != want {
				t.Errorf("read model expenses = %v, want receiptNumber %q", got, want)
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
