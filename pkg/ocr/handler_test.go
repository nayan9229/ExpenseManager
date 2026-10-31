package ocr_test

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

	"github.com/nayan9229/ExpenseManager/pkg/ocr"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const (
	jwtSecret   = "test-secret-at-least-32-characters-long"
	householdID = "household-folder"
)

// photo stands in for the shrunk JPEG the Scan screen uploaded.
var photo = []byte("\xff\xd8\xff\xe0 a pharmacy bill")

// pharmacyBill is what the model answers for a clear pharmacy bill: every
// key of the schema, Category and Payment Method from their enums.
const pharmacyBill = `{
  "merchant": "Apollo Pharmacy",
  "expenseDate": "2026-10-30",
  "totalAmount": 450,
  "taxAmount": 21.43,
  "currency": "INR",
  "category": "Medical & Pharmacy",
  "paymentMethod": "UPI",
  "confidence": {"merchant": 0.95, "expenseDate": 0.9, "totalAmount": 0.97, "category": 0.88, "paymentMethod": 0.4},
  "lineItemSummary": "paracetamol, cough syrup, bandages"
}`

type fixture struct {
	store *receiptstore.Fake
	model *ocr.Fake
	srv   *httptest.Server
	// receiptID is a JPEG Receipt in Receipts/2026/10-October.
	receiptID string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	f := &fixture{store: receiptstore.NewFake(), model: ocr.NewFake()}
	f.model.Answer = ocr.Answer{FinishReason: "STOP", Text: pharmacyBill, ModelVersion: "gemini-3.5-flash-lite"}
	f.receiptID = f.addReceipt(t, "image/jpeg", photo, 0)
	f.srv = httptest.NewServer(ocr.Service{Store: f.store, OCR: f.model, FolderID: householdID}.Handler())
	t.Cleanup(f.srv.Close)
	return f
}

// addReceipt puts a file where the upload left it: the month folder.
func (f *fixture) addReceipt(t *testing.T, mime string, content []byte, size int64) string {
	t.Helper()
	month, err := receiptstore.EnsureMonthFolder(t.Context(), f.store, householdID, time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	id := "file-" + string(rune('a'+len(f.store.Files)))
	f.store.AddFile(receiptstore.FakeFile{ID: id, ParentID: month.ID, Name: id + ".jpg", MIMEType: mime, Content: content, Size: size})
	return id
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

type answer struct {
	status int
	body   map[string]any
	raw    string
}

func send(t *testing.T, url, method string, body any, cookie *http.Cookie) answer {
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
	req, _ := http.NewRequest(method, url+"/api/ocr", reader)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	a := answer{status: res.StatusCode, raw: string(raw)}
	_ = json.Unmarshal(raw, &a.body)
	return a
}

func (f *fixture) read(t *testing.T, fileID string) answer {
	t.Helper()
	return send(t, f.srv.URL, http.MethodPost, map[string]any{"fileId": fileID}, pairedCookie(t))
}

func TestAReceiptIsReadIntoTheFieldsThatPrefillTheForm(t *testing.T) {
	f := newFixture(t)

	a := f.read(t, f.receiptID)

	if a.status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", a.status, a.raw)
	}
	var got map[string]any
	_ = json.Unmarshal([]byte(a.raw), &got)
	want := map[string]any{
		"merchant": "Apollo Pharmacy", "expenseDate": "2026-10-30", "totalAmount": 450.0, "taxAmount": 21.43,
		"currency": "INR", "category": "Medical & Pharmacy", "paymentMethod": "UPI",
		"confidence":      map[string]any{"merchant": 0.95, "expenseDate": 0.9, "totalAmount": 0.97, "category": 0.88, "paymentMethod": 0.4},
		"lineItemSummary": "paracetamol, cough syrup, bandages",
		"model":           "gemini-3.5-flash-lite",
	}
	if !jsonEqual(got, want) {
		t.Errorf("body = %s\nwant %v", a.raw, want)
	}
	if len(f.model.Seen) != 1 {
		t.Fatalf("model saw %d receipts, want 1", len(f.model.Seen))
	}
	if seen := f.model.Seen[0]; !bytes.Equal(seen.Bytes, photo) || seen.MIMEType != "image/jpeg" {
		t.Errorf("model got %q (%s), want the Receipt's bytes as image/jpeg", seen.Bytes, seen.MIMEType)
	}
}

func jsonEqual(a, b any) bool {
	ra, _ := json.Marshal(a)
	rb, _ := json.Marshal(b)
	return bytes.Equal(ra, rb)
}

func TestAnAnswerThatBreaksTheSchemaIs422WithWhatWasWrong(t *testing.T) {
	cases := []struct {
		name, text, want string
	}{
		{"not JSON", `Sure! The total is 450.`, "not a JSON object"},
		{"cut off", `{"merchant": "Apollo Pharmacy", "expenseDate": "2026-10-30", "totalAm`, "not a JSON object"},
		{"missing key", strings.Replace(pharmacyBill, `"taxAmount": 21.43,`, ``, 1), "missing taxAmount"},
		{"extra key", strings.Replace(pharmacyBill, `"currency": "INR",`, `"currency": "INR", "gstin": "27AAACA",`, 1), "unexpected gstin"},
		{"Category outside the seven", strings.Replace(pharmacyBill, `"Medical & Pharmacy"`, `"Pharmacy"`, 1), `category "Pharmacy"`},
		{"null Category", strings.Replace(pharmacyBill, `"Medical & Pharmacy"`, `null`, 1), "category null"},
		{"Payment Method outside the four", strings.Replace(pharmacyBill, `"UPI"`, `"GPay"`, 1), `paymentMethod "GPay"`},
		{"amount as text", strings.Replace(pharmacyBill, `"totalAmount": 450`, `"totalAmount": "₹450"`, 1), "totalAmount"},
		{"negative amount", strings.Replace(pharmacyBill, `"totalAmount": 450`, `"totalAmount": -450`, 1), "negative"},
		{"date not ISO", strings.Replace(pharmacyBill, `"2026-10-30"`, `"30/10/2026"`, 1), "expenseDate"},
		{"impossible date", strings.Replace(pharmacyBill, `"2026-10-30"`, `"2026-02-30"`, 1), "expenseDate"},
		{"confidence above 1", strings.Replace(pharmacyBill, `"category": 0.88`, `"category": 88`, 1), "confidence.category"},
		{"confidence missing a field", strings.Replace(pharmacyBill, `, "paymentMethod": 0.4`, ``, 1), "confidence is missing paymentMethod"},
		{"currency not a code", strings.Replace(pharmacyBill, `"INR"`, `"Rs."`, 1), "currency"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			f.model.Answer = ocr.Answer{FinishReason: "STOP", Text: c.text}

			a := f.read(t, f.receiptID)

			if a.status != http.StatusUnprocessableEntity || a.body["code"] != "OCR_INVALID" {
				t.Fatalf("status = %d body = %s, want 422 OCR_INVALID", a.status, a.raw)
			}
			if msg, _ := a.body["message"].(string); !strings.Contains(msg, c.want) {
				t.Errorf("message = %q, want it to mention %q", msg, c.want)
			}
		})
	}
}

