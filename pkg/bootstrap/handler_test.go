package bootstrap_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/bootstrap"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const (
	jwtSecret       = "test-secret-at-least-32-characters-long"
	householdFolder = "household-folder"
)

// fixture is the bootstrap function wired to in-memory Google services.
type fixture struct {
	store  *receiptstore.Fake
	ledger *ledger.Fake
	srv    *httptest.Server
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	f := fixture{store: receiptstore.NewFake(), ledger: ledger.NewFake()}
	svc := bootstrap.Service{Store: f.store, Ledger: f.ledger, FolderID: householdFolder}
	f.srv = httptest.NewServer(svc.Handler())
	t.Cleanup(f.srv.Close)
	return f
}

func pairedCookie(t *testing.T) *http.Cookie {
	t.Helper()
	now := time.Now()
	token, err := session.Sign([]byte(jwtSecret), session.Claims{DeviceID: "dev-1", IssuedAt: now.Unix(), ExpiresAt: now.Add(session.Lifetime).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: session.CookieName, Value: token}
}

func call(t *testing.T, srv *httptest.Server, method string, cookie *http.Cookie) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+"/api/bootstrap", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return res.StatusCode, body
}

// run posts to bootstrap as a paired device and returns the report.
func run(t *testing.T, f fixture) map[string]any {
	t.Helper()
	status, body := call(t, f.srv, http.MethodPost, pairedCookie(t))
	if status != http.StatusOK {
		t.Fatalf("status = %d body = %v, want 200", status, body)
	}
	return body
}

func created(t *testing.T, body map[string]any, path ...string) bool {
	t.Helper()
	var cur any = body
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("%v is not an object at %q in %v", cur, key, body)
		}
		cur = m[key]
	}
	m, ok := cur.(map[string]any)
	if !ok {
		t.Fatalf("no object at %v in %v", path, body)
	}
	v, ok := m["created"].(bool)
	if !ok {
		t.Fatalf("no boolean created at %v in %v", path, body)
	}
	return v
}

func TestFirstRunCreatesTheReceiptStoreAndTheLedger(t *testing.T) {
	f := newFixture(t)

	report := run(t, f)

	if !created(t, report, "receiptsFolder") {
		t.Errorf("receiptsFolder.created = false, want true on an empty Drive: %v", report)
	}
	if folder := f.store.Find(householdFolder, "Receipts"); folder == nil {
		t.Errorf("no Receipts folder under %q in %+v", householdFolder, f.store.Folders)
	} else if folder.ID != report["receiptsFolder"].(map[string]any)["id"] {
		t.Errorf("report names folder %v, store has %q", report["receiptsFolder"], folder.ID)
	}

	if !created(t, report, "ledger") {
		t.Errorf("ledger.created = false, want true on an empty Drive: %v", report)
	}
	if url, _ := report["ledger"].(map[string]any)["url"].(string); url == "" {
		t.Errorf("ledger.url is blank in %v", report)
	}

	for _, tab := range ledger.Tabs {
		if !created(t, report, "tabs", string(tab)) {
			t.Errorf("tabs.%s.created = false, want true", tab)
		}
		got := f.ledger.Tab(tab)
		if got == nil {
			t.Errorf("tab %s was not created", tab)
			continue
		}
		if !reflect.DeepEqual(got.Header, ledger.Columns[tab]) {
			t.Errorf("tab %s header = %q, want %q", tab, got.Header, ledger.Columns[tab])
		}
		if !got.Frozen {
			t.Errorf("tab %s header row is not frozen", tab)
		}
	}
}

