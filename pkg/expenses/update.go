package expenses

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// UpdateRequest is the PUT body (spec "Expense API contract", Update): the
// Expense's ID and the editable fields. A field left out keeps its stored
// value, so Admin Mode's "Mark done" can send only reimbursementStatus.
// Logged_By, the Receipt file columns and the timestamps are not editable;
// unknown fields are ignored.
type UpdateRequest struct {
	ID                  string   `json:"id"`
	ExpenseDate         *string  `json:"expenseDate"`
	PaidBy              *string  `json:"paidBy"`
	Amount              *float64 `json:"amount"`
	Category            *string  `json:"category"`
	MerchantNote        *string  `json:"merchantNote"`
	PaymentMethod       *string  `json:"paymentMethod"`
	ReimbursementStatus *string  `json:"reimbursementStatus"`
	// ReceiptNumber may be corrected on the Edit screen; blank clears it.
	ReceiptNumber *string `json:"receiptNumber"`
}

// ValidateUpdate applies an edit to the stored Expense at time now and
// returns the row to write, with Updated_At stamped in IST. Each field sent
// is checked the way a create checks it, except that a value equal to the
// stored one is kept as-is: an old Expense whose Category or payer has
// since left the Ledger can still have its note fixed.
func ValidateUpdate(stored ledger.Expense, req UpdateRequest, members []ledger.Member, categories []ledger.Category, now time.Time) (ledger.Expense, *ValidationError) {
	e := stored
	var verr *ValidationError
	if req.Amount != nil && *req.Amount != stored.Amount {
		if e.Amount, verr = checkAmount(*req.Amount); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.Category != nil && strings.TrimSpace(*req.Category) != stored.Category {
		if e.Category, verr = checkCategory(categories, *req.Category); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.PaymentMethod != nil && *req.PaymentMethod != string(stored.PaymentMethod) {
		if e.PaymentMethod, verr = checkPaymentMethod(*req.PaymentMethod); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.ExpenseDate != nil && strings.TrimSpace(*req.ExpenseDate) != stored.ExpenseDate {
		if e.ExpenseDate, verr = checkDate(*req.ExpenseDate, now); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.PaidBy != nil && strings.TrimSpace(*req.PaidBy) != stored.PaidBy {
		if e.PaidBy, verr = checkMember(members, *req.PaidBy, "Paid By"); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.ReimbursementStatus != nil {
		if e.Reimbursement, verr = checkReimbursement(*req.ReimbursementStatus); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.MerchantNote != nil {
		if e.MerchantNote, verr = checkNote(*req.MerchantNote); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	if req.ReceiptNumber != nil {
		if e.ReceiptNumber, verr = checkReceiptNumber(*req.ReceiptNumber); verr != nil {
			return ledger.Expense{}, verr
		}
	}
	e.UpdatedAt = now.In(ledger.IST).Format(time.RFC3339)
	return e, nil
}

// update rewrites one Expense in place, found by ID. Last write wins.
func (s Service) update(w http.ResponseWriter, r *http.Request) {
	var req UpdateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "The body must be a JSON object with the Expense ID and the fields to change")
		return
	}
	snap, err := s.Ledger.Read(r.Context(), ledger.Expenses, ledger.Members, ledger.Categories)
	if err != nil {
		writeLedgerError(w, err)
		return
	}
	stored, index, ok := ledger.FindExpense(snap.Rows[ledger.Expenses], req.ID)
	if !ok || stored.Status == ledger.StatusDeleted {
		writeExpenseNotFound(w)
		return
	}
	expense, verr := ValidateUpdate(stored, req, ledger.ParseMembers(snap.Rows[ledger.Members]), ledger.ParseCategories(snap.Rows[ledger.Categories]), s.now())
	if verr != nil {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, verr.Code, verr.Message)
		return
	}
	if err := s.Ledger.Update(r.Context(), ledger.Expenses, index, expense.Row()); err != nil {
		writeLedgerError(w, err)
		return
	}
	httpjson.Write(w, http.StatusOK, viewOf(expense))
}

func writeExpenseNotFound(w http.ResponseWriter) {
	httpjson.WriteError(w, http.StatusNotFound, "EXPENSE_NOT_FOUND", "No active Expense has that ID; it may have been deleted")
}
