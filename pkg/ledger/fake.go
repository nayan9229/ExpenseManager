package ledger

import (
	"context"
	"fmt"
	"sync"
)

// Fake is an in-memory Ledger for tests. Exported fields are for setup and
// assertions; the methods are the seam under test.
type Fake struct {
	mu sync.Mutex
	// Exists models the spreadsheet: false is an empty Drive, true is a
	// configured sheet ID or an earlier Bootstrap.
	Exists bool
	tabs   map[Tab]*FakeTab
	// Writes counts calls that changed something.
	Writes int
	// Err, when set, is returned by every call.
	Err error
}

// FakeTab is one sheet inside the Fake.
type FakeTab struct {
	Header []string
	Frozen bool
	Rows   [][]string
}

// FakeSpreadsheetID is the ID the Fake reports.
const FakeSpreadsheetID = "fake-ledger"

// NewFake returns a Drive with no Ledger in it.
func NewFake() *Fake { return &Fake{tabs: map[Tab]*FakeTab{}} }

// Seed creates tab with the schema header, frozen, holding rows, and marks
// the spreadsheet as existing. It is test setup, not part of the seam.
func (f *Fake) Seed(tab Tab, rows ...[]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Exists = true
	t := &FakeTab{Header: append([]string(nil), Columns[tab]...), Frozen: true}
	for _, row := range rows {
		t.Rows = append(t.Rows, padRow(append([]string(nil), row...), len(Columns[tab])))
	}
	f.tabs[tab] = t
}

// Tab returns the sheet called tab, or nil when it does not exist.
func (f *Fake) Tab(tab Tab) *FakeTab {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.tabs[tab]
}

// Ensure implements Ledger.
func (f *Fake) Ensure(context.Context) (Report, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return Report{}, f.Err
	}
	report := Report{SpreadsheetID: FakeSpreadsheetID, URL: URLFor(FakeSpreadsheetID), TabCreated: map[Tab]bool{}}
	if !f.Exists {
		f.Exists = true
		f.Writes++
		report.SpreadsheetCreated = true
	}
	for _, tab := range Tabs {
		if _, ok := f.tabs[tab]; ok {
			continue
		}
		f.tabs[tab] = &FakeTab{Header: append([]string(nil), Columns[tab]...), Frozen: true}
		f.Writes++
		report.TabCreated[tab] = true
	}
	return report, nil
}

// Read implements Ledger.
func (f *Fake) Read(_ context.Context, tabs ...Tab) (Snapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return Snapshot{}, f.Err
	}
	if !f.Exists {
		return Snapshot{}, ErrNotFound
	}
	snap := Snapshot{URL: URLFor(FakeSpreadsheetID), Rows: map[Tab][][]string{}}
	for _, tab := range tabs {
		t, ok := f.tabs[tab]
		if !ok {
			return Snapshot{}, fmt.Errorf("%w: tab %s", ErrNotFound, tab)
		}
		rows := make([][]string, len(t.Rows))
		for i, row := range t.Rows {
			rows[i] = padRow(append([]string(nil), row...), len(Columns[tab]))
		}
		snap.Rows[tab] = rows
	}
	return snap, nil
}

// Append implements Ledger.
func (f *Fake) Append(_ context.Context, tab Tab, rows [][]string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	t, ok := f.tabs[tab]
	if !ok {
		return fmt.Errorf("%w: tab %s", ErrNotFound, tab)
	}
	for _, row := range rows {
		t.Rows = append(t.Rows, padRow(append([]string(nil), row...), len(Columns[tab])))
	}
	if len(rows) > 0 {
		f.Writes++
	}
	return nil
}

// Update implements Ledger.
func (f *Fake) Update(_ context.Context, tab Tab, index int, row []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	t, ok := f.tabs[tab]
	if !ok {
		return fmt.Errorf("%w: tab %s", ErrNotFound, tab)
	}
	if index < 0 || index >= len(t.Rows) {
		return fmt.Errorf("ledger: no row %d in %s", index, tab)
	}
	t.Rows[index] = padRow(append([]string(nil), row...), len(Columns[tab]))
	f.Writes++
	return nil
}

// Dump copies every tab, for before/after comparisons in tests.
func (f *Fake) Dump() map[Tab]FakeTab {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[Tab]FakeTab{}
	for tab, t := range f.tabs {
		rows := make([][]string, len(t.Rows))
		for i, row := range t.Rows {
			rows[i] = append([]string(nil), row...)
		}
		out[tab] = FakeTab{Header: append([]string(nil), t.Header...), Frozen: t.Frozen, Rows: rows}
	}
	return out
}
