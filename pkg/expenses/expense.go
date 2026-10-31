package expenses

import "github.com/nayan9229/ExpenseManager/pkg/ledger"

// Expense is an Expenses row as the client sees it, in both the read model
// and the POST answer.
type Expense struct {
	ID          string `json:"id"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	ExpenseDate string `json:"expenseDate"`
	LoggedBy    string `json:"loggedBy"`
	PaidBy      string `json:"paidBy"`
	// Amount is rupees with at most two decimals.
	Amount              float64              `json:"amount"`
	Currency            string               `json:"currency"`
	Category            string               `json:"category"`
	MerchantNote        string               `json:"merchantNote"`
	PaymentMethod       ledger.PaymentMethod `json:"paymentMethod"`
	DriveFileID         string               `json:"driveFileId"`
	DriveViewURL        string               `json:"driveViewUrl"`
	FileHash            string               `json:"fileHash"`
	ReimbursementStatus ledger.Reimbursement `json:"reimbursementStatus"`
	Status              ledger.Status        `json:"status"`
}

func viewOf(e ledger.Expense) Expense {
	return Expense{
		ID: e.ID, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, ExpenseDate: e.ExpenseDate,
		LoggedBy: e.LoggedBy, PaidBy: e.PaidBy, Amount: e.Amount, Currency: e.Currency,
		Category: e.Category, MerchantNote: e.MerchantNote, PaymentMethod: e.PaymentMethod,
		DriveFileID: e.DriveFileID, DriveViewURL: e.DriveViewURL, FileHash: e.FileHash,
		ReimbursementStatus: e.Reimbursement, Status: e.Status,
	}
}