func TestFirstRunSeedsCategoriesAndTheAdmin(t *testing.T) {
	f := newFixture(t)

	report := run(t, f)

	wantCategories := []string{
		"Groceries & Vegetables", "Medical & Pharmacy", "Utilities & Bills", "School & Kids",
		"Household & Help", "Dining & Outings", "Other",
	}
	var gotCategories []string
	for _, row := range f.ledger.Tab(ledger.Categories).Rows {
		gotCategories = append(gotCategories, row[0])
		if row[1] == "" || row[2] == "" {
			t.Errorf("category %q is missing its emoji or colour: %q", row[0], row)
		}
		if row[3] != "0" || row[4] != "all" {
			t.Errorf("category %q = %q, want Budget 0 visible to all", row[0], row)
		}
	}
	if !reflect.DeepEqual(gotCategories, wantCategories) {
		t.Errorf("Categories = %q, want %q", gotCategories, wantCategories)
	}

	members := f.ledger.Tab(ledger.Members).Rows
	if len(members) != 1 {
		t.Fatalf("Members rows = %q, want exactly the admin", members)
	}
	admin := members[0]
	if admin[0] != "admin" || admin[1] != "Admin" || admin[2] != "admin" || admin[3] != "UPI" || admin[4] != "" {
		t.Errorf("admin row = %q, want admin / Admin / admin / UPI / blank PIN", admin)
	}
	if admin[5] == "" {
		t.Errorf("admin row has no Avatar_Color: %q", admin)
	}

	if rows := f.ledger.Tab(ledger.RecurringRules).Rows; len(rows) != 0 {
		t.Errorf("Recurring_Rules seeded with %q, want none", rows)
	}
	wantSeeded := map[string]any{"Expenses": 0.0, "Members": 1.0, "Categories": 7.0, "Recurring_Rules": 0.0}
	if !reflect.DeepEqual(report["seeded"], wantSeeded) {
		t.Errorf("seeded = %v, want %v", report["seeded"], wantSeeded)
	}
}

func TestRunningTwiceChangesNothing(t *testing.T) {
	f := newFixture(t)
	run(t, f)
	before := f.ledger.Dump()
	writes := f.ledger.Writes + f.store.Writes

	report := run(t, f)

	if created(t, report, "receiptsFolder") || created(t, report, "ledger") {
		t.Errorf("second run reports creations: %v", report)
	}
	for _, tab := range ledger.Tabs {
		if created(t, report, "tabs", string(tab)) {
			t.Errorf("second run reports tab %s created", tab)
		}
	}
	for tab, n := range report["seeded"].(map[string]any) {
		if n != 0.0 {
			t.Errorf("second run seeded %v rows into %s", n, tab)
		}
	}
	if !reflect.DeepEqual(f.ledger.Dump(), before) {
		t.Errorf("second run changed the Ledger:\nbefore %v\nafter  %v", before, f.ledger.Dump())
	}
	if got := f.ledger.Writes + f.store.Writes; got != writes {
		t.Errorf("second run made %d more writes, want 0", got-writes)
	}
	if len(f.store.Folders) != 1 {
		t.Errorf("folders = %+v, want exactly one Receipts folder", f.store.Folders)
	}
}

func TestSeedsOnlyTheEmptyTabs(t *testing.T) {
	f := newFixture(t)
	ramesh := []string{"ramesh", "Ramesh", "parent", "Cash", "", "#A98545"}
	f.ledger.Seed(ledger.Members, ramesh)

	report := run(t, f)

	if created(t, report, "ledger") || created(t, report, "tabs", "Members") {
		t.Errorf("an existing Ledger and tab were reported as created: %v", report)
	}
	if !created(t, report, "tabs", "Categories") {
		t.Errorf("the missing Categories tab was not reported as created: %v", report)
	}
	if rows := f.ledger.Tab(ledger.Members).Rows; !reflect.DeepEqual(rows, [][]string{ramesh}) {
		t.Errorf("Members = %q, want the one existing row untouched", rows)
	}
	if rows := f.ledger.Tab(ledger.Categories).Rows; len(rows) != 7 {
		t.Errorf("Categories has %d rows, want the 7 seeds", len(rows))
	}
	wantSeeded := map[string]any{"Expenses": 0.0, "Members": 0.0, "Categories": 7.0, "Recurring_Rules": 0.0}
	if !reflect.DeepEqual(report["seeded"], wantSeeded) {
		t.Errorf("seeded = %v, want %v", report["seeded"], wantSeeded)
	}
}

