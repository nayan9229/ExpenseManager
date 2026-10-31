package expenses_test

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

func owed(id, date, created string, r ledger.Reimbursement, status ledger.Status) []string {
	return ledger.Expense{
		ID: id, CreatedAt: created, UpdatedAt: created, ExpenseDate: date, LoggedBy: "kid1", PaidBy: "kid1",
		Amount: 120, Currency: "INR", Category: "Other", PaymentMethod: ledger.Cash,
		Reimbursement: r, Status: status,
	}.Row()
}

// The Reimbursable Queue must hold every pending Reimbursement, however old:
// the fixture clock is 31 Oct 2026, so March is far outside the 90 days.
func TestPendingReimbursementsAreReadWithNoDateWindow(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses,
		owed("march", "2026-03-04", "2026-03-04T10:00:00+05:30", ledger.ReimbursementPending, ledger.StatusActive),
		owed("paid-back", "2026-10-20", "2026-10-20T10:00:00+05:30", ledger.ReimbursementDone, ledger.StatusActive),
		owed("not-owed", "2026-10-21", "2026-10-21T10:00:00+05:30", ledger.ReimbursementNone, ledger.StatusActive),
		owed("deleted", "2026-10-22", "2026-10-22T10:00:00+05:30", ledger.ReimbursementPending, ledger.StatusDeleted),
		owed("last-year", "2025-12-30", "2025-12-30T10:00:00+05:30", ledger.ReimbursementPending, ledger.StatusActive),
		owed("october", "2026-10-30", "2026-10-30T10:00:00+05:30", ledger.ReimbursementPending, ledger.StatusActive),
	)
	f.ledger.Seed(ledger.Members, []string{"kid1", "Chintu", "kid", "Cash", "", "#6E7250"})
	f.ledger.Seed(ledger.Categories, []string{"Other", "📦", "#6E7250", "0", "all"})
	f.ledger.Seed(ledger.RecurringRules, []string{"rent", "Rent", "25000", "Other", "5"})

	status, body, raw := getPath(t, f, "?reimbursement=pending")

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	if got, want := ids(t, body), []string{"october", "march", "last-year"}; !reflect.DeepEqual(got, want) {
		t.Errorf("expenses = %v, want %v (every active pending one, newest first)", got, want)
	}
	for _, key := range []string{"members", "categories", "recurringRules"} {
		if len(list(t, body, key)) != 1 {
			t.Errorf("%s = %v, want them included as usual", key, body[key])
		}
	}
	if body["ledgerUrl"] == "" || body["serverTime"] == "" {
		t.Errorf("ledgerUrl / serverTime missing in %s", raw)
	}
}

func TestAnUnknownReimbursementFilterIsABadRequest(t *testing.T) {
	f := newFixture(t)

	status, body, raw := getPath(t, f, "?reimbursement=done")

	if status != http.StatusBadRequest || body["code"] != "BAD_REQUEST" {
		t.Fatalf("status = %d body = %s, want 400 BAD_REQUEST", status, raw)
	}
}
