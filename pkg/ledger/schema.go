// Package ledger is the Ledger seam: the Google Sheet that holds Expenses,
// Members, Categories and Recurring Rules (GLOSSARY: Ledger; ADR-0001).
// Sheets is the production implementation; Fake is what handler tests inject.
//
// The package also owns the schema (tab names and column order are the
// contract), the tolerant row parsing ADR-0001 demands, and the struct-to-row
// mapping that keeps column order in one place.
package ledger

import (
	"context"
	"strings"
	"time"
)

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
	// with its header row written and frozen. An existing tab is repaired:
	// row 1 is frozen, and an empty row 1 gets the headers; a non-empty row 1
	// that is not the headers is left alone and reported. Running it twice
	// changes nothing.
	Ensure(ctx context.Context) (Report, error)
	// Read returns the data rows (everything below the header) of each tab
	// in one round-trip. Rows are padded to the tab's column count and blank
	// rows are kept, so an index into Rows[tab] is stable for Update.
	Read(ctx context.Context, tabs ...Tab) (Snapshot, error)
	// Append adds rows after the last row of a tab. Cells are parsed as the
	// Admin would type them (numbers stay numbers) but never as a formula.
	Append(ctx context.Context, tab Tab, rows [][]string) error
	// Update rewrites one data row; index 0 is the first row below the header.
	// The same no-formula rule as Append applies.
	Update(ctx context.Context, tab Tab, index int, row []string) error
}

// Report says what Ensure found and what it had to create.
type Report struct {
	SpreadsheetID      string
	URL                string
	SpreadsheetCreated bool
	// TabCreated is true for a tab this call added, false for one it found.
	TabCreated map[Tab]bool
	// HeaderWritten is true for a found tab whose empty row 1 this call
	// filled with the headers.
	HeaderWritten map[Tab]bool
	// HeaderMismatch holds row 1 of each found tab whose row 1 is neither
	// empty nor the headers; Ensure did not touch it.
	HeaderMismatch map[Tab][]string
}

// HeaderState is what row 1 of a found tab holds.
type HeaderState int

const (
	// HeaderOK is the schema's header, perhaps followed by columns the Admin
	// appended.
	HeaderOK HeaderState = iota
	// HeaderEmpty is a blank row 1: Ensure writes the headers.
	HeaderEmpty
	// HeaderMismatched is anything else: Ensure leaves it for the Admin.
	HeaderMismatched
)

// CheckHeader compares row 1 of tab with Columns[tab], ignoring surrounding
// spaces.
func CheckHeader(tab Tab, row []string) HeaderState {
	if strings.TrimSpace(strings.Join(row, "")) == "" {
		return HeaderEmpty
	}
	want := Columns[tab]
	if len(row) < len(want) {
		return HeaderMismatched
	}
	for i, col := range want {
		if strings.TrimSpace(row[i]) != col {
			return HeaderMismatched
		}
	}
	return HeaderOK
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

// IST is the Household's clock: every server timestamp is written in it.
var IST = time.FixedZone("IST", 5*60*60+30*60)
