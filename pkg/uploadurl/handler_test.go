package uploadurl_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
	"github.com/nayan9229/ExpenseManager/pkg/uploadurl"
)

const (
	jwtSecret   = "test-secret-at-least-32-characters-long"
	householdID = "household-folder"
	expenseID   = "6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10"
	appOrigin   = "https://family-expenses-beta.vercel.app"
)

type fixture struct {
	store *receiptstore.Fake
	srv   *httptest.Server
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	f := fixture{store: receiptstore.NewFake()}
	f.srv = httptest.NewServer(uploadurl.Service{Store: f.store, FolderID: householdID}.Handler())
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

// jpegRequest is what the Scan Receipt screen sends for a shrunk photo
// dated 30 Oct 2026.
func jpegRequest() map[string]any {
	return map[string]any{"name": expenseID + ".jpg", "mimeType": "image/jpeg", "size": 245_000, "expenseDate": "2026-10-30"}
}

type answer struct {
	status int
	body   map[string]any
	raw    string
	header http.Header
}

func send(t *testing.T, f fixture, method string, body any, cookie *http.Cookie, origin string) answer {
	t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, f.srv.URL+"/api/upload-url", reader)
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	a := answer{status: res.StatusCode, raw: string(raw), header: res.Header}
	_ = json.Unmarshal(raw, &a.body)
	return a
}

func post(t *testing.T, f fixture, body any) answer {
	t.Helper()
	return send(t, f, http.MethodPost, body, pairedCookie(t), appOrigin)
}

func TestASessionIsOpenedInTheMonthFolderOfTheExpenseDate(t *testing.T) {
	f := newFixture(t)

	a := post(t, f, jpegRequest())

	if a.status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", a.status, a.raw)
	}
	receipts := f.store.Find(householdID, "Receipts")
	if receipts == nil {
		t.Fatalf("no Receipts folder under the household folder: %+v", f.store.Folders)
	}
	year := f.store.Find(receipts.ID, "2026")
	if year == nil {
		t.Fatalf("no 2026 folder under Receipts: %+v", f.store.Folders)
	}
	month := f.store.Find(year.ID, "10-October")
	if month == nil {
		t.Fatalf("no 10-October folder under 2026: %+v", f.store.Folders)
	}
	if len(f.store.Uploads) != 1 {
		t.Fatalf("uploads = %+v, want one session", f.store.Uploads)
	}
	got := f.store.Uploads[0].Upload
	want := receiptstore.Upload{FolderID: month.ID, Name: expenseID + ".jpg", MIMEType: "image/jpeg", Size: 245_000, Origin: appOrigin}
	if got != want {
		t.Errorf("session opened with %+v\nwant                %+v", got, want)
	}
	if a.body["uploadUrl"] != f.store.Uploads[0].SessionURI {
		t.Errorf("uploadUrl = %v, want the session URI %s", a.body["uploadUrl"], f.store.Uploads[0].SessionURI)
	}
	if a.body["folderPath"] != "Receipts/2026/10-October" || a.body["name"] != expenseID+".jpg" {
		t.Errorf("body = %s, want folderPath Receipts/2026/10-October and the temporary name", a.raw)
	}
	if cc := a.header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store: the session URI is a bearer secret", cc)
	}
}

func TestTheMonthFolderIsReusedAndEachUploadGetsAFreshSession(t *testing.T) {
	f := newFixture(t)
	first := post(t, f, jpegRequest())
	foldersAfterFirst := len(f.store.Folders)

	retry := post(t, f, jpegRequest())
	pdf := jpegRequest()
	pdf["name"], pdf["mimeType"], pdf["expenseDate"] = expenseID+".pdf", "application/pdf", "2027-01-02"
	january := post(t, f, pdf)

	if first.status != 200 || retry.status != 200 || january.status != 200 {
		t.Fatalf("statuses = %d %d %d (%s), want 200s", first.status, retry.status, january.status, january.raw)
	}
	if first.body["uploadUrl"] == retry.body["uploadUrl"] {
		t.Errorf("a retry got the same session URI %v; each attempt needs a fresh session", retry.body["uploadUrl"])
	}
	// The retry reused the October folders; January added a 2027 and a 01-January.
	if got := len(f.store.Folders); got != foldersAfterFirst+2 {
		t.Errorf("folders = %+v, want the October tree reused and 2027/01-January added", f.store.Folders)
	}
	if january.body["folderPath"] != "Receipts/2027/01-January" {
		t.Errorf("folderPath = %v, want Receipts/2027/01-January", january.body["folderPath"])
	}
}