func TestNullsForWhatTheReceiptDoesNotShowAreAValidAnswer(t *testing.T) {
	f := newFixture(t)
	f.model.Answer = ocr.Answer{FinishReason: "STOP", Text: `{"merchant": null, "expenseDate": null, "totalAmount": null, "taxAmount": null,
		"currency": null, "category": "Other", "paymentMethod": null,
		"confidence": {"merchant": 0, "expenseDate": 0, "totalAmount": 0, "category": 0.1, "paymentMethod": 0},
		"lineItemSummary": ""}`}

	a := f.read(t, f.receiptID)

	if a.status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", a.status, a.raw)
	}
	for _, k := range []string{"merchant", "expenseDate", "totalAmount", "taxAmount", "currency", "paymentMethod"} {
		if v, ok := a.body[k]; !ok || v != nil {
			t.Errorf("%s = %v (present %v), want null", k, v, ok)
		}
	}
	if a.body["category"] != "Other" {
		t.Errorf("category = %v, want Other", a.body["category"])
	}
}

func TestAnAnswerTheModelDidNotFinishIs422(t *testing.T) {
	cases := []struct {
		name   string
		answer ocr.Answer
		want   string
	}{
		{"safety", ocr.Answer{FinishReason: "SAFETY"}, "SAFETY"},
		{"personal data", ocr.Answer{FinishReason: "SPII", Text: pharmacyBill}, "SPII"},
		{"ran out of tokens", ocr.Answer{FinishReason: "MAX_TOKENS", Text: `{"merchant": "Apo`}, "MAX_TOKENS"},
		{"prompt blocked", ocr.Answer{BlockReason: "PROHIBITED_CONTENT"}, "PROHIBITED_CONTENT"},
		{"no candidate at all", ocr.Answer{}, "no answer"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFixture(t)
			f.model.Answer = c.answer

			a := f.read(t, f.receiptID)

			if a.status != http.StatusUnprocessableEntity || a.body["code"] != "OCR_BLOCKED" {
				t.Fatalf("status = %d body = %s, want 422 OCR_BLOCKED", a.status, a.raw)
			}
			if msg, _ := a.body["message"].(string); !strings.Contains(msg, c.want) {
				t.Errorf("message = %q, want it to mention %q", msg, c.want)
			}
		})
	}
}

