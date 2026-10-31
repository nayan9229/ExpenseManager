package auth_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/auth"
	"github.com/nayan9229/ExpenseManager/pkg/paircode"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const (
	accessCode = "correct-horse-battery"
	jwtSecret  = "test-secret-at-least-32-characters-long"
)

// newServer starts the auth function with a configured Household.
func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	t.Setenv("FAMILY_ACCESS_CODE", accessCode)
	t.Setenv("JWT_SECRET", jwtSecret)
	srv := httptest.NewServer(http.HandlerFunc(auth.Handler))
	t.Cleanup(srv.Close)
	return srv
}

func pair(t *testing.T, srv *httptest.Server, body string) *http.Response {
	t.Helper()
	res, err := http.Post(srv.URL+"/api/auth", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func decode(t *testing.T, res *http.Response, v any) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		t.Fatalf("decode body: %v", err)
	}
}

func TestGetReportsAnUnpairedDevice(t *testing.T) {
	srv := newServer(t)

	res, err := http.Get(srv.URL + "/api/auth")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	var state struct {
		Paired bool `json:"paired"`
	}
	decode(t, res, &state)
	if state.Paired {
		t.Fatal("paired = true, want false for a device with no Session")
	}
}

func TestTheRightAccessCodePairsTheDevice(t *testing.T) {
	srv := newServer(t)

	res := pair(t, srv, `{"accessCode":"`+accessCode+`"}`)

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d, want 200; body %s", res.StatusCode, body)
	}
	var state struct {
		Paired bool `json:"paired"`
	}
	decode(t, res, &state)
	if !state.Paired {
		t.Fatal("paired = false, want true after Pairing")
	}

	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == "fem_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatalf("no fem_session cookie in %q", res.Header.Values("Set-Cookie"))
	}
	if cookie.Value == "" {
		t.Fatal("fem_session cookie is empty")
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatalf("cookie attributes = %q, want HttpOnly; Secure; SameSite=Lax; Path=/", cookie.Raw)
	}
	if cookie.MaxAge != 365*24*60*60 {
		t.Fatalf("Max-Age = %d, want one year (31536000)", cookie.MaxAge)
	}
}

func TestUnsupportedMethodIsRejected(t *testing.T) {
	srv := newServer(t)

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/api/auth", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", res.StatusCode)
	}
	var body struct {
		Code string `json:"code"`
	}
	decode(t, res, &body)
	if body.Code != "METHOD_NOT_ALLOWED" {
		t.Fatalf("code = %q, want METHOD_NOT_ALLOWED", body.Code)
	}
}

func TestAWrongAccessCodeIsRefusedSlowly(t *testing.T) {
	srv := newServer(t)

	started := time.Now()
	res := pair(t, srv, `{"accessCode":"correct-horse-batterx"}`)
	elapsed := time.Since(started)

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	decode(t, res, &body)
	if body.Code != "WRONG_ACCESS_CODE" || body.Message == "" {
		t.Fatalf("body = %+v, want code WRONG_ACCESS_CODE with a message", body)
	}
	if len(res.Cookies()) != 0 {
		t.Fatalf("Set-Cookie = %q, want none on a failed attempt", res.Header.Values("Set-Cookie"))
	}
	if elapsed < 500*time.Millisecond {
		t.Fatalf("a wrong guess answered in %v, want at least 500ms", elapsed)
	}
}

// sessionCookie pairs the device and returns the cookie it was given.
func sessionCookie(t *testing.T, srv *httptest.Server) *http.Cookie {
	t.Helper()
	res := pair(t, srv, `{"accessCode":"`+accessCode+`"}`)
	for _, c := range res.Cookies() {
		if c.Name == "fem_session" {
			return c
		}
	}
	t.Fatal("pairing set no fem_session cookie")
	return nil
}

func getWithCookie(t *testing.T, srv *httptest.Server, cookie *http.Cookie) bool {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/auth", nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", res.StatusCode)
	}
	var state struct {
		Paired bool `json:"paired"`
	}
	decode(t, res, &state)
	return state.Paired
}

func TestGetRecognisesAPairedDevice(t *testing.T) {
	srv := newServer(t)
	cookie := sessionCookie(t, srv)

	if !getWithCookie(t, srv, cookie) {
		t.Fatal("paired = false, want true with the cookie Pairing issued")
	}
}

func TestGetIgnoresATamperedCookie(t *testing.T) {
	srv := newServer(t)
	cookie := sessionCookie(t, srv)
	cookie.Value = cookie.Value[:len(cookie.Value)-2] + "xx"

	if getWithCookie(t, srv, cookie) {
		t.Fatal("paired = true, want false with a tampered cookie")
	}
}

