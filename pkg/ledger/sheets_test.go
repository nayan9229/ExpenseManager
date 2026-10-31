package ledger

import (
	"reflect"
	"testing"
)

// The Sheets implementation cannot run without credentials, so the two pure
// pieces it is built from are pinned here: which columns get a plain-text
// format, and how UNFORMATTED_VALUE cells become the strings the parsers see.

type span struct{ start, end int64 }

func textSpans(t *testing.T, tab Tab) []span {
	t.Helper()
	var spans []span
	for i, req := range formatRequests(7, Columns[tab]) {
		if i == 0 {
			if req.RepeatCell.Fields != "userEnteredFormat.textFormat.bold" || req.RepeatCell.Range.EndRowIndex != 1 {
				t.Fatalf("first request should bold the header row, got %+v", req.RepeatCell)
			}
			continue
		}
		rc := req.RepeatCell
		if rc.Cell.UserEnteredFormat.NumberFormat.Type != "TEXT" || rc.Range.StartRowIndex != 1 || rc.Range.SheetId != 7 {
			t.Fatalf("request %d is not a TEXT format below the header on sheet 7: %+v", i, rc)
		}
		spans = append(spans, span{rc.Range.StartColumnIndex, rc.Range.EndColumnIndex})
	}
	return spans
}

func TestOnlyAmountColumnsStayNumeric(t *testing.T) {
	cases := map[Tab][]span{
		Expenses:       {{0, 6}, {7, 16}}, // Amount is column G
		Members:        {{0, 6}},          // PIN_Code keeps its leading zero
		Categories:     {{0, 3}, {4, 5}},  // Monthly_Budget_Limit is column D
		RecurringRules: {{0, 2}, {3, 4}},  // Amount is C, Due_Day_Of_Month is E
	}
	for tab, want := range cases {
		if got := textSpans(t, tab); !reflect.DeepEqual(got, want) {
			t.Errorf("%s text spans = %v, want %v", tab, got, want)
		}
	}
}

func TestCellsBecomeTheTextTheAdminTyped(t *testing.T) {
	cases := []struct {
		cell any
		want string
	}{
		{nil, ""},
		{"admin", "admin"},
		{"0123", "0123"},
		{float64(0), "0"},
		{float64(5000), "5000"},
		{1500.5, "1500.5"},
		{float64(12345678), "12345678"},
		{true, "TRUE"},
	}
	for _, c := range cases {
		if got := cellString(c.cell); got != c.want {
			t.Errorf("cellString(%v) = %q, want %q", c.cell, got, c.want)
		}
	}
}