func TestAReceiptOver20MBIs413AndNeverReachesTheModel(t *testing.T) {
	t.Run("Drive reports the size", func(t *testing.T) {
		f := newFixture(t)
		big := f.addReceipt(t, "application/pdf", []byte("%PDF-1.7"), 20<<20+1)

		a := f.read(t, big)

		if a.status != http.StatusRequestEntityTooLarge || a.body["code"] != "FILE_TOO_LARGE" {
			t.Fatalf("status = %d body = %s, want 413 FILE_TOO_LARGE", a.status, a.raw)
		}
		if len(f.model.Seen) != 0 {
			t.Errorf("the model was sent %d receipts, want none", len(f.model.Seen))
		}
	})
	t.Run("the bytes are bigger than Drive said", func(t *testing.T) {
		f := newFixture(t)
		big := f.addReceipt(t, "application/pdf", bytes.Repeat([]byte("x"), 20<<20+1), 1000)

		a := f.read(t, big)

		if a.status != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d body = %s, want 413", a.status, a.raw)
		}
		if len(f.model.Seen) != 0 {
			t.Errorf("the model was sent %d receipts, want none", len(f.model.Seen))
		}
	})
	t.Run("exactly 20 MB is read", func(t *testing.T) {
		f := newFixture(t)
		limit := f.addReceipt(t, "application/pdf", bytes.Repeat([]byte("x"), 20<<20), 0)

		if a := f.read(t, limit); a.status != http.StatusOK {
			t.Fatalf("status = %d body = %s, want 200", a.status, a.raw)
		}
	})
}

func TestOnlyFilesInTheReceiptStoreAreRead(t *testing.T) {
	f := newFixture(t)
	f.store.AddFile(receiptstore.FakeFile{ID: "elsewhere", ParentID: "someone-elses-folder", Name: "salary.pdf", MIMEType: "application/pdf", Content: []byte("%PDF")})

	for _, id := range []string{"elsewhere", "no-such-file"} {
		a := f.read(t, id)
		if a.status != http.StatusUnprocessableEntity || a.body["code"] != "RECEIPT_NOT_IN_STORE" {
			t.Errorf("%s: status = %d body = %s, want 422 RECEIPT_NOT_IN_STORE", id, a.status, a.raw)
		}
	}
	if len(f.model.Seen) != 0 {
		t.Errorf("the model was sent %d files, want none", len(f.model.Seen))
	}
}

func TestAPDFReceiptIsSentAsAPDF(t *testing.T) {
	f := newFixture(t)
	bill := f.addReceipt(t, "application/pdf", []byte("%PDF-1.7 electricity"), 0)

	if a := f.read(t, bill); a.status != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", a.status, a.raw)
	}
	if got := f.model.Seen[0].MIMEType; got != "application/pdf" {
		t.Errorf("MIME type = %q, want application/pdf", got)
	}
}

func TestFailuresUpstreamAre502(t *testing.T) {
	t.Run("Gemini", func(t *testing.T) {
		f := newFixture(t)
		f.model.Err = errors.New("gemini: 429 Too Many Requests: Resource has been exhausted")

		a := f.read(t, f.receiptID)

		if a.status != http.StatusBadGateway || a.body["code"] != "GEMINI_ERROR" || !strings.Contains(a.raw, "Resource has been exhausted") {
			t.Fatalf("status = %d body = %s, want 502 GEMINI_ERROR with the upstream message", a.status, a.raw)
		}
	})
	t.Run("Drive", func(t *testing.T) {
		f := newFixture(t)
		f.store.Err = errors.New("drive: 503 backend error")

		a := f.read(t, f.receiptID)

		if a.status != http.StatusBadGateway || a.body["code"] != "GOOGLE_ERROR" {
			t.Fatalf("status = %d body = %s, want 502 GOOGLE_ERROR", a.status, a.raw)
		}
	})
}

func TestTheRequestMustBePairedPOSTWithAFileID(t *testing.T) {
	f := newFixture(t)

	if a := send(t, f.srv.URL, http.MethodPost, map[string]any{"fileId": f.receiptID}, nil); a.status != http.StatusUnauthorized || a.body["code"] != "NOT_PAIRED" {
		t.Errorf("no cookie: status = %d body = %s, want 401 NOT_PAIRED", a.status, a.raw)
	}
	if a := send(t, f.srv.URL, http.MethodGet, nil, pairedCookie(t)); a.status != http.StatusMethodNotAllowed {
		t.Errorf("GET: status = %d, want 405", a.status)
	}
	for _, body := range []any{"not json", map[string]any{}, map[string]any{"fileId": ""}} {
		if a := send(t, f.srv.URL, http.MethodPost, body, pairedCookie(t)); a.status != http.StatusBadRequest || a.body["code"] != "BAD_REQUEST" {
			t.Errorf("body %v: status = %d body = %s, want 400 BAD_REQUEST", body, a.status, a.raw)
		}
	}
	if len(f.model.Seen) != 0 {
		t.Errorf("the model was sent %d receipts, want none", len(f.model.Seen))
	}
}

func TestWithoutAGeminiKeyTheFunctionSaysItIsMisconfigured(t *testing.T) {
	t.Setenv("JWT_SECRET", jwtSecret)
	t.Setenv("GEMINI_API_KEY", "")
	srv := httptest.NewServer(http.HandlerFunc(ocr.Handler))
	t.Cleanup(srv.Close)

	a := send(t, srv.URL, http.MethodPost, map[string]any{"fileId": "file-a"}, pairedCookie(t))

	if a.status != http.StatusInternalServerError || a.body["code"] != "SERVER_MISCONFIGURED" || !strings.Contains(a.raw, "GEMINI_API_KEY") {
		t.Fatalf("status = %d body = %s, want 500 SERVER_MISCONFIGURED naming GEMINI_API_KEY", a.status, a.raw)
	}
}
