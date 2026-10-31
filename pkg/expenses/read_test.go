package expenses_test

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

func row(id, date, created string, status ledger.Status) []string {
	return ledger.Expense{
		ID: id, CreatedAt: created, UpdatedAt: created, ExpenseDate: date, LoggedBy: "ramesh", PaidBy: "ramesh",
		Amount: 100, Currency: "INR", Category: "Other", PaymentMethod: ledger.UPI,
		Reimbursement: ledger.ReimbursementNone, Status: status,
	}.Row()
}

func ids(t *testing.T, body map[string]any) []string {
	t.Helper()
	out := []string{}
	for _, e := range list(t, body, "expenses") {
		out = append(out, e["id"].(string))
	}
	return out
}

func getPath(t *testing.T, f fixture, query string) (int, map[string]any, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, f.srv.URL+"/api/expenses"+query, nil)
	req.AddCookie(pairedCookie(t))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	return decode(t, res)
}

// The fixture clock is 31 Oct 2026 IST, so the default window is
// 2 Aug 2026 (90 days back) to 1 Nov 2026 (tomorrow, the latest date a
// create accepts).
func TestTheReadModelHoldsActiveExpensesInTheDefault90DayWindowNewestFirst(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses,
		row("too-old", "2026-08-01", "2026-08-01T10:00:00+05:30", ledger.StatusActive),
		row("oldest-in", "2026-08-02", "2026-08-02T10:00:00+05:30", ledger.StatusActive),
		row("deleted", "2026-10-30", "2026-10-30T10:00:00+05:30", ledger.StatusDeleted),
		row("morning", "2026-10-30", "2026-10-30T08:00:00+05:30", ledger.StatusActive),
		row("evening", "2026-10-30", "2026-10-30T20:00:00+05:30", ledger.StatusActive),
		[]string{"broken", "", "", "someday", "ramesh", "", "100"},
		[]string{},
		row("tomorrow", "2026-11-01", "2026-10-31T09:00:00+05:30", ledger.StatusActive),
		row("too-new", "2026-11-02", "2026-10-31T09:00:00+05:30", ledger.StatusActive),
	)

	body, _ := readModel(t, f)

	want := []string{"tomorrow", "evening", "morning", "oldest-in"}
	if got := ids(t, body); !reflect.DeepEqual(got, want) {
		t.Errorf("expenses = %v, want %v", got, want)
	}
}

func TestFromAndToWidenOrNarrowTheWindow(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses,
		row("jan", "2026-01-15", "2026-01-15T10:00:00+05:30", ledger.StatusActive),
		row("feb", "2026-02-15", "2026-02-15T10:00:00+05:30", ledger.StatusActive),
		row("oct", "2026-10-15", "2026-10-15T10:00:00+05:30", ledger.StatusActive),
	)

	status, body, raw := getPath(t, f, "?from=2026-01-01&to=2026-01-31")
	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s", status, raw)
	}
	if got := ids(t, body); !reflect.DeepEqual(got, []string{"jan"}) {
		t.Errorf("January = %v, want [jan]", got)
	}

	_, body, _ = getPath(t, f, "?from=2026-01-01")
	if got := ids(t, body); !reflect.DeepEqual(got, []string{"oct", "feb", "jan"}) {
		t.Errorf("from January to tomorrow = %v, want [oct feb jan]", got)
	}
}

func TestAMalformedWindowIsABadRequest(t *testing.T) {
	f := newFixture(t)
	for _, query := range []string{"?from=yesterday", "?to=2026-13-01", "?from=2026-10-31&to=2026-10-01"} {
		status, body, raw := getPath(t, f, query)
		if status != http.StatusBadRequest || body["code"] != "BAD_REQUEST" {
			t.Errorf("%s: status = %d %s, want 400 BAD_REQUEST", query, status, raw)
		}
	}
}

func TestACreatedExpenseShowsUpInTheNextRead(t *testing.T) {
	f := newFixture(t)
	if status, _, raw := post(t, f, validCreate()); status != http.StatusCreated {
		t.Fatalf("create: %d %s", status, raw)
	}

	body, _ := readModel(t, f)

	got := list(t, body, "expenses")
	if len(got) != 1 || got[0]["id"] != newID || got[0]["amount"] != 450.0 || got[0]["paymentMethod"] != "Cash" {
		t.Errorf("expenses = %v, want the new Expense", got)
	}
}
