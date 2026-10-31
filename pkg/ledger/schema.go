// Package ledger is the Ledger seam: the Google Sheet that holds Expenses,
// Members, Categories and Recurring Rules (GLOSSARY: Ledger; ADR-0001).
// Sheets is the production implementation; Fake is what handler tests inject.
//
// The package also owns the schema (tab names and column order are the
// contract), the tolerant row parsing ADR-0001 demands, and the struct-to-row
// mapping that keeps column order in one place.
package ledger

import "context"

// Tab names the four sheets inside the Ledger.
type Tab string

const (
	Expenses       Tab = "Expenses"
	Members        Tab = "Members"
	Categories     Tab = "Categories"
	RecurringRules Tab = "Recurring_Rules"
)

// Tabs lists every tab Bootstrap ensures, in creation order.
var Tabs = []Tab{Expenses, Members, Categories, RecurringRules}

// Columns is the header row of each tab. The order is the contract (spec:
// "Ledger schema"); new columns may only be appended.
var Columns = map[Tab][]string{
	Expenses: {
		"ID", "Created_At", "Updated_At", "Expense_Date", "Logged_By", "Paid_By", "Amount", "Currency",
		"Category", "Merchant_Note", "Payment_Method", "Drive_File_ID", "Drive_View_URL", "File_Hash",
		"Reimbursement_Status", "Status",
	},
	Members:        {"Member_ID", "Name", "Role", "Default_Payment_Method", "PIN_Code", "Avatar_Color"},
	Categories:     {"Category_Name", "Icon_Emoji", "Color_Hex", "Monthly_Budget_Limit", "Visible_To_Roles"},
	RecurringRules: {"Rule_ID", "Title", "Amount", "Category", "Due_Day_Of_Month"},
}

// SpreadsheetName is what Bootstrap calls the Ledger it creates when no
// sheet ID is configured.
const SpreadsheetName = "Expenses_Database"

// Ledger is what the handlers talk to. Every method is one or two Google
// round-trips; callers batch by asking for several tabs at once.
type Ledger interface {
	// Ensure finds or creates the Ledger spreadsheet, then every missing tab
	// with its header row written and frozen. Existing tabs are left alone,
	// so running it twice changes nothing.
	Ensure(ctx context.Context) (Report, error)
	// Read returns the data rows (everything below the header) of each tab
	// in one round-trip. Rows are padded to the tab's column count and blank
	// rows are kept, so an index into Rows[tab] is stable for Update.
	Read(ctx context.Context, tabs ...Tab) (Snapshot, error)
	// Append adds rows after the last row of a tab.
	Append(ctx context.Context, tab Tab, rows [][]string) error
	// Update rewrites one data row; index 0 is the first row below the header.
	Update(ctx context.Context, tab Tab, index int, row []string) error
}

// Report says what Ensure found and what it had to create.
type Report struct {
	SpreadsheetID      string
	URL                string
	SpreadsheetCreated bool
	// TabCreated is true for a tab this call added, false for one it found.
	TabCreated map[Tab]bool
}

// Snapshot is what Read returns: the rows per requested tab plus the
// Ledger's URL for humans.
type Snapshot struct {
	URL  string
	Rows map[Tab][][]string
}

// URLFor is the browser link to a spreadsheet.
func URLFor(spreadsheetID string) string {
	return "https://docs.google.com/spreadsheets/d/" + spreadsheetID
}

// padRow returns row extended with blanks to width cells.
func padRow(row []string, width int) []string {
	if len(row) >= width {
		return row
	}
	padded := make([]string, width)
	copy(padded, row)
	return padded
}

// IsBlank reports whether every cell of row is empty.
func IsBlank(row []string) bool {
	for _, cell := range row {
		if cell != "" {
			return false
		}
	}
	return true
}
