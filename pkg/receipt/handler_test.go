package receipt_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
		"a Receipt Store file with a thumbnail, placed loose": func(f fixture) string {
			f.store.AddFile(receiptstore.FakeFile{ID: "loose-2", ParentID: householdID, Name: "y.jpg", MIMEType: "image/jpeg", Content: photo, Thumbnail: drivePNG, ThumbnailType: "image/png"})
			return "loose-2"
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

			for _, query := range []string{"?id=" + id, "?id=" + id + "&thumb=1"} {
				a := get(t, f, http.MethodGet, query, pairedCookie(t))

				if a.status != http.StatusNotFound || a.body["code"] != "RECEIPT_NOT_FOUND" {
					t.Errorf("%s: got %d %s, want 404 RECEIPT_NOT_FOUND", query, a.status, a.raw)
				}
			}
			if len(f.store.Downloads) != 0 || len(f.store.Thumbnails) != 0 {
				t.Errorf("Drive was read: downloads %v, thumbnails %v", f.store.Downloads, f.store.Thumbnails)
			}
		})
	}
}

func TestAReceiptOver4MBIsRefusedWithItsDriveLink(t *testing.T) {
	f := newFixture(t)
	// A scanned PDF Drive says is 6.2 MB.
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "big-bill", Name: "2026-10-30_Medical_6200.pdf", MIMEType: "application/pdf", Size: 6_200_000})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusRequestEntityTooLarge || a.body["code"] != "RECEIPT_TOO_LARGE" {
		t.Fatalf("got %d %s, want 413 RECEIPT_TOO_LARGE", a.status, a.raw)
	}
	if got := a.body["webViewLink"]; got != "https://drive.google.com/file/d/big-bill/view?usp=drivesdk" {
		t.Errorf("webViewLink = %v, want the file's Drive link", got)
	}
	if len(f.store.Downloads) != 0 {
		t.Errorf("the bytes were downloaded anyway: %v", f.store.Downloads)
	}
}

// Drive's size can be missing or stale; the bytes themselves decide.
func TestBytesOverTheCapAreRefusedEvenWhenTheSizeLied(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "liar", Name: "x.jpg", MIMEType: "image/jpeg", Content: make([]byte, receipt.MaxProxySize+1), Size: 1})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusRequestEntityTooLarge || a.body["webViewLink"] != "https://drive.google.com/file/d/liar/view?usp=drivesdk" {
		t.Fatalf("got %d %s, want 413 with the Drive link", a.status, a.raw)
	}
}

func TestAReceiptOfExactly4MBIsServed(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "edge", Name: "x.jpg", MIMEType: "image/jpeg", Content: make([]byte, 4<<20)})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusOK || len(a.raw) != 4<<20 {
		t.Fatalf("got %d with %d bytes, want 200 with 4194304", a.status, len(a.raw))
	}
}

// A tiny PNG standing in for what Drive generates.
var drivePNG = []byte("\x89PNG\r\n\x1a\nthumbnail of page one")

func TestThumbReturnsDrivesThumbnailFetchedByTheServer(t *testing.T) {
	cases := map[string]receiptstore.FakeFile{
		"of a photo":         {ID: "photo-1", Name: "x.jpg", MIMEType: "image/jpeg", Content: photo, Thumbnail: drivePNG, ThumbnailType: "image/png"},
		"of a PDF":           {ID: "bill-1", Name: "x.pdf", MIMEType: "application/pdf", Content: []byte("%PDF-1.7"), Thumbnail: drivePNG, ThumbnailType: "image/png"},
		"of an oversize PDF": {ID: "big-1", Name: "x.pdf", MIMEType: "application/pdf", Size: 9_000_000, Thumbnail: drivePNG, ThumbnailType: "image/png"},
	}
	for name, file := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			id := saveReceipt(t, f, file)

			a := get(t, f, http.MethodGet, "?id="+id+"&thumb=1", pairedCookie(t))

			if a.status != http.StatusOK {
				t.Fatalf("status = %d, want 200; body %s", a.status, a.raw)
			}
			if !bytes.Equal(a.raw, drivePNG) || a.header.Get("Content-Type") != "image/png" {
				t.Errorf("got %q as %q, want Drive's PNG", a.raw, a.header.Get("Content-Type"))
			}
			// The lightbox picks image or PDF view from this, before any download.
			if got := a.header.Get("X-Receipt-Type"); got != file.MIMEType {
				t.Errorf("X-Receipt-Type = %q, want %q", got, file.MIMEType)
			}
			if got := a.header.Get("Cache-Control"); got != "private, max-age=86400" {
				t.Errorf("Cache-Control = %q, want private, max-age=86400", got)
			}
			if len(f.store.Thumbnails) != 1 || len(f.store.Downloads) != 0 {
				t.Errorf("thumbnails fetched %v, downloads %v; want one thumbnail and no download", f.store.Thumbnails, f.store.Downloads)
			}
		})
	}
}