func TestGetIgnoresAnExpiredCookie(t *testing.T) {
	srv := newServer(t)
	aYearAgo := time.Now().Add(-366 * 24 * time.Hour)
	stale, err := session.Sign([]byte(jwtSecret), session.Claims{DeviceID: "old", IssuedAt: aYearAgo.Unix(), ExpiresAt: aYearAgo.Add(365 * 24 * time.Hour).Unix()})
	if err != nil {
		t.Fatal(err)
	}

	if getWithCookie(t, srv, &http.Cookie{Name: "fem_session", Value: stale}) {
		t.Fatal("paired = true, want false with an expired cookie")
	}
}

func TestAMalformedBodyIsABadRequest(t *testing.T) {
	srv := newServer(t)

	res := pair(t, srv, `accessCode=oops`)

	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
	var body struct {
		Code string `json:"code"`
	}
	decode(t, res, &body)
	if body.Code != "BAD_REQUEST" {
		t.Fatalf("code = %q, want BAD_REQUEST", body.Code)
	}
}

func TestAShortConfiguredAccessCodeRefusesToPair(t *testing.T) {
	srv := newServer(t)
	t.Setenv("FAMILY_ACCESS_CODE", "short")

	res := pair(t, srv, `{"accessCode":"short"}`)

	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", res.StatusCode)
	}
	var body struct {
		Code string `json:"code"`
	}
	decode(t, res, &body)
	if body.Code != "SERVER_MISCONFIGURED" {
		t.Fatalf("code = %q, want SERVER_MISCONFIGURED", body.Code)
	}
	if len(res.Cookies()) != 0 {
		t.Fatal("a misconfigured deployment must never issue a Session")
	}
}

// currentPairCode is what the Admin's phone would show right now.
func currentPairCode() string {
	return paircode.Derive([]byte(jwtSecret), time.Now()).Code
}

// sessionFrom returns the fem_session cookie a response set, or nil.
func sessionFrom(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == "fem_session" {
			return c
		}
	}
	return nil
}

func TestATypedPairCodePairsTheDevice(t *testing.T) {
	srv := newServer(t)
	code := currentPairCode()
	typed := strings.ToLower(code[:4] + "-" + code[4:])

	res := pair(t, srv, `{"pairCode":"`+typed+`"}`)

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d, want 200; body %s", res.StatusCode, body)
	}
	cookie := sessionFrom(res)
	if cookie == nil {
		t.Fatalf("no fem_session cookie in %q", res.Header.Values("Set-Cookie"))
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != 365*24*60*60 {
		t.Fatalf("cookie = %q, want the same year-long Session the Access Code gives", cookie.Raw)
	}
	if !getWithCookie(t, srv, cookie) {
		t.Fatal("the Session from a Pair Code is not recognised")
	}
}

func TestAPairTokenFromTheQRLinkPairsTheDevice(t *testing.T) {
	srv := newServer(t)

	res, err := http.Post(srv.URL+"/api/auth?pairToken="+currentPairCode(), "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d, want 200; body %s", res.StatusCode, body)
	}
	if cookie := sessionFrom(res); cookie == nil || !getWithCookie(t, srv, cookie) {
		t.Fatal("pairToken query parameter did not issue a working Session")
	}
}

func TestAWrongPairCodeIsRefusedSlowly(t *testing.T) {
	srv := newServer(t)
	stale := paircode.Derive([]byte(jwtSecret), time.Now().Add(-25*time.Minute)).Code

	started := time.Now()
	res := pair(t, srv, `{"pairCode":"`+stale+`"}`)
	elapsed := time.Since(started)

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	decode(t, res, &body)
	if body.Code != "WRONG_PAIR_CODE" || body.Message == "" {
		t.Fatalf("body = %+v, want code WRONG_PAIR_CODE with a message", body)
	}
	if sessionFrom(res) != nil {
		t.Fatal("a stale Pair Code must not issue a Session")
	}
	if elapsed < 500*time.Millisecond {
		t.Fatalf("a wrong Pair Code answered in %v, want at least 500ms", elapsed)
	}
}

func TestAPairCodeWorksWithoutAnAccessCodeConfigured(t *testing.T) {
	srv := newServer(t)
	t.Setenv("FAMILY_ACCESS_CODE", "")

	res := pair(t, srv, `{"pairCode":"`+currentPairCode()+`"}`)

	if res.StatusCode != http.StatusOK || sessionFrom(res) == nil {
		t.Fatalf("status = %d, want 200 with a Session: Pair Codes depend only on JWT_SECRET", res.StatusCode)
	}
}
