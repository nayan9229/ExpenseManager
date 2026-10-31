package ledger

import (
	"strings"
	"time"
)

// Reimbursement is what the Household owes a Member who paid from their own
// pocket (GLOSSARY: Reimbursement).
type Reimbursement string

const (
	ReimbursementNone    Reimbursement = "none"
	ReimbursementPending Reimbursement = "pending"
	ReimbursementDone    Reimbursement = "done"
)

// Reimbursements lists the enum.
var Reimbursements = []Reimbursement{ReimbursementNone, ReimbursementPending, ReimbursementDone}

// ParseReimbursement reads a Reimbursement sent by the app, the way
// ParsePaymentMethod reads a Payment Method: it must be one of
// Reimbursements spelled exactly.
func ParseReimbursement(s string) (Reimbursement, bool) {
	for _, r := range Reimbursements {
		if string(r) == s {
			return r, true
		}
	}
	return "", false
}

// Status is an Expense's lifecycle; deleted rows stay in the Ledger (Soft Delete).
type Status string

const (
	StatusActive  Status = "active"
	StatusDeleted Status = "deleted"
)

// Currency is the only currency v1 knows.
const Currency = "INR"

// MaxReceiptNumberLength caps Receipt_Number, in characters: the
// `expenses` function refuses a longer one and OCR treats a longer reading
// as no reading.
const MaxReceiptNumberLength = 40

// DateLayout is how Expense_Date is written: `YYYY-MM-DD`.
const DateLayout = "2006-01-02"

// Expense is one row of the Expenses tab.
type Expense struct {
	ID            string
	CreatedAt     string
	UpdatedAt     string
	ExpenseDate   string
	LoggedBy      string
	PaidBy        string
	Amount        float64
	Currency      string
	Category      string
	MerchantNote  string
	PaymentMethod PaymentMethod
	DriveFileID   string
	DriveViewURL  string
	FileHash      string
	Reimbursement Reimbursement
	Status        Status
	// ReceiptNumber is the number the merchant printed on the Receipt
	// (GLOSSARY: Receipt Number); blank means none. The Sheets adapter always
	// stores it as text, and it reads back exactly as written (only
	// trimmed): nothing is unescaped, so `'A12` stays `'A12`.
	ReceiptNumber string
}

// Row maps the Expense onto the Expenses column order.
func (e Expense) Row() []string {
	return []string{
		e.ID, e.CreatedAt, e.UpdatedAt, e.ExpenseDate, e.LoggedBy, e.PaidBy, formatAmount(e.Amount), e.Currency,
		e.Category, e.MerchantNote, string(e.PaymentMethod), e.DriveFileID, e.DriveViewURL, e.FileHash,
		string(e.Reimbursement), string(e.Status), e.ReceiptNumber,
	}
}

// ParseExpenses reads the Expenses tab. An Expense is an amount on a date,
// so a row missing its ID, a numeric Amount or a readable Expense_Date is
// skipped. Everything else defaults: Paid_By to Logged_By, Currency to INR,
// an unknown Payment Method to UPI, Reimbursement to none, Status to active.
func ParseExpenses(rows [][]string) []Expense {
	expenses := []Expense{}
	for _, row := range rows {
		if e, ok := parseExpense(row); ok {
			expenses = append(expenses, e)
		}
	}
	return expenses
}

// FindExpense returns the Expense whose ID is id and its index in rows (the
// index Update wants). A row with that ID is found even when it is too
// malformed for ParseExpenses; the Expense then carries what could be read.
func FindExpense(rows [][]string, id string) (Expense, int, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Expense{}, -1, false
	}
	for i, row := range rows {
		if len(row) > 0 && strings.TrimSpace(row[0]) == id {
			e, _ := parseExpense(row)
			return e, i, true
		}
	}
	return Expense{}, -1, false
}

func parseExpense(row []string) (Expense, bool) {
	row = padRow(row, len(Columns[Expenses]))
	cell := func(i int) string { return strings.TrimSpace(row[i]) }
	e := Expense{
		ID:            cell(0),
		CreatedAt:     cell(1),
		UpdatedAt:     cell(2),
		LoggedBy:      cell(4),
		PaidBy:        cell(5),
		Currency:      strings.ToUpper(cell(7)),
		Category:      cell(8),
		MerchantNote:  unescapeText(cell(9)),
		PaymentMethod: paymentMethodCell(row[10]),
		DriveFileID:   cell(11),
		DriveViewURL:  cell(12),
		FileHash:      cell(13),
		Reimbursement: reimbursementCell(row[14]),
		Status:        parseStatus(row[15]),
		ReceiptNumber: cell(16),
	}
	if e.PaidBy == "" {
		e.PaidBy = e.LoggedBy
	}
	if e.Currency == "" {
		e.Currency = Currency
	}
	amount, amountOK := parseNumber(row[6])
	e.Amount = amount
	date, dateOK := ParseDate(row[3])
	e.ExpenseDate = date
	return e, e.ID != "" && amountOK && dateOK
}

// ParseDate reads an Expense_Date the way the Admin may have typed it
// (`2026-10-30`, `2026-1-5`, `2026/10/30`) and returns it as `YYYY-MM-DD`.
func ParseDate(cell string) (string, bool) {
	cell = strings.ReplaceAll(strings.TrimSpace(cell), "/", "-")
	t, err := time.Parse("2006-1-2", cell)
	if err != nil {
		return "", false
	}
	return t.Format(DateLayout), true
}

// reimbursementCell reads a Reimbursement cell leniently (case, spaces);
// anything unknown is none.
func reimbursementCell(cell string) Reimbursement {
	switch r := Reimbursement(strings.ToLower(strings.TrimSpace(cell))); r {
	case ReimbursementPending, ReimbursementDone:
		return r
	default:
		return ReimbursementNone
	}
}

func parseStatus(cell string) Status {
	if Status(strings.ToLower(strings.TrimSpace(cell))) == StatusDeleted {
		return StatusDeleted
	}
	return StatusActive
}
