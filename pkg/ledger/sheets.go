package ledger

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/sheets/v4"

	"github.com/nayan9229/ExpenseManager/pkg/googleclient"
)

// Sheets is the production Ledger, backed by the Sheets v4 API. It uses
// Drive only to find or create the spreadsheet inside the Household folder
// when no sheet ID is configured.
type Sheets struct {
	sheets   *sheets.Service
	drive    *drive.Service
	folderID string
	sheetID  string
}

// NewSheets wraps authenticated services. folderID is the Household folder;
// sheetID may be blank, in which case the Ledger is the spreadsheet called
// SpreadsheetName in that folder.
func NewSheets(sheetsSvc *sheets.Service, driveSvc *drive.Service, folderID, sheetID string) *Sheets {
	return &Sheets{sheets: sheetsSvc, drive: driveSvc, folderID: folderID, sheetID: sheetID}
}

// numericColumns are the only columns that should hold numbers. Every other
// column of a tab Bootstrap creates is formatted as plain text, so a PIN of
// `0123` keeps its zero and a date stays `YYYY-MM-DD` when the Admin types it.
var numericColumns = map[string]bool{"Amount": true, "Monthly_Budget_Limit": true, "Due_Day_Of_Month": true}

// locate returns the spreadsheet ID: the configured one, else the file named
// SpreadsheetName in the folder, created when create is true.
func (s *Sheets) locate(ctx context.Context, create bool) (id string, created bool, err error) {
	if s.sheetID != "" {
		return s.sheetID, false, nil
	}
	id, err = googleclient.FindChild(ctx, s.drive, s.folderID, SpreadsheetName, googleclient.SpreadsheetMIME)
	if err != nil {
		return "", false, err
	}
	if id != "" {
		return id, false, nil
	}
	if !create {
		return "", false, ErrNotFound
	}
	id, err = googleclient.CreateChild(ctx, s.drive, s.folderID, SpreadsheetName, googleclient.SpreadsheetMIME)
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// Ensure implements Ledger.
func (s *Sheets) Ensure(ctx context.Context) (Report, error) {
	id, createdSpreadsheet, err := s.locate(ctx, true)
	if err != nil {
		return Report{}, err
	}
	report := Report{SpreadsheetID: id, URL: URLFor(id), SpreadsheetCreated: createdSpreadsheet, TabCreated: map[Tab]bool{}}

	ss, err := s.sheets.Spreadsheets.Get(id).Fields("sheets.properties(sheetId,title)").Context(ctx).Do()
	if err != nil {
		return Report{}, s.wrap("get spreadsheet", err)
	}
	existing := map[string]bool{}
	for _, sh := range ss.Sheets {
		existing[sh.Properties.Title] = true
	}
	var missing []Tab
	var addSheets []*sheets.Request
	for _, tab := range Tabs {
		if existing[string(tab)] {
			continue
		}
		missing = append(missing, tab)
		addSheets = append(addSheets, &sheets.Request{AddSheet: &sheets.AddSheetRequest{
			Properties: &sheets.SheetProperties{
				Title:          string(tab),
				GridProperties: &sheets.GridProperties{FrozenRowCount: 1},
			},
		}})
	}
	if len(missing) == 0 {
		return report, nil
	}

	added, err := s.sheets.Spreadsheets.BatchUpdate(id, &sheets.BatchUpdateSpreadsheetRequest{Requests: addSheets}).Context(ctx).Do()
	if err != nil {
		return Report{}, s.wrap("add tabs", err)
	}
	var formats []*sheets.Request
	var headers []*sheets.ValueRange
	for i, tab := range missing {
		sheetID := added.Replies[i].AddSheet.Properties.SheetId
		formats = append(formats, formatRequests(sheetID, Columns[tab])...)
		headers = append(headers, &sheets.ValueRange{Range: a1(tab, "A1"), Values: [][]any{toAny(Columns[tab])}})
		report.TabCreated[tab] = true
	}
	if createdSpreadsheet && len(ss.Sheets) == 1 {
		// A spreadsheet Drive just created holds one empty default sheet;
		// drop it so the Ledger has exactly the four tabs.
		formats = append(formats, &sheets.Request{DeleteSheet: &sheets.DeleteSheetRequest{SheetId: ss.Sheets[0].Properties.SheetId}})
	}
	if _, err := s.sheets.Spreadsheets.BatchUpdate(id, &sheets.BatchUpdateSpreadsheetRequest{Requests: formats}).Context(ctx).Do(); err != nil {
		return Report{}, s.wrap("format tabs", err)
	}
	if _, err := s.sheets.Spreadsheets.Values.BatchUpdate(id, &sheets.BatchUpdateValuesRequest{
		ValueInputOption: "RAW",
		Data:             headers,
	}).Context(ctx).Do(); err != nil {
		return Report{}, s.wrap("write headers", err)
	}
	return report, nil
}

// formatRequests bolds the header and formats every non-numeric column of a
// new tab as plain text, in as few requests as contiguous runs allow.
func formatRequests(sheetID int64, columns []string) []*sheets.Request {
	reqs := []*sheets.Request{{RepeatCell: &sheets.RepeatCellRequest{
		Range:  &sheets.GridRange{SheetId: sheetID, StartRowIndex: 0, EndRowIndex: 1},
		Cell:   &sheets.CellData{UserEnteredFormat: &sheets.CellFormat{TextFormat: &sheets.TextFormat{Bold: true}}},
		Fields: "userEnteredFormat.textFormat.bold",
	}}}
	start := -1
	flush := func(end int) {
		if start < 0 {
			return
		}
		reqs = append(reqs, &sheets.Request{RepeatCell: &sheets.RepeatCellRequest{
			Range: &sheets.GridRange{
				SheetId:          sheetID,
				StartRowIndex:    1,
				StartColumnIndex: int64(start),
				EndColumnIndex:   int64(end),
				ForceSendFields:  []string{"StartColumnIndex"},
			},
			Cell:   &sheets.CellData{UserEnteredFormat: &sheets.CellFormat{NumberFormat: &sheets.NumberFormat{Type: "TEXT"}}},
			Fields: "userEnteredFormat.numberFormat",
		}})
		start = -1
	}
	for i, col := range columns {
		if numericColumns[col] {
			flush(i)
			continue
		}
		if start < 0 {
			start = i
		}
	}
	flush(len(columns))
	return reqs
}

// Read implements Ledger.
func (s *Sheets) Read(ctx context.Context, tabs ...Tab) (Snapshot, error) {
	id, _, err := s.locate(ctx, false)
	if err != nil {
		return Snapshot{}, err
	}
	ranges := make([]string, len(tabs))
	for i, tab := range tabs {
		ranges[i] = a1(tab, "")
	}
	resp, err := s.sheets.Spreadsheets.Values.BatchGet(id).
		Ranges(ranges...).
		MajorDimension("ROWS").
		ValueRenderOption("UNFORMATTED_VALUE").
		DateTimeRenderOption("FORMATTED_STRING").
		Context(ctx).
		Do()
	if err != nil {
		return Snapshot{}, s.wrap("read", err)
	}
	snap := Snapshot{URL: URLFor(id), Rows: map[Tab][][]string{}}
	for i, tab := range tabs {
		var values [][]any
		if i < len(resp.ValueRanges) {
			values = resp.ValueRanges[i].Values
		}
		rows := [][]string{}
		for r, cells := range values {
			if r == 0 {
				continue // the header
			}
			row := make([]string, len(cells))
			for c, cell := range cells {
				row[c] = cellString(cell)
			}
			rows = append(rows, padRow(row, len(Columns[tab])))
		}
		snap.Rows[tab] = rows
	}
	return snap, nil
}

// Append implements Ledger.
func (s *Sheets) Append(ctx context.Context, tab Tab, rows [][]string) error {
	if len(rows) == 0 {
		return nil
	}
	id, _, err := s.locate(ctx, false)
	if err != nil {
		return err
	}
	values := make([][]any, len(rows))
	for i, row := range rows {
		values[i] = userEntered(row)
	}
	_, err = s.sheets.Spreadsheets.Values.Append(id, a1(tab, ""), &sheets.ValueRange{Values: values}).
		ValueInputOption("USER_ENTERED").
		InsertDataOption("INSERT_ROWS").
		Context(ctx).
		Do()
	return s.wrap("append", err)
}

// Update implements Ledger.
func (s *Sheets) Update(ctx context.Context, tab Tab, index int, row []string) error {
	if index < 0 {
		return fmt.Errorf("ledger: no row %d in %s", index, tab)
	}
	id, _, err := s.locate(ctx, false)
	if err != nil {
		return err
	}
	_, err = s.sheets.Spreadsheets.Values.Update(id, a1(tab, "A"+strconv.Itoa(index+2)), &sheets.ValueRange{Values: [][]any{userEntered(row)}}).
		ValueInputOption("USER_ENTERED").
		Context(ctx).
		Do()
	return s.wrap("update", err)
}

// wrap turns a Sheets API error into something the handler can map: a
// missing spreadsheet or tab becomes ErrNotFound, anything else is prefixed.
func (s *Sheets) wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	var gerr *googleapi.Error
	if errors.As(err, &gerr) {
		if gerr.Code == 404 || (gerr.Code == 400 && strings.Contains(gerr.Message, "Unable to parse range")) {
			return fmt.Errorf("%w: %s: %v", ErrNotFound, op, err)
		}
	}
	return fmt.Errorf("ledger: %s: %w", op, err)
}

// a1 builds a quoted A1 reference like `'Recurring_Rules'!A1`; a blank cell
// reference means the whole tab.
func a1(tab Tab, cell string) string {
	if cell == "" {
		return "'" + string(tab) + "'"
	}
	return "'" + string(tab) + "'!" + cell
}

// userEntered prepares a row for USER_ENTERED: numbers and dates are parsed
// as the Admin would type them, and no cell can become a formula (see
// escapeText).
func userEntered(row []string) []any {
	out := make([]any, len(row))
	for i, cell := range row {
		out[i] = escapeText(cell)
	}
	return out
}

func toAny(row []string) []any {
	out := make([]any, len(row))
	for i, cell := range row {
		out[i] = cell
	}
	return out
}

// cellString renders an UNFORMATTED_VALUE cell as the text the Admin typed.
func cellString(v any) string {
	switch cell := v.(type) {
	case nil:
		return ""
	case string:
		return cell
	case float64:
		return strconv.FormatFloat(cell, 'f', -1, 64)
	case bool:
		if cell {
			return "TRUE"
		}
		return "FALSE"
	default:
		return fmt.Sprint(cell)
	}
}
