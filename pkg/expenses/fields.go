package expenses

import (
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// One checker per editable field, shared by ValidateCreate and
// ValidateUpdate so a create and an edit refuse the same values with the
// same code and message.

func checkAmount(amount float64) (float64, *ValidationError) {
	if amount <= 0 || amount > MaxAmount || math.IsNaN(amount) {
		return 0, invalid("INVALID_AMOUNT", "The amount must be more than ₹0 and at most ₹1,00,00,000")
	}
	if paise := amount * 100; math.Abs(paise-math.Round(paise)) > 1e-6 {
		return 0, invalid("INVALID_AMOUNT", "The amount can have at most two decimals")
	}
	return amount, nil
}

// checkCategory returns the Ledger's spelling of the Category.
func checkCategory(categories []ledger.Category, name string) (string, *ValidationError) {
	category, ok := findCategory(categories, name)
	if !ok {
		return "", invalid("UNKNOWN_CATEGORY", "%q is not a Category in the Ledger", name)
	}
	return category, nil
}

func checkPaymentMethod(s string) (ledger.PaymentMethod, *ValidationError) {
	method, ok := ledger.ParsePaymentMethod(s)
	if !ok {
		return "", invalid("INVALID_PAYMENT_METHOD", "The Payment Method must be UPI, Cash, Card or Bank Transfer")
	}
	return method, nil
}

// checkDate reads `YYYY-MM-DD` and allows at most one day ahead of now (IST).
func checkDate(s string, now time.Time) (string, *ValidationError) {
	date, err := time.ParseInLocation(ledger.DateLayout, strings.TrimSpace(s), ledger.IST)
	if err != nil {
		return "", invalid("INVALID_DATE", "The date must be YYYY-MM-DD")
	}
	today := now.In(ledger.IST)
	if date.After(time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, ledger.IST)) {
		return "", invalid("INVALID_DATE", "The date can be at most one day ahead")
	}
	return date.Format(ledger.DateLayout), nil
}

// checkMember finds a Member by ID; label ("Logged By", "Paid By") names
// the field in the message.
func checkMember(members []ledger.Member, id, label string) (string, *ValidationError) {
	member, ok := findMember(members, id)
	if !ok {
		return "", invalid("UNKNOWN_MEMBER", "%s %q is not a Member in the Ledger", label, id)
	}
	return member, nil
}

func checkReimbursement(s string) (ledger.Reimbursement, *ValidationError) {
	r, ok := ledger.ParseReimbursement(strings.TrimSpace(s))
	if !ok {
		return "", invalid("INVALID_REIMBURSEMENT", "Reimbursement must be none, pending or done")
	}
	return r, nil
}

func checkNote(s string) (string, *ValidationError) {
	note := strings.TrimSpace(s)
	if utf8.RuneCountInString(note) > MaxNoteLength {
		return "", invalid("INVALID_NOTE", "The note can be at most %d characters", MaxNoteLength)
	}
	return note, nil
}

// findCategory matches a name the way a human would (case and surrounding
// spaces ignored) and returns the Ledger's spelling.
func findCategory(categories []ledger.Category, name string) (string, bool) {
	name = strings.TrimSpace(name)
	for _, c := range categories {
		if name != "" && strings.EqualFold(c.Name, name) {
			return c.Name, true
		}
	}
	return "", false
}

func findMember(members []ledger.Member, id string) (string, bool) {
	id = strings.TrimSpace(id)
	for _, m := range members {
		if id != "" && m.MemberID == id {
			return m.MemberID, true
		}
	}
	return "", false
}
