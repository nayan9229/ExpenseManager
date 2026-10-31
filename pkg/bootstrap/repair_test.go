package bootstrap_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// seedAll gives the fixture a complete Ledger, as an earlier Bootstrap left it.
func seedAll(f fixture) {
	for _, tab := range ledger.Tabs {
		f.ledger.Seed(tab)
	}
	f.ledger.Seed(ledger.Members, []string{"admin", "Admin", "admin", "UPI", "", "#6E7250"})
	f.ledger.Seed(ledger.Categories, []string{"Groceries", "🥦", "#6E7250", "5000", "all"})
}

func list(t *testing.T, report map[string]any, key string) []any {
	t.Helper()
	v, ok := report[key].([]any)
	if !ok {
		t.Fatalf("%s is not a list in %v", key, report)
	}
	return v
}

func TestRepairWritesTheHeadersOfATabWhoseFirstRowIsEmpty(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	f.ledger.Seed(ledger.Expenses, []string{"e1", "", "", "2026-10-30", "admin", "admin", "450"})
	f.ledger.Tab(ledger.Expenses).Header = []string{"", "  "}
	rows := f.ledger.Dump()[ledger.Expenses].Rows

	report := run(t, f)

	got := f.ledger.Tab(ledger.Expenses)
	if !reflect.DeepEqual(got.Header, ledger.Columns[ledger.Expenses]) {
		t.Errorf("Expenses header = %q, want the spec headers", got.Header)
	}
	if !reflect.DeepEqual(got.Rows, rows) {
		t.Errorf("Expenses rows changed: %q, want %q", got.Rows, rows)
	}
	if written := list(t, report, "headersWritten"); !reflect.DeepEqual(written, []any{"Expenses"}) {
		t.Errorf("headersWritten = %v, want [Expenses]", written)
	}
	if mismatches := list(t, report, "headerMismatches"); len(mismatches) != 0 {
		t.Errorf("headerMismatches = %v, want none", mismatches)
	}
}

func TestRepairFreezesTheFirstRowOfEveryTab(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	f.ledger.Tab(ledger.Categories).Frozen = false
	f.ledger.Tab(ledger.RecurringRules).Frozen = false

	run(t, f)

	for _, tab := range ledger.Tabs {
		if !f.ledger.Tab(tab).Frozen {
			t.Errorf("%s row 1 is not frozen after Repair", tab)
		}
	}
}

func TestRepairLeavesAHeaderThatDiffersAloneAndReportsIt(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	odd := []string{"Member_ID", "Full Name", "Role"}
	f.ledger.Tab(ledger.Members).Header = append([]string(nil), odd...)

	report := run(t, f)

	if got := f.ledger.Tab(ledger.Members).Header; !reflect.DeepEqual(got, odd) {
		t.Errorf("Members header = %q, want it left as %q", got, odd)
	}
	mismatches := list(t, report, "headerMismatches")
	if len(mismatches) != 1 {
		t.Fatalf("headerMismatches = %v, want one for Members", mismatches)
	}
	m := mismatches[0].(map[string]any)
	if m["tab"] != "Members" {
		t.Errorf("mismatch tab = %v, want Members", m["tab"])
	}
	if !reflect.DeepEqual(m["found"], []any{"Member_ID", "Full Name", "Role"}) {
		t.Errorf("found = %v, want the row as it is", m["found"])
	}
	msg, _ := m["message"].(string)
	for _, part := range []string{"Members", "Member_ID, Name, Role, Default_Payment_Method, PIN_Code, Avatar_Color"} {
		if !strings.Contains(msg, part) {
			t.Errorf("message %q does not mention %q", msg, part)
		}
	}
	if written := list(t, report, "headersWritten"); len(written) != 0 {
		t.Errorf("headersWritten = %v, want none", written)
	}
}

func TestExtraColumnsAfterTheSpecHeadersAreNotAMismatch(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	f.ledger.Tab(ledger.Categories).Header = append(append([]string(nil), ledger.Columns[ledger.Categories]...), "Admin notes")

	report := run(t, f)

	if mismatches := list(t, report, "headerMismatches"); len(mismatches) != 0 {
		t.Errorf("headerMismatches = %v, want none for appended columns", mismatches)
	}
}

func TestRepairAddsTheHeadersMissingFromTheEndOfRowOne(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	v1 := ledger.Columns[ledger.Expenses][:16] // the v1.0.0 Expenses header, before Receipt_Number
	old := []string{"e1", "", "", "2026-10-30", "admin", "admin", "450", "INR", "Other", "milk", "UPI", "", "", "", "none", "active"}
	f.ledger.Seed(ledger.Expenses, old)
	f.ledger.Tab(ledger.Expenses).Header = append([]string(nil), v1...)
	rows := f.ledger.Dump()[ledger.Expenses].Rows

	report := run(t, f)

	got := f.ledger.Tab(ledger.Expenses)
	if !reflect.DeepEqual(got.Header, ledger.Columns[ledger.Expenses]) {
		t.Errorf("Expenses header = %q, want the full headers", got.Header)
	}
	if !reflect.DeepEqual(got.Rows, rows) {
		t.Errorf("Expenses rows changed: %q, want %q", got.Rows, rows)
	}
	extended := list(t, report, "headersExtended")
	want := []any{map[string]any{"tab": "Expenses", "added": []any{"Receipt_Number"}}}
	if !reflect.DeepEqual(extended, want) {
		t.Errorf("headersExtended = %v, want %v", extended, want)
	}
	if mismatches := list(t, report, "headerMismatches"); len(mismatches) != 0 {
		t.Errorf("headerMismatches = %v, want none", mismatches)
	}
	if written := list(t, report, "headersWritten"); len(written) != 0 {
		t.Errorf("headersWritten = %v, want none", written)
	}

	again := run(t, f)
	if extended := list(t, again, "headersExtended"); len(extended) != 0 {
		t.Errorf("second run headersExtended = %v, want none", extended)
	}
}

func TestAShortRowOneWithARenamedColumnIsStillAMismatch(t *testing.T) {
	f := newFixture(t)
	seedAll(f)
	odd := append(append([]string(nil), ledger.Columns[ledger.Expenses][:8]...), "Type")
	f.ledger.Tab(ledger.Expenses).Header = append([]string(nil), odd...)

	report := run(t, f)

	if got := f.ledger.Tab(ledger.Expenses).Header; !reflect.DeepEqual(got, odd) {
		t.Errorf("Expenses header = %q, want it left as %q", got, odd)
	}
	if mismatches := list(t, report, "headerMismatches"); len(mismatches) != 1 {
		t.Errorf("headerMismatches = %v, want one for Expenses", mismatches)
	}
	if extended := list(t, report, "headersExtended"); len(extended) != 0 {
		t.Errorf("headersExtended = %v, want none", extended)
	}
}
