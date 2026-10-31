package expenses_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/expenses"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const jwtSecret = "test-secret-at-least-32-characters-long"

// Known-good hashes, computed outside this code base:
//
//	printf 'admin:1234'  | shasum -a 256
//	printf 'ramesh:0123' | shasum -a 256
const (
	adminPinHash  = "f8e68e8d44bfb5314974a97f787d017ff6ac9d0046083f28665fcf96f0cef80c"
	rameshPinHash = "bb9df8aff41c19732740d6e1d7203895194632fbf5c1feb4a21b2c8def202234"
)

// fixedNow is the server clock in the fixture: 31 Oct 2026, 09:15 IST.
var fixedNow = time.Date(2026, 10, 31, 9, 15, 0, 0, ledger.IST)

// householdID is the Drive folder the fixture's Receipt Store lives in.
const householdID = "household-folder"

type fixture struct {
	ledger *ledger.Fake
	store  *receiptstore.Fake
	srv    *httptest.Server
}

// newFixture serves the expenses function over a Ledger holding a tidy
// Household: an Admin with a PIN, a parent with a zero-led PIN, a kid without.
func newFixture(t *testing.T) fixture {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	f := fixture{ledger: ledger.NewFake(), store: receiptstore.NewFake()}
	f.ledger.Seed(ledger.Members,
		[]string{"admin", "Admin", "admin", "UPI", "1234", "#6E7250"},
		[]string{"ramesh", "Ramesh", "parent", "Cash", "0123", "#A98545"},
		[]string{"kid1", "Kiddo", "kid", "Cash", "", "#A9603F"},
	)
	f.ledger.Seed(ledger.Categories,
		[]string{"Groceries & Vegetables", "🥬", "#6E7250", "5000", "all"},
		[]string{"Medical & Pharmacy", "💊", "#A9603F", "1500.50", "admin, parent"},
	)
	f.ledger.Seed(ledger.RecurringRules,
		[]string{"rent", "Rent", "25000", "Household & Help", "1"},
	)
	f.ledger.Seed(ledger.Expenses)
	svc := expenses.Service{Ledger: f.ledger, Store: f.store, FolderID: householdID, Now: func() time.Time { return fixedNow }}
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

func call(t *testing.T, srv *httptest.Server, method string, cookie *http.Cookie) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+"/api/expenses", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

// readModel GETs as a paired device and decodes the body.
func readModel(t *testing.T, f fixture) (map[string]any, string) {
	t.Helper()
	status, raw := call(t, f.srv, http.MethodGet, pairedCookie(t))
	if status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", status, raw)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return body, raw
}

func list(t *testing.T, body map[string]any, key string) []map[string]any {
	t.Helper()
	items, ok := body[key].([]any)
	if !ok {
		t.Fatalf("%s = %v, want an array", key, body[key])
	}
	out := make([]map[string]any, len(items))
	for i, item := range items {
		out[i], ok = item.(map[string]any)
		if !ok {
			t.Fatalf("%s[%d] = %v, want an object", key, i, item)
		}
	}
	return out
}

func TestMembersCarryAPinHashNeverThePin(t *testing.T) {
	f := newFixture(t)

	body, raw := readModel(t, f)

	members := list(t, body, "members")
	want := []map[string]any{
		{"memberId": "admin", "name": "Admin", "role": "admin", "defaultPaymentMethod": "UPI", "pinHash": adminPinHash, "avatarColor": "#6E7250"},
		{"memberId": "ramesh", "name": "Ramesh", "role": "parent", "defaultPaymentMethod": "Cash", "pinHash": rameshPinHash, "avatarColor": "#A98545"},
		{"memberId": "kid1", "name": "Kiddo", "role": "kid", "defaultPaymentMethod": "Cash", "pinHash": nil, "avatarColor": "#A9603F"},
	}
	if !reflect.DeepEqual(members, want) {
		t.Errorf("members = %v\nwant      %v", members, want)
	}
	for _, needle := range []string{`"1234"`, `"0123"`, `"pin"`, `"pinCode"`, `PIN_Code`} {
		if strings.Contains(raw, needle) {
			t.Errorf("response leaks %s: %s", needle, raw)
		}
	}
}

func TestCategoriesAndRecurringRulesAreTyped(t *testing.T) {
	f := newFixture(t)

	body, _ := readModel(t, f)

	categories := list(t, body, "categories")
	wantCategories := []map[string]any{
		{"name": "Groceries & Vegetables", "emoji": "🥬", "colorHex": "#6E7250", "monthlyBudgetLimit": 5000.0, "visibleToRoles": []any{"all"}},
		{"name": "Medical & Pharmacy", "emoji": "💊", "colorHex": "#A9603F", "monthlyBudgetLimit": 1500.5, "visibleToRoles": []any{"admin", "parent"}},
	}
	if !reflect.DeepEqual(categories, wantCategories) {
		t.Errorf("categories = %v\nwant       %v", categories, wantCategories)
	}
	rules := list(t, body, "recurringRules")
	wantRules := []map[string]any{
		{"ruleId": "rent", "title": "Rent", "amount": 25000.0, "category": "Household & Help", "dueDayOfMonth": 1.0},
	}
	if !reflect.DeepEqual(rules, wantRules) {
		t.Errorf("recurringRules = %v\nwant           %v", rules, wantRules)
	}
}

func TestTheLedgerURLServerTimeAndEmptyExpensesAreReturned(t *testing.T) {
	f := newFixture(t)

	body, raw := readModel(t, f)

	if body["ledgerUrl"] != ledger.URLFor(ledger.FakeSpreadsheetID) {
		t.Errorf("ledgerUrl = %v, want %s", body["ledgerUrl"], ledger.URLFor(ledger.FakeSpreadsheetID))
	}
	if !strings.Contains(raw, `"expenses":[]`) {
		t.Errorf("expenses should be an empty array, not null or missing: %s", raw)
	}
	if body["serverTime"] != "2026-10-31T09:15:00+05:30" {
		t.Errorf("serverTime = %v, want the server clock in RFC 3339 with the IST offset", body["serverTime"])
	}
}

func TestMalformedRowsAreSkippedOrDefaultedNeverFatal(t *testing.T) {
	f := newFixture(t)
	f.ledger.Seed(ledger.Members,
		[]string{"", "Ghost", "admin", "UPI", "9999", "#6E7250"},
		[]string{"dadi", "", " Parent ", "cheque", "  ", "olive"},
		[]string{"bablu", "Bablu", "child", "bank_transfer", "", "#a9603f"},
		[]string{},
	)
	f.ledger.Seed(ledger.Categories,
		[]string{"", "🥬", "#6E7250", "5000", "all"},
		[]string{"Other"},
		[]string{"Fuel", "⛽", "#A98545", "₹2,000", ""},
	)
	f.ledger.Seed(ledger.RecurringRules,
		[]string{"", "No ID", "100", "Other", "1"},
		[]string{"bad-amount", "Bad amount", "lots", "Other", "1"},
		[]string{"bad-day", "Bad day", "100", "Other", "40"},
		[]string{"fee", "", "1,200", "School & Kids", "10"},
	)

	body, _ := readModel(t, f)

	wantMembers := []map[string]any{
		{"memberId": "dadi", "name": "dadi", "role": "parent", "defaultPaymentMethod": "UPI", "pinHash": nil, "avatarColor": "#6E7250"},
		{"memberId": "bablu", "name": "Bablu", "role": "kid", "defaultPaymentMethod": "Bank Transfer", "pinHash": nil, "avatarColor": "#a9603f"},
	}
	if members := list(t, body, "members"); !reflect.DeepEqual(members, wantMembers) {
		t.Errorf("members = %v\nwant      %v", members, wantMembers)
	}
	wantCategories := []map[string]any{
		{"name": "Other", "emoji": "📦", "colorHex": "#6E7250", "monthlyBudgetLimit": 0.0, "visibleToRoles": []any{"all"}},
		{"name": "Fuel", "emoji": "⛽", "colorHex": "#A98545", "monthlyBudgetLimit": 2000.0, "visibleToRoles": []any{"all"}},
	}
	if categories := list(t, body, "categories"); !reflect.DeepEqual(categories, wantCategories) {
		t.Errorf("categories = %v\nwant       %v", categories, wantCategories)
	}
	wantRules := []map[string]any{
		{"ruleId": "fee", "title": "fee", "amount": 1200.0, "category": "School & Kids", "dueDayOfMonth": 10.0},
	}
	if rules := list(t, body, "recurringRules"); !reflect.DeepEqual(rules, wantRules) {
		t.Errorf("recurringRules = %v\nwant           %v", rules, wantRules)
	}
}

func TestNeedsASession(t *testing.T) {
	f := newFixture(t)

	status, raw := call(t, f.srv, http.MethodGet, nil)

	if status != http.StatusUnauthorized || !strings.Contains(raw, "NOT_PAIRED") {
		t.Fatalf("status = %d body = %s, want 401 NOT_PAIRED", status, raw)
	}
}

func TestAnyOtherMethodIsRejectedNamingTheFourItServes(t *testing.T) {
	f := newFixture(t)
	req, _ := http.NewRequest(http.MethodPatch, f.srv.URL+"/api/expenses", nil)
	req.AddCookie(pairedCookie(t))

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)

	if res.StatusCode != http.StatusMethodNotAllowed || !strings.Contains(string(raw), "METHOD_NOT_ALLOWED") {
		t.Fatalf("status = %d body = %s, want 405 METHOD_NOT_ALLOWED", res.StatusCode, raw)
	}
	if allow := res.Header.Get("Allow"); allow != "GET, POST, PUT, DELETE" {
		t.Errorf("Allow = %q, want GET, POST, PUT, DELETE", allow)
	}
}