func TestTheOriginFallsBackToTheHostTheAppWasServedFrom(t *testing.T) {
	f := newFixture(t)

	a := send(t, f, http.MethodPost, jpegRequest(), pairedCookie(t), "")

	if a.status != http.StatusOK {
		t.Fatalf("status = %d body = %s", a.status, a.raw)
	}
	host := strings.TrimPrefix(f.srv.URL, "http://")
	if got := f.store.Uploads[0].Origin; got != "https://"+host {
		t.Errorf("Origin forwarded = %q, want https://%s", got, host)
	}
}

func TestBadRequestsOpenNoSession(t *testing.T) {
	cases := map[string]struct {
		patch  map[string]any
		status int
		code   string
	}{
		"name is not <ID>.<ext>":   {map[string]any{"name": "receipt.jpg"}, 422, "INVALID_NAME"},
		"extension does not match": {map[string]any{"name": expenseID + ".pdf"}, 422, "INVALID_NAME"},
		"not a photo or PDF":       {map[string]any{"name": expenseID + ".txt", "mimeType": "text/plain"}, 422, "UNSUPPORTED_TYPE"},
		"empty file":               {map[string]any{"size": 0}, 422, "INVALID_SIZE"},
		"over 20 MB":               {map[string]any{"size": 20<<20 + 1}, 413, "FILE_TOO_LARGE"},
		"date is not YYYY-MM-DD":   {map[string]any{"expenseDate": "30/10/2026"}, 422, "INVALID_DATE"},
		"date missing":             {map[string]any{"expenseDate": ""}, 422, "INVALID_DATE"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			req := jpegRequest()
			for k, v := range c.patch {
				req[k] = v
			}

			a := post(t, f, req)

			if a.status != c.status || a.body["code"] != c.code {
				t.Errorf("got %d %s, want %d %s", a.status, a.raw, c.status, c.code)
			}
			if len(f.store.Uploads) != 0 || len(f.store.Folders) != 0 {
				t.Errorf("Drive was touched: uploads %+v folders %+v", f.store.Uploads, f.store.Folders)
			}
		})
	}
}

func TestAnUnreadableBodyIsABadRequest(t *testing.T) {
	f := newFixture(t)

	a := post(t, f, "{not json")

	if a.status != http.StatusBadRequest || a.body["code"] != "BAD_REQUEST" {
		t.Errorf("got %d %s, want 400 BAD_REQUEST", a.status, a.raw)
	}
}

func TestUploadURLNeedsASession(t *testing.T) {
	f := newFixture(t)

	a := send(t, f, http.MethodPost, jpegRequest(), nil, appOrigin)

	if a.status != http.StatusUnauthorized || a.body["code"] != "NOT_PAIRED" {
		t.Errorf("got %d %s, want 401 NOT_PAIRED", a.status, a.raw)
	}
	if len(f.store.Uploads) != 0 {
		t.Error("a session was opened without a Session cookie")
	}
}

func TestOnlyPostIsAccepted(t *testing.T) {
	f := newFixture(t)

	a := send(t, f, http.MethodGet, nil, pairedCookie(t), appOrigin)

	if a.status != http.StatusMethodNotAllowed || a.header.Get("Allow") != "POST" {
		t.Errorf("got %d Allow=%q %s, want 405 Allow: POST", a.status, a.header.Get("Allow"), a.raw)
	}
}

func TestAGoogleFailureIsReported(t *testing.T) {
	f := newFixture(t)
	f.store.Err = errors.New("drive: 503 backendError")

	a := post(t, f, jpegRequest())

	if a.status != http.StatusBadGateway || a.body["code"] != "GOOGLE_ERROR" {
		t.Errorf("got %d %s, want 502 GOOGLE_ERROR", a.status, a.raw)
	}
}

func TestMissingGoogleConfigIsReportedNotPanicked(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	for _, name := range []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_FOLDER_ID"} {
		t.Setenv(name, "")
	}
	srv := httptest.NewServer(http.HandlerFunc(uploadurl.Handler))
	t.Cleanup(srv.Close)

	a := send(t, fixture{srv: srv}, http.MethodPost, jpegRequest(), pairedCookie(t), appOrigin)

	if a.status != http.StatusInternalServerError || a.body["code"] != "SERVER_MISCONFIGURED" || !strings.Contains(a.raw, "GOOGLE_DRIVE_FOLDER_ID") {
		t.Errorf("got %d %s, want 500 SERVER_MISCONFIGURED naming the missing variables", a.status, a.raw)
	}
	wrong := send(t, fixture{srv: srv}, http.MethodGet, nil, pairedCookie(t), appOrigin)
	if wrong.status != http.StatusMethodNotAllowed {
		t.Errorf("wrong method got %d, want 405 before the configuration is read", wrong.status)
	}
	unpaired := send(t, fixture{srv: srv}, http.MethodPost, jpegRequest(), nil, appOrigin)
	if unpaired.status != http.StatusUnauthorized {
		t.Errorf("no cookie got %d, want 401 before the configuration is read", unpaired.status)
	}
}
