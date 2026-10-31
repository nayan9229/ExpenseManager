package ledger

import (
	"reflect"
	"testing"
)

func sampleExpense() Expense {
	return Expense{
		ID:            "6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10",
		CreatedAt:     "2026-10-31T09:15:00+05:30",
		UpdatedAt:     "2026-10-31T09:15:00+05:30",
		ExpenseDate:   "2026-10-30",
		LoggedBy:      "ramesh",
		PaidBy:        "ramesh",
		Amount:        450,
		Currency:      "INR",
		Category:      "Medical & Pharmacy",
		MerchantNote:  "medicines for Papa",
		PaymentMethod: Cash,
		Reimbursement: ReimbursementPending,
		Status:        StatusActive,
	}
}

func TestAnExpenseRowFollowsTheColumnOrder(t *testing.T) {
	row := sampleExpense().Row()

	want := []string{
		"6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10", "2026-10-31T09:15:00+05:30", "2026-10-31T09:15:00+05:30",
		"2026-10-30", "ramesh", "ramesh", "450", "INR", "Medical & Pharmacy", "medicines for Papa", "Cash",
		"", "", "", "pending", "active", "",
	}
	if !reflect.DeepEqual(row, want) {
		t.Errorf("Row() = %q\nwant    %q", row, want)
	}
	if len(row) != len(Columns[Expenses]) {
		t.Errorf("Row() has %d cells, the tab has %d columns", len(row), len(Columns[Expenses]))
	}
}

func TestAnExpenseSurvivesARoundTripThroughItsRow(t *testing.T) {
	e := sampleExpense()
	e.Amount = 1234.5
	e.ReceiptNumber = "004521/A"

	got := ParseExpenses([][]string{e.Row()})

	if !reflect.DeepEqual(got, []Expense{e}) {
		t.Errorf("ParseExpenses(Row()) = %+v\nwant %+v", got, []Expense{e})
	}
}

func TestHandEditedExpenseRowsAreSkippedOrDefaulted(t *testing.T) {
	rows := [][]string{
		{}, // blank row
		{"", "", "", "2026-10-30", "ramesh", "", "100"}, // no ID
		{"no-amount", "", "", "2026-10-30", "ramesh", "", "lots"},
		{"no-date", "", "", "30th Oct", "ramesh", "", "100"},
		{" tidy ", "", "", " 2026-10-29 ", "ramesh", "", "₹1,500", "", "Other", "'=1+1", "cheque", "", "", "", "PENDING", "Deleted"},
		{"slashes", "", "", "2026/10/28", "dadi", "", "75", "inr", "Other", "", "bank_transfer", "", "", "", "maybe", "gone"},
	}

	got := ParseExpenses(rows)

	want := []Expense{
		{ID: "tidy", ExpenseDate: "2026-10-29", LoggedBy: "ramesh", PaidBy: "ramesh", Amount: 1500, Currency: "INR",
			Category: "Other", MerchantNote: "=1+1", PaymentMethod: UPI, Reimbursement: ReimbursementPending, Status: StatusDeleted},
		{ID: "slashes", ExpenseDate: "2026-10-28", LoggedBy: "dadi", PaidBy: "dadi", Amount: 75, Currency: "INR",
			Category: "Other", PaymentMethod: BankTransfer, Reimbursement: ReimbursementNone, Status: StatusActive},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseExpenses = %+v\nwant          %+v", got, want)
	}
}

func TestTheReceiptNumberIsColumnQAfterStatus(t *testing.T) {
	cols := Columns[Expenses]
	if len(cols) != 17 || cols[15] != "Status" || cols[16] != "Receipt_Number" {
		t.Fatalf("Expenses columns = %q, want Receipt_Number appended after Status as column Q", cols)
	}
	e := sampleExpense()
	e.ReceiptNumber = "INV-77"
	if row := e.Row(); row[16] != "INV-77" {
		t.Errorf("Row()[16] = %q, want the Receipt Number", row[16])
	}
}

func TestARowWrittenBeforeTheReceiptNumberColumnReadsAsBlank(t *testing.T) {
	old := sampleExpense().Row()[:16]

	got := ParseExpenses([][]string{old})

	if len(got) != 1 || got[0].ReceiptNumber != "" {
		t.Fatalf("ParseExpenses(16-cell row) = %+v, want one Expense with a blank Receipt Number", got)
	}
}

func TestAReceiptNumberTheAdminTypedIsTrimmedAndUnescaped(t *testing.T) {
	row := sampleExpense().Row()
	row[16] = "  '=7  "

	got := ParseExpenses([][]string{row})

	if got[0].ReceiptNumber != "=7" {
		t.Errorf("ReceiptNumber = %q, want =7", got[0].ReceiptNumber)
	}
}

func TestFindExpenseLocatesTheRowIndexByID(t *testing.T) {
	first, second := sampleExpense(), sampleExpense()
	second.ID = "b7a0c1d2-0000-4000-8000-000000000002"
	rows := [][]string{first.Row(), {}, second.Row()}

	got, index, ok := FindExpense(rows, "b7a0c1d2-0000-4000-8000-000000000002")
	if !ok || index != 2 || !reflect.DeepEqual(got, second) {
		t.Errorf("FindExpense = %+v, %d, %v; want the second Expense at index 2", got, index, ok)
	}
	if _, _, ok := FindExpense(rows, "missing"); ok {
		t.Error("FindExpense found an ID that is not in the tab")
	}
	if _, _, ok := FindExpense(rows, ""); ok {
		t.Error("FindExpense matched a blank ID")
	}
}

func TestTheAppsReimbursementAndPaymentMethodMustBeSpelledExactly(t *testing.T) {
	for _, c := range []struct {
		in   string
		want Reimbursement
		ok   bool
	}{
		{"none", ReimbursementNone, true}, {"pending", ReimbursementPending, true}, {"done", ReimbursementDone, true},
		{"Pending", "", false}, {"", "", false}, {"maybe", "", false},
	} {
		if got, ok := ParseReimbursement(c.in); got != c.want || ok != c.ok {
			t.Errorf("ParseReimbursement(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
	for _, c := range []struct {
		in   string
		want PaymentMethod
		ok   bool
	}{
		{"UPI", UPI, true}, {"Bank Transfer", BankTransfer, true}, {"upi", "", false}, {"Cheque", "", false},
	} {
		if got, ok := ParsePaymentMethod(c.in); got != c.want || ok != c.ok {
			t.Errorf("ParsePaymentMethod(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}