// Drive makes thumbnails a little after the upload; until then there is
// nothing to show, and the answer must not be cached.
func TestThumbBeforeDriveHasMadeOneIsNotFound(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "fresh", Name: "x.jpg", MIMEType: "image/jpeg", Content: photo})

	a := get(t, f, http.MethodGet, "?id="+id+"&thumb=1", pairedCookie(t))

	if a.status != http.StatusNotFound || a.body["code"] != "NO_THUMBNAIL" {
		t.Fatalf("got %d %s, want 404 NO_THUMBNAIL", a.status, a.raw)
	}
	if got := a.header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestASessionIsRequired(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "receipt-1", Name: "x.jpg", MIMEType: "image/jpeg", Content: photo, Thumbnail: drivePNG, ThumbnailType: "image/png"})

	for _, query := range []string{"?id=" + id, "?id=" + id + "&thumb=1"} {
		a := get(t, f, http.MethodGet, query, nil)

		if a.status != http.StatusUnauthorized || a.body["code"] != "NOT_PAIRED" {
			t.Errorf("%s: got %d %s, want 401 NOT_PAIRED", query, a.status, a.raw)
		}
	}
	if len(f.store.Downloads)+len(f.store.Thumbnails) != 0 {
		t.Errorf("Drive was read without a Session")
	}
}

func TestOnlyGETIsAccepted(t *testing.T) {
	f := newFixture(t)

	a := get(t, f, http.MethodPost, "?id=receipt-1", pairedCookie(t))

	if a.status != http.StatusMethodNotAllowed || a.header.Get("Allow") != "GET" {
		t.Fatalf("got %d Allow %q, want 405 Allow GET", a.status, a.header.Get("Allow"))
	}
}

func TestAMissingOrMalformedIDIsABadRequest(t *testing.T) {
	f := newFixture(t)

	for _, query := range []string{"", "?id=", "?id=..%2Fabout", "?id=a%20b", "?thumb=1"} {
		a := get(t, f, http.MethodGet, query, pairedCookie(t))

		if a.status != http.StatusBadRequest || a.body["code"] != "BAD_REQUEST" {
			t.Errorf("%q: got %d %s, want 400 BAD_REQUEST", query, a.status, a.raw)
		}
	}
}

// The proxy answers on the app's own origin, so a file someone dropped into
// the Receipt Store by hand must never be served as something a browser
// would run.
func TestAFileThatIsNotAPhotoOrPDFIsServedAsADownload(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "page", Name: "x.html", MIMEType: "text/html", Content: []byte("<script>alert(1)</script>")})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusOK {
		t.Fatalf("status = %d, want 200", a.status)
	}
	if got := a.header.Get("Content-Type"); got != "application/octet-stream" {
		t.Errorf("Content-Type = %q, want application/octet-stream", got)
	}
	if got := a.header.Get("Content-Disposition"); got != "attachment" {
		t.Errorf("Content-Disposition = %q, want attachment", got)
	}
}

func TestAPDFReceiptIsServedAsAPDF(t *testing.T) {
	f := newFixture(t)
	pdf := []byte("%PDF-1.7 one page")
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "bill", Name: "x.pdf", MIMEType: "application/pdf", Content: pdf})

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusOK || a.header.Get("Content-Type") != "application/pdf" || !bytes.Equal(a.raw, pdf) {
		t.Fatalf("got %d %q %q, want 200 application/pdf with the bytes", a.status, a.header.Get("Content-Type"), a.raw)
	}
}

func TestADriveOutageIsABadGatewayThatIsNotCached(t *testing.T) {
	f := newFixture(t)
	id := saveReceipt(t, f, receiptstore.FakeFile{ID: "receipt-1", Name: "x.jpg", MIMEType: "image/jpeg", Content: photo})
	f.store.Err = errors.New("googleapi: Error 503: backend error")

	a := get(t, f, http.MethodGet, "?id="+id, pairedCookie(t))

	if a.status != http.StatusBadGateway || a.body["code"] != "GOOGLE_ERROR" || a.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("got %d %s Cache-Control %q, want 502 GOOGLE_ERROR no-store", a.status, a.raw, a.header.Get("Cache-Control"))
	}
}
