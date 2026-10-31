// Package bootstrap implements the `bootstrap` function: making sure the
// Receipt Store and the Ledger exist with their tabs, headers and seed rows
// (GLOSSARY: Bootstrap; spec "Bootstrap"; user stories 67 and 68).
//
// Every step checks before it creates, so the function is safe to run from
// every device on first pairing and from the Admin's Repair button. The
// response says what was found and what was created.
package bootstrap

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// ReceiptsFolderName is the top of the Receipt Store tree inside the
// configured Drive folder.
const ReceiptsFolderName = "Receipts"

// Service is the function with its Google seams injected. Production wires
// the real Drive and Sheets (see Handler); tests inject the fakes.
type Service struct {
	Store  receiptstore.Store
	Ledger ledger.Ledger
	// FolderID is the Drive folder the Household lives in (GOOGLE_DRIVE_FOLDER_ID).
	FolderID string
}

// Item is one thing Bootstrap ensured.
type Item struct {
	ID      string `json:"id,omitempty"`
	URL     string `json:"url,omitempty"`
	Created bool   `json:"created"`
}

// Report is the response body: what was found and what was created.
type Report struct {
	ReceiptsFolder Item `json:"receiptsFolder"`
	Ledger         Item `json:"ledger"`
	// Tabs maps each tab name to whether this run created it.
	Tabs map[ledger.Tab]Item `json:"tabs"`
	// Seeded maps each tab name to the number of seed rows this run wrote;
	// 0 means the tab already had rows (or has no seeds).
	Seeded map[ledger.Tab]int `json:"seeded"`
}

// Handler is the guarded function: a valid Session first, then the work.
func (s Service) Handler() http.HandlerFunc {
	return session.Require(s.serve)
}

// rejectMethod answers 405 for anything but POST and reports whether it did.
// It runs before the environment is read, so a wrong method is never
// mistaken for a misconfigured server.
func rejectMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodPost {
		return false
	}
	w.Header().Set("Allow", "POST")
	httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "bootstrap accepts POST only")
	return true
}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if rejectMethod(w, r) {
		return
	}
	ctx := r.Context()

	folder, err := s.Store.EnsureFolder(ctx, s.FolderID, ReceiptsFolderName)
	if err != nil {
		googleFailed(w, err)
		return
	}
	ensured, err := s.Ledger.Ensure(ctx)
	if err != nil {
		googleFailed(w, err)
		return
	}
	report := Report{
		ReceiptsFolder: Item{ID: folder.ID, Created: folder.Created},
		Ledger:         Item{ID: ensured.SpreadsheetID, URL: ensured.URL, Created: ensured.SpreadsheetCreated},
		Tabs:           map[ledger.Tab]Item{},
		Seeded:         map[ledger.Tab]int{},
	}
	for _, tab := range ledger.Tabs {
		report.Tabs[tab] = Item{Created: ensured.TabCreated[tab]}
		report.Seeded[tab] = 0
	}

	snap, err := s.Ledger.Read(ctx, ledger.Members, ledger.Categories)
	if err != nil {
		googleFailed(w, err)
		return
	}
	for _, tab := range []ledger.Tab{ledger.Members, ledger.Categories} {
		if hasRows(snap.Rows[tab]) {
			continue
		}
		rows := seedRows(tab)
		if err := s.Ledger.Append(ctx, tab, rows); err != nil {
			googleFailed(w, err)
			return
		}
		report.Seeded[tab] = len(rows)
	}

	httpjson.Write(w, http.StatusOK, report)
}

// hasRows reports whether a tab holds at least one non-blank row. A tab the
// Admin emptied by hand but left with blank lines still counts as empty.
func hasRows(rows [][]string) bool {
	for _, row := range rows {
		if !ledger.IsBlank(row) {
			return true
		}
	}
	return false
}

// googleFailed reports a Drive or Sheets failure. The upstream message is
// passed through: this is a family app and the Admin is the one debugging.
func googleFailed(w http.ResponseWriter, err error) {
	httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
}

// Handler is the production entry point: the Session is checked first, then
// the Google seams are built from the environment for this one request.
func Handler(w http.ResponseWriter, r *http.Request) {
	session.Require(func(w http.ResponseWriter, r *http.Request) {
		if rejectMethod(w, r) {
			return
		}
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
			return
		}
		Service{Store: d.Store, Ledger: d.Ledger, FolderID: d.FolderID}.serve(w, r)
	})(w, r)
}
