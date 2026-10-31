package ledger

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"

	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

// fakeSheetsAPI is a stand-in for sheets.googleapis.com that stores what
// values.append / values.update send and serves it back from values.batchGet.
// It models USER_ENTERED the way Google documents it ("parsed as if the user
// typed them into the UI"): a leading apostrophe forces text and is not
// stored, a leading `=` (or a non-numeric `+`/`-`/`@`) becomes a formula,
// a numeric string becomes a number.
type fakeSheetsAPI struct {
	mu       sync.Mutex
	tabs     map[string][][]any
	formulas []string
	options  []string
}

func newFakeSheetsAPI(t *testing.T) (*fakeSheetsAPI, *Sheets) {
	t.Helper()
	api := &fakeSheetsAPI{tabs: map[string][][]any{}}
	for _, tab := range Tabs {
		api.tabs[string(tab)] = [][]any{toAny(Columns[tab])}
	}
	srv := httptest.NewServer(api)
	t.Cleanup(srv.Close)
	svc, err := sheets.NewService(context.Background(), option.WithEndpoint(srv.URL+"/"), option.WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatal(err)
	}
	return api, NewSheets(svc, nil, "", "sheet-1")
}

func (api *fakeSheetsAPI) userEntered(cell string) any {
	switch {
	case strings.HasPrefix(cell, "'"):
		return cell[1:]
	case cell == "":
		return nil
	}
	if f, err := strconv.ParseFloat(cell, 64); err == nil {
		return f
	}
	if strings.ContainsRune("=+-@", rune(cell[0])) {
		api.formulas = append(api.formulas, cell)
		return "#ERROR!"
	}
	return cell
}

func tabOf(rangeRef string) string {
	tab, _, _ := strings.Cut(rangeRef, "!")
	return strings.Trim(tab, "'")
}

func (api *fakeSheetsAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	api.mu.Lock()
	defer api.mu.Unlock()
	path, _ := url.PathUnescape(r.URL.EscapedPath())
	const prefix = "/v4/spreadsheets/sheet-1/values"
	if !strings.HasPrefix(path, prefix) {
		http.Error(w, "unexpected "+path, http.StatusNotFound)
		return
	}
	rest := strings.TrimPrefix(path, prefix)
	switch {
	case r.Method == http.MethodGet && rest == ":batchGet":
		var ranges []map[string]any
		for _, ref := range r.URL.Query()["ranges"] {
			ranges = append(ranges, map[string]any{"range": ref, "values": api.tabs[tabOf(ref)]})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"valueRanges": ranges})
	case r.Method == http.MethodPost && strings.HasSuffix(rest, ":append"), r.Method == http.MethodPut:
		api.options = append(api.options, r.URL.Query().Get("valueInputOption"))
		var body struct{ Values [][]string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ref := strings.TrimSuffix(strings.TrimPrefix(rest, "/"), ":append")
		tab := tabOf(ref)
		for _, row := range body.Values {
			stored := make([]any, len(row))
			for i, cell := range row {
				stored[i] = api.userEntered(cell)
			}
			if r.Method == http.MethodPut {
				_, cellRef, _ := strings.Cut(ref, "!")
				n, _ := strconv.Atoi(strings.TrimPrefix(cellRef, "A"))
				api.tabs[tab][n-1] = stored
			} else {
				api.tabs[tab] = append(api.tabs[tab], stored)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{})
	default:
		http.Error(w, "unexpected "+r.Method+" "+path, http.StatusNotFound)
	}
}

func TestANoteThatLooksLikeAFormulaIsStoredAsLiteralText(t *testing.T) {
	api, ledger := newFakeSheetsAPI(t)
	ctx := context.Background()
	e := sampleExpense()
	notes := []string{`=HYPERLINK("https://evil.example","click")`, "+91 98765 43210", "-50 discount", "@papa", "medicines for Papa"}

	for i, note := range notes {
		e.ID = "id-" + strconv.Itoa(i)
		e.MerchantNote = note
		if err := ledger.Append(ctx, Expenses, [][]string{e.Row()}); err != nil {
			t.Fatal(err)
		}
	}
	snap, err := ledger.Read(ctx, Expenses)
	if err != nil {
		t.Fatal(err)
	}

	if len(api.formulas) != 0 {
		t.Errorf("Sheets evaluated formulas %q", api.formulas)
	}
	got := ParseExpenses(snap.Rows[Expenses])
	if len(got) != len(notes) {
		t.Fatalf("read back %d Expenses, want %d: %+v", len(got), len(notes), got)
	}
	for i, note := range notes {
		if got[i].MerchantNote != note {
			t.Errorf("note %d read back as %q, want %q", i, got[i].MerchantNote, note)
		}
	}
}

func TestTheAmountStaysANumberAndTheDateKeepsItsShape(t *testing.T) {
	api, ledger := newFakeSheetsAPI(t)
	ctx := context.Background()

	if err := ledger.Append(ctx, Expenses, [][]string{sampleExpense().Row()}); err != nil {
		t.Fatal(err)
	}

	if want := []string{"USER_ENTERED"}; strings.Join(api.options, ",") != strings.Join(want, ",") {
		t.Errorf("valueInputOption = %v, want %v", api.options, want)
	}
	stored := api.tabs[string(Expenses)][1]
	if amount, ok := stored[6].(float64); !ok || amount != 450 {
		t.Errorf("Amount cell = %#v, want the number 450", stored[6])
	}
	if stored[3] != "2026-10-30" {
		t.Errorf("Expense_Date cell = %#v, want 2026-10-30", stored[3])
	}
}

func TestAnUpdateIsGuardedToo(t *testing.T) {
	api, ledger := newFakeSheetsAPI(t)
	ctx := context.Background()
	e := sampleExpense()
	if err := ledger.Append(ctx, Expenses, [][]string{e.Row()}); err != nil {
		t.Fatal(err)
	}

	e.MerchantNote = "=IMPORTXML(A1)"
	if err := ledger.Update(ctx, Expenses, 0, e.Row()); err != nil {
		t.Fatal(err)
	}

	if len(api.formulas) != 0 {
		t.Errorf("Sheets evaluated formulas %q", api.formulas)
	}
	if got := api.tabs[string(Expenses)][1][9]; got != "=IMPORTXML(A1)" {
		t.Errorf("note cell = %#v, want the literal text", got)
	}
}
