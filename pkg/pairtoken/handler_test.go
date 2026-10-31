package pairtoken_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/paircode"
	"github.com/nayan9229/ExpenseManager/pkg/pairtoken"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const jwtSecret = "test-secret-at-least-32-characters-long"

type tokenBody struct {
	PairCode  string `json:"pairCode"`
	Code      string `json:"code"` // error envelope
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
	Message   string `json:"message"`
}

// call runs one request through the pair-token function with an optional
// Session cookie and returns the recorded response.
func call(t *testing.T, method string, paired bool, prepare func(*http.Request)) (*httptest.ResponseRecorder, tokenBody) {
	t.Helper()
	t.Setenv("JWT_SECRET", jwtSecret)
	req := httptest.NewRequest(method, "https://family.example/api/pair-token", nil)
	if paired {
		now := time.Now()
		token, err := session.Sign([]byte(jwtSecret), session.Claims{DeviceID: "admin-phone", IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix()})
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: token})
	}
	if prepare != nil {
		prepare(req)
	}
	rec := httptest.NewRecorder()
	pairtoken.Handler(rec, req)
	var body tokenBody
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return rec, body
}

func TestAnUnpairedDeviceCannotMintAPairToken(t *testing.T) {
	rec, body := call(t, http.MethodGet, false, nil)

	if rec.Code != http.StatusUnauthorized || body.Code != "NOT_PAIRED" {
		t.Fatalf("status %d code %q, want 401 NOT_PAIRED", rec.Code, body.Code)
	}
}

func TestAPairedDeviceGetsAWorkingCodeItsLinkAndExpiry(t *testing.T) {
	before := time.Now()
	rec, body := call(t, http.MethodGet, true, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; message %q", rec.Code, body.Message)
	}
	if !paircode.Verify([]byte(jwtSecret), body.PairCode, time.Now()) {
		t.Fatalf("pairCode %q does not verify against the server secret", body.PairCode)
	}
	if want := "https://family.example/?pairToken=" + body.PairCode; body.URL != want {
		t.Fatalf("url = %q, want %q", body.URL, want)
	}
	expires, err := time.Parse(time.RFC3339, body.ExpiresAt)
	if err != nil {
		t.Fatalf("expiresAt %q is not RFC 3339: %v", body.ExpiresAt, err)
	}
	if left := expires.Sub(before); left <= 10*time.Minute || left > 20*time.Minute {
		t.Fatalf("expiresAt is %v away, want between 10 and 20 minutes", left)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
}

func TestTheLinkUsesTheForwardedOrigin(t *testing.T) {
	_, body := call(t, http.MethodGet, true, func(r *http.Request) {
		r.Host = "localhost:3112"
		r.Header.Set("X-Forwarded-Proto", "http")
	})

	if want := "http://localhost:3112/?pairToken=" + body.PairCode; body.URL != want {
		t.Fatalf("url = %q, want %q", body.URL, want)
	}
}

func TestOnlyGetIsAccepted(t *testing.T) {
	rec, body := call(t, http.MethodPost, true, nil)

	if rec.Code != http.StatusMethodNotAllowed || body.Code != "METHOD_NOT_ALLOWED" {
		t.Fatalf("status %d code %q, want 405 METHOD_NOT_ALLOWED", rec.Code, body.Code)
	}
}
