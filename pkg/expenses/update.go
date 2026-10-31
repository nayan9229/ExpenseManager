package expenses

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// UpdateRequest is the PUT body (spec "Expense API contract", Update): the
// Expense's ID and the editable fields. A field left out keeps its stored
// value, so Admin Mode's "Mark done" can send only reimbursementStatus.
// Logged_By, the Receipt columns and the timestamps are not editable;
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
}

// ValidateUpdate applies an edit to the stored Expense at time now and
// returns the row to write, with Updated_At stamped in IST. Each field sent
// is checked the way a create checks it, except that a value equal to the
// stored one is kept as-is: an old Expense whose Category or payer has
// since left the Ledger can still have its note fixed.
func ValidateUpdate(stored ledger.Expense, req UpdateRequest, members []ledger.Member, categories []ledger.Category, now time.Time) (ledger.Expense, *ValidationError) {
	e := stored
	if req.Amount != nil && *req.Amount != stored.Amount {
		amount := *req.Amount
		if amount <= 0 || amount > MaxAmount || math.IsNaN(amount) {
			return ledger.Expense{}, invalid("INVALID_AMOUNT", "The amount must be more than ₹0 and at most ₹1,00,00,000")
		}
		if paise := amount * 100; math.Abs(paise-math.Round(paise)) > 1e-6 {
			return ledger.Expense{}, invalid("INVALID_AMOUNT", "The amount can have at most two decimals")
		}
		e.Amount = amount
	}
	if req.Category != nil && strings.TrimSpace(*req.Category) != stored.Category {
		category, ok := findCategory(categories, *req.Category)
		if !ok {
			return ledger.Expense{}, invalid("UNKNOWN_CATEGORY", "%q is not a Category in the Ledger", *req.Category)
		}
		e.Category = category
	}
	if req.PaymentMethod != nil && *req.PaymentMethod != string(stored.PaymentMethod) {
		method, ok := paymentMethod(*req.PaymentMethod)
		if !ok {
			return ledger.Expense{}, invalid("INVALID_PAYMENT_METHOD", "The Payment Method must be UPI, Cash, Card or Bank Transfer")
		}
		e.PaymentMethod = method
	}
	if req.ExpenseDate != nil && strings.TrimSpace(*req.ExpenseDate) != stored.ExpenseDate {
		date, err := time.ParseInLocation(ledger.DateLayout, strings.TrimSpace(*req.ExpenseDate), ledger.IST)
		if err != nil {
			return ledger.Expense{}, invalid("INVALID_DATE", "The date must be YYYY-MM-DD")
		}
		today := now.In(ledger.IST)
		if date.After(time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, ledger.IST)) {
			return ledger.Expense{}, invalid("INVALID_DATE", "The date can be at most one day ahead")
		}
		e.ExpenseDate = date.Format(ledger.DateLayout)
	}
	if req.PaidBy != nil && strings.TrimSpace(*req.PaidBy) != stored.PaidBy {
		paidBy, ok := findMember(members, *req.PaidBy)
		if !ok {
			return ledger.Expense{}, invalid("UNKNOWN_MEMBER", "Paid By %q is not a Member in the Ledger", *req.PaidBy)
		}
		e.PaidBy = paidBy
	}
	if req.ReimbursementStatus != nil {
		switch r := ledger.Reimbursement(strings.TrimSpace(*req.ReimbursementStatus)); r {
		case ledger.ReimbursementNone, ledger.ReimbursementPending, ledger.ReimbursementDone:
			e.Reimbursement = r
		default:
			return ledger.Expense{}, invalid("INVALID_REIMBURSEMENT", "Reimbursement must be none, pending or done")
		}
	}
	if req.MerchantNote != nil {
		note := strings.TrimSpace(*req.MerchantNote)
		if utf8.RuneCountInString(note) > MaxNoteLength {
			return ledger.Expense{}, invalid("INVALID_NOTE", "The note can be at most %d characters", MaxNoteLength)
		}
		e.MerchantNote = note
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