func TestAMissingLedgerAsksForBootstrap(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	srv := httptest.NewServer(expenses.Service{Ledger: ledger.NewFake()}.Handler())
	t.Cleanup(srv.Close)

	status, raw := call(t, srv, http.MethodGet, pairedCookie(t))

	if status != http.StatusNotFound || !strings.Contains(raw, "LEDGER_NOT_FOUND") {
		t.Fatalf("status = %d body = %s, want 404 LEDGER_NOT_FOUND", status, raw)
	}
}

func TestAGoogleFailureIsReported(t *testing.T) {
	f := newFixture(t)
	f.ledger.Err = errors.New("googleapi: Error 500: backend error")

	status, raw := call(t, f.srv, http.MethodGet, pairedCookie(t))

	if status != http.StatusBadGateway || !strings.Contains(raw, "GOOGLE_ERROR") {
		t.Fatalf("status = %d body = %s, want 502 GOOGLE_ERROR", status, raw)
	}
}

func TestMissingGoogleConfigIsReportedNotPanicked(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	for _, name := range []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_FOLDER_ID"} {
		t.Setenv(name, "")
	}
	srv := httptest.NewServer(http.HandlerFunc(expenses.Handler))
	t.Cleanup(srv.Close)

	status, raw := call(t, srv, http.MethodGet, pairedCookie(t))

	if status != http.StatusInternalServerError || !strings.Contains(raw, "SERVER_MISCONFIGURED") {
		t.Fatalf("status = %d body = %s, want 500 SERVER_MISCONFIGURED", status, raw)
	}
}

func TestAWrongMethodIsRejectedBeforeTheConfigurationIsRead(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	t.Setenv("GOOGLE_CLIENT_ID", "")
	srv := httptest.NewServer(http.HandlerFunc(expenses.Handler))
	t.Cleanup(srv.Close)

	status, raw := call(t, srv, http.MethodPatch, pairedCookie(t))

	if status != http.StatusMethodNotAllowed || !strings.Contains(raw, "METHOD_NOT_ALLOWED") {
		t.Fatalf("status = %d body = %s, want 405 METHOD_NOT_ALLOWED even on a misconfigured server", status, raw)
	}
}
