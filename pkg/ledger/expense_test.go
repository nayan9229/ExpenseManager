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
		"", "", "", "pending", "active",
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
