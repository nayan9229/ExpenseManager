package expenses_test

import (
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

var errGoogle = errors.New("googleapi: Error 500: backend error")

func TestADeleteMarksTheRowDeletedAndKeepsIt(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row())

	status, body, raw := send(t, f, http.MethodDelete, "?id="+storedID, nil)

	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	want := storedExpense()
	want.Status = ledger.StatusDeleted
	want.UpdatedAt = "2026-10-31T09:15:00+05:30"
	if rows := f.ledger.Tab(ledger.Expenses).Rows; !reflect.DeepEqual(rows, [][]string{want.Row()}) {
		t.Errorf("Expenses tab = %q\nwant           %q", rows, [][]string{want.Row()})
	}
	if body["id"] != storedID || body["status"] != "deleted" || body["driveFileId"] != "drive-1" {
		t.Errorf("body = %v, want the Expense marked deleted, Receipt kept", body)
	}
}

// The Admin typed this row by hand; deleting it changes only Status and
// Updated_At, never the cells the Admin wrote.
func TestADeleteLeavesEveryOtherCellAsTheAdminTypedIt(t *testing.T) {
	f := newFixture(t)
	handTyped := []string{storedID, "", "", "2026/10/30", "ramesh", "", "₹1,200", "inr", " Other ", "=SUM(1,2)", "cash", "", "", "", "", "Active", "'0042"}
	f.ledger.Seed(ledger.Expenses, handTyped)

	if status, _, raw := send(t, f, http.MethodDelete, "?id="+storedID, nil); status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}

	want := append([]string(nil), handTyped...)
	want[2] = "2026-10-31T09:15:00+05:30"
	want[15] = "deleted"
	if rows := f.ledger.Tab(ledger.Expenses).Rows; !reflect.DeepEqual(rows, [][]string{want}) {
		t.Errorf("Expenses tab = %q\nwant           %q", rows, [][]string{want})
	}
}

func TestADeletedExpenseLeavesTheReadModelAndCannotBeEdited(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row(), row("keep", "2026-10-29", "2026-10-29T10:00:00+05:30", ledger.StatusActive))

	if status, _, raw := send(t, f, http.MethodDelete, "?id="+storedID, nil); status != http.StatusOK {
		t.Fatalf("delete: status = %d body = %s, want 200", status, raw)
	}
	model, _ := readModel(t, f)
	status, body, raw := send(t, f, http.MethodPut, "", fullEdit())

	if got := ids(t, model); !reflect.DeepEqual(got, []string{"keep"}) {
		t.Errorf("read model expenses = %v, want only the active one", got)
	}
	if status != http.StatusNotFound || body["code"] != "EXPENSE_NOT_FOUND" {
		t.Errorf("edit after delete: status = %d body = %s, want 404 EXPENSE_NOT_FOUND", status, raw)
	}
	if rows := f.ledger.Tab(ledger.Expenses).Rows; len(rows) != 2 {
		t.Errorf("Expenses tab has %d rows, want both rows kept", len(rows))
	}
}

func TestDeletingTwiceAnswersTheStoredRowAndWritesNothing(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Expenses, storedExpense().Row())
	if status, _, raw := send(t, f, http.MethodDelete, "?id="+storedID, nil); status != http.StatusOK {
		t.Fatalf("first delete: status = %d body = %s", status, raw)
	}
	before := f.ledger.Dump()
	writes := f.ledger.Writes

	status, body, raw := send(t, f, http.MethodDelete, "?id="+storedID, nil)

	if status != http.StatusOK || body["status"] != "deleted" {
		t.Fatalf("second delete: status = %d body = %s, want 200 with the deleted row", status, raw)
	}
	if f.ledger.Writes != writes || !reflect.DeepEqual(f.ledger.Dump(), before) {
		t.Errorf("a repeated delete wrote to the Ledger")
	}
}

func TestDeletingAnUnknownExpenseIs404(t *testing.T) {
	for _, query := range []string{"?id=9d1e4c55-0000-4000-8000-000000000000", "", "?id="} {
		f := newFixture(t)
		f.ledger.Seed(ledger.Expenses, storedExpense().Row())
		before := f.ledger.Dump()

		status, body, raw := send(t, f, http.MethodDelete, query, nil)

		if status != http.StatusNotFound || body["code"] != "EXPENSE_NOT_FOUND" {
			t.Errorf("%q: status = %d body = %s, want 404 EXPENSE_NOT_FOUND", query, status, raw)
		}
		if !reflect.DeepEqual(f.ledger.Dump(), before) {
			t.Errorf("%q: the Ledger changed", query)
		}
	}
}

func TestEditAndDeleteNeedASession(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		f := newFixture(t)
		f.ledger.Seed(ledger.Expenses, storedExpense().Row())
		before := f.ledger.Dump()

		status, raw := call(t, f.srv, method, nil)

		if status != http.StatusUnauthorized {
			t.Errorf("%s: status = %d body = %s, want 401", method, status, raw)
		}
		if !reflect.DeepEqual(f.ledger.Dump(), before) {
			t.Errorf("%s: the Ledger changed without a Session", method)
		}
	}
}

func TestAGoogleFailureOnEditOrDeleteIsReported(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		f := newFixture(t)
		f.ledger.Seed(ledger.Expenses, storedExpense().Row())
		f.ledger.Err = errGoogle

		status, body, raw := send(t, f, method, "?id="+storedID, fullEdit())

		if status != http.StatusBadGateway || body["code"] != "GOOGLE_ERROR" {
			t.Errorf("%s: status = %d body = %s, want 502 GOOGLE_ERROR", method, status, raw)
		}
	}
}