func TestATabOfBlankLinesCountsAsEmpty(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Categories, []string{"", "", "", "", ""}, []string{})

	run(t, f)

	rows := f.ledger.Tab(ledger.Categories).Rows
	if len(rows) != 9 || rows[2][0] != "Groceries & Vegetables" {
		t.Errorf("Categories = %q, want the 7 seeds appended after the 2 blank lines", rows)
	}
}

func TestBootstrapNeedsASession(t *testing.T) {
	f := newFixture(t)

	status, body := call(t, f.srv, http.MethodPost, nil)

	if status != http.StatusUnauthorized || body["code"] != "NOT_PAIRED" {
		t.Fatalf("status = %d body = %v, want 401 NOT_PAIRED", status, body)
	}
	if f.ledger.Exists || len(f.store.Folders) != 0 {
		t.Fatal("an unpaired request reached Google")
	}
}

func TestOnlyPostIsAccepted(t *testing.T) {
	f := newFixture(t)

	status, body := call(t, f.srv, http.MethodGet, pairedCookie(t))

	if status != http.StatusMethodNotAllowed || body["code"] != "METHOD_NOT_ALLOWED" {
		t.Fatalf("status = %d body = %v, want 405 METHOD_NOT_ALLOWED", status, body)
	}
}

func TestAGoogleFailureIsReportedNotHidden(t *testing.T) {
	f := newFixture(t)
	f.ledger.Err = errors.New("googleapi: Error 403: insufficient permissions")

	status, body := call(t, f.srv, http.MethodPost, pairedCookie(t))

	if status != http.StatusBadGateway || body["code"] != "GOOGLE_ERROR" {
		t.Fatalf("status = %d body = %v, want 502 GOOGLE_ERROR", status, body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, "403") {
		t.Fatalf("message = %q, want the upstream error passed through", msg)
	}
}

func TestMissingGoogleConfigIsReportedNotPanicked(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	for _, name := range []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_SHEET_ID"} {
		t.Setenv(name, "")
	}
	srv := httptest.NewServer(http.HandlerFunc(bootstrap.Handler))
	t.Cleanup(srv.Close)

	status, body := call(t, srv, http.MethodPost, pairedCookie(t))

	if status != http.StatusInternalServerError || body["code"] != "SERVER_MISCONFIGURED" {
		t.Fatalf("status = %d body = %v, want 500 SERVER_MISCONFIGURED", status, body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, "GOOGLE_REFRESH_TOKEN") {
		t.Fatalf("message = %q, want it to name the missing variables", msg)
	}
}

func TestTheSessionIsCheckedBeforeTheConfiguration(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	t.Setenv("GOOGLE_CLIENT_ID", "")
	srv := httptest.NewServer(http.HandlerFunc(bootstrap.Handler))
	t.Cleanup(srv.Close)

	status, body := call(t, srv, http.MethodPost, nil)

	if status != http.StatusUnauthorized || body["code"] != "NOT_PAIRED" {
		t.Fatalf("status = %d body = %v, want 401 NOT_PAIRED before any configuration check", status, body)
	}
}

func TestAWrongMethodIsRejectedBeforeTheConfigurationIsRead(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	t.Setenv("GOOGLE_CLIENT_ID", "")
	srv := httptest.NewServer(http.HandlerFunc(bootstrap.Handler))
	t.Cleanup(srv.Close)

	status, body := call(t, srv, http.MethodGet, pairedCookie(t))

	if status != http.StatusMethodNotAllowed || body["code"] != "METHOD_NOT_ALLOWED" {
		t.Fatalf("status = %d body = %v, want 405 METHOD_NOT_ALLOWED even on a misconfigured server", status, body)
	}
}
