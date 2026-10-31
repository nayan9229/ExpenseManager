package expenses

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
)

// DuplicateReceipt is the 409 body: the envelope plus the Expense that
// already holds this Receipt, so the form can say when and how much.
type DuplicateReceipt struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	Expense Expense `json:"expense"`
}

var (
	hashPattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	fileIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)
)

// attachReceipt runs the Receipt half of a create (spec "Expense API
// contract", Create): the duplicate check on File_Hash, then the file is
// verified to sit in the Receipt Store, given its final name in the month
// folder of the Expense Date, and linked in expense. It writes the error
// response and reports false when the create must stop.
func (s Service) attachReceipt(w http.ResponseWriter, r *http.Request, req CreateRequest, rows [][]string, expense *ledger.Expense) bool {
	hash := strings.ToLower(strings.TrimSpace(req.FileHash))
	fileID := strings.TrimSpace(req.DriveFileID)
	switch {
	case !fileIDPattern.MatchString(fileID):
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "INVALID_RECEIPT", "The Receipt's Drive file ID is malformed or missing")
		return false
	case !hashPattern.MatchString(hash):
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "INVALID_RECEIPT", "The Receipt's file hash must be hex SHA-256")
		return false
	}

	if !req.Force {
		for _, e := range ledger.ParseExpenses(rows) {
			if e.Status == ledger.StatusActive && e.FileHash == hash {
				httpjson.Write(w, http.StatusConflict, DuplicateReceipt{
					Code:    "DUPLICATE_RECEIPT",
					Message: fmt.Sprintf("This receipt was already added on %s for ₹%s", e.ExpenseDate, amountText(e.Amount)),
					Expense: viewOf(e),
				})
				return false
			}
		}
	}

	ctx := r.Context()
	file, err := receiptstore.Locate(ctx, s.Store, s.FolderID, fileID)
	if errors.Is(err, receiptstore.ErrNotFound) || errors.Is(err, receiptstore.ErrNotAReceipt) {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "RECEIPT_NOT_IN_STORE", "The Receipt is not in the Receipt Store; scan it again")
		return false
	}
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return false
	}
	date, _ := time.ParseInLocation(ledger.DateLayout, expense.ExpenseDate, ledger.IST)
	month, err := receiptstore.EnsureMonthFolder(ctx, s.Store, s.FolderID, date)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return false
	}
	rename := receiptstore.Rename{
		FileID: file.ID,
		Name:   receiptstore.FinalName(expense.ExpenseDate, expense.Category, expense.MerchantNote, expense.Amount, receiptstore.Extension(file.Name, file.MIMEType)),
	}
	if current := file.Parents[0]; current != month.ID {
		rename.AddParent, rename.RemoveParent = month.ID, current
	}
	renamed, err := s.Store.Rename(ctx, rename)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return false
	}
	expense.DriveFileID = renamed.ID
	expense.DriveViewURL = renamed.WebViewLink
	if expense.DriveViewURL == "" {
		expense.DriveViewURL = "https://drive.google.com/file/d/" + renamed.ID + "/view"
	}
	expense.FileHash = hash
	return true
}

// amountText is rupees for a sentence: whole rupees bare, else two decimals.
func amountText(amount float64) string {
	if amount == float64(int64(amount)) {
		return fmt.Sprintf("%d", int64(amount))
	}
	return fmt.Sprintf("%.2f", amount)
}
