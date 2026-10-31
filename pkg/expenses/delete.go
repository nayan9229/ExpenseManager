package expenses

import (
	"net/http"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// remove is DELETE `expenses?id=<ID>` (spec "Expense API contract",
// Delete): a Soft Delete. Status becomes deleted and Updated_At is stamped;
// the row and its Receipt stay, so the Admin can audit (user story 56).
// Only those two cells change: every other cell is written back exactly as
// read, so a row the Admin typed by hand keeps its spelling. Deleting an
// already deleted Expense answers 200 with the stored row and writes
// nothing, so a retried delete is harmless.
func (s Service) remove(w http.ResponseWriter, r *http.Request) {
	snap, err := s.Ledger.Read(r.Context(), ledger.Expenses)
	if err != nil {
		writeLedgerError(w, err)
		return
	}
	rows := snap.Rows[ledger.Expenses]
	stored, index, ok := ledger.FindExpense(rows, r.URL.Query().Get("id"))
	if !ok {
		writeExpenseNotFound(w)
		return
	}
	if stored.Status == ledger.StatusDeleted {
		httpjson.Write(w, http.StatusOK, viewOf(stored))
		return
	}
	stored.Status = ledger.StatusDeleted
	stored.UpdatedAt = s.now().In(ledger.IST).Format(time.RFC3339)
	row := append([]string(nil), rows[index]...)
	row[expenseColumn("Updated_At")] = stored.UpdatedAt
	row[expenseColumn("Status")] = string(stored.Status)
	if err := s.Ledger.Update(r.Context(), ledger.Expenses, index, row); err != nil {
		writeLedgerError(w, err)
		return
	}
	httpjson.Write(w, http.StatusOK, viewOf(stored))
}

// expenseColumn is the index of an Expenses header; Read pads every row to
// the full width, so the index is always in range.
func expenseColumn(name string) int {
	for i, c := range ledger.Columns[ledger.Expenses] {
		if c == name {
			return i
		}
	}
	panic("expenses: no Expenses column " + name)
}
