package receipt_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receipt"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const (
	jwtSecret   = "test-secret-at-least-32-characters-long"
	householdID = "household-folder"
)

type fixture struct {
	store *receiptstore.Fake
	srv   *httptest.Server
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	f := fixture{store: receiptstore.NewFake()}
	f.srv = httptest.NewServer(receipt.Service{Store: f.store, FolderID: householdID}.Handler())
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

// saveReceipt files a Receipt in Receipts/2026/10-October, the way an
// upload plus a create leaves it.
func saveReceipt(t *testing.T, f fixture, file receiptstore.FakeFile) string {
	t.Helper()
	month, err := receiptstore.EnsureMonthFolder(context.Background(), f.store, householdID, time.Date(2026, 10, 30, 0, 0, 0, 0, ledger.IST))
	if err != nil {
		t.Fatal(err)
	}
	file.ParentID = month.ID
	f.store.AddFile(file)
	return file.ID
}

type answer struct {
	status int
	header http.Header
	raw    []byte
	body   map[string]any
}

func get(t *testing.T, f fixture, method, query string, cookie *http.Cookie) answer {
	t.Helper()
	req, _ := http.NewRequest(method, f.srv.URL+"/api/receipt"+query, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	a := answer{status: res.StatusCode, header: res.Header, raw: raw}
	if strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		_ = json.Unmarshal(raw, &a.body)
	}
	return a
}

// A shrunk phone photo: the JPEG magic number and then some.
var photo = append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{7}, 245_000)...)

func TestAnImageReceiptIsProxiedWithItsOwnContentType(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "receipt-1", Name: "2026-10-30_Groceries_450.jpg", MIMEType: "image/jpeg", Content: photo})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", a.status, a.raw)
	}
	if got := a.header.Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", got)
	}
	if !bytes.Equal(a.raw, photo) {
		t.Errorf("body is %d bytes, want the %d stored", len(a.raw), len(photo))
	}
	if got := a.header.Get("Cache-Control"); got != "private, max-age=86400" {
		t.Errorf("Cache-Control = %q, want private, max-age=86400", got)
	}
	if got := a.header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

func TestAnUnknownIDIsNotFound(t *testing.T) {
	f := newFixture(t)

	a := get(t, f, http.MethodGet, "?id=no-such-file", pairedCookie(t))

	if a.status != http.StatusNotFound || a.body["code"] != "RECEIPT_NOT_FOUND" {
		t.Fatalf("got %d %s, want 404 RECEIPT_NOT_FOUND", a.status, a.raw)
	}
}

// The proxy holds the Admin's Drive token: it must never become a way to
// read a file that is not a Receipt.
func TestAFileOutsideTheReceiptStoreIsNeverRead(t *testing.T) {
	cases := map[string]func(f fixture) string{
		"in someone else's folder": func(f fixture) string {
			f.store.AddFile(receiptstore.FakeFile{ID: "tax-return-2025", ParentID: "admins-private-folder", Name: "tax.pdf", MIMEType: "application/pdf", Content: []byte("%PDF-1.7 secret")})
			return "tax-return-2025"
		},
		"loose in the Household folder": func(f fixture) string {
			f.store.AddFile(receiptstore.FakeFile{ID: "loose-1", ParentID: householdID, Name: "loose.jpg", MIMEType: "image/jpeg", Content: photo})
			return "loose-1"
		},
		"a Receipt of another Household": func(f fixture) string {
			month, _ := receiptstore.EnsureMonthFolder(context.Background(), f.store, "another-household", time.Date(2026, 10, 1, 0, 0, 0, 0, ledger.IST))
			f.store.AddFile(receiptstore.FakeFile{ID: "other-receipt", ParentID: month.ID, Name: "x.jpg", MIMEType: "image/jpeg", Content: photo})
			return "other-receipt"
		},
		"a folder of the Receipt Store": func(f fixture) string {
			month, _ := receiptstore.EnsureMonthFolder(context.Background(), f.store, householdID, time.Date(2026, 10, 1, 0, 0, 0, 0, ledger.IST))
			return month.ID
		},
		"a trashed Receipt": func(f fixture) string {
			return saveReceipt(t, f, receiptstore.FakeFile{ID: "binned", Name: "binned.jpg", MIMEType: "image/jpeg", Content: photo, Trashed: true})
		},
	}
	for name, place := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			id := place(f)

			for _, query := range []string{"?id=" + id} {
				a := get(t, f, http.MethodGet, query, pairedCookie(t))

				if a.status != http.StatusNotFound || a.body["code"] != "RECEIPT_NOT_FOUND" {
					t.Errorf("%s: got %d %s, want 404 RECEIPT_NOT_FOUND", query, a.status, a.raw)
				}
			}
			if len(f.store.Downloads) != 0 {
				t.Errorf("Drive was read: downloads %v", f.store.Downloads)
			}
		})
	}
}
