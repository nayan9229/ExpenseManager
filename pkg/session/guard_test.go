package session_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// guardedServer wraps a handler that echoes the Session's deviceId, the way
// every function after `pair` will wrap its own handler.
func guardedServer(t *testing.T) *httptest.Server {
	t.Helper()
	t.Setenv("JWT_SECRET", string(secret))
	echo := func(w http.ResponseWriter, r *http.Request) {
		claims, ok := session.FromContext(r.Context())
		if !ok {
			t.Error("guarded handler ran without Session claims in the context")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"deviceId": claims.DeviceID})
	}
	srv := httptest.NewServer(session.Require(echo))
	t.Cleanup(srv.Close)
	return srv
}

func call(t *testing.T, srv *httptest.Server, cookieValue string) (int, map[string]string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/anything", nil)
	if cookieValue != "" {
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: cookieValue})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]string
	_ = json.NewDecoder(res.Body).Decode(&body)
	return res.StatusCode, body
}

func TestTheGuardLetsAPairedDeviceThrough(t *testing.T) {
	srv := guardedServer(t)
	now := time.Now()
	token, _ := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: now.Unix(), ExpiresAt: now.Add(session.Lifetime).Unix()})

	status, body := call(t, srv, token)

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %v", status, body)
	}
	if body["deviceId"] != "dev-123" {
		t.Fatalf("handler saw deviceId %q, want dev-123", body["deviceId"])
	}
}

func TestTheGuardRejectsAMissingSession(t *testing.T) {
	srv := guardedServer(t)

	status, body := call(t, srv, "")

	if status != http.StatusUnauthorized || body["code"] != "NOT_PAIRED" {
		t.Fatalf("status = %d body = %v, want 401 NOT_PAIRED", status, body)
	}
}

func TestTheGuardRejectsAnExpiredSession(t *testing.T) {
	srv := guardedServer(t)
	aYearAgo := time.Now().Add(-366 * 24 * time.Hour)
	token, _ := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: aYearAgo.Unix(), ExpiresAt: aYearAgo.Add(session.Lifetime).Unix()})

	status, body := call(t, srv, token)

	if status != http.StatusUnauthorized || body["code"] != "NOT_PAIRED" {
		t.Fatalf("status = %d body = %v, want 401 NOT_PAIRED", status, body)
	}
}

func TestTheGuardRejectsATamperedSession(t *testing.T) {
	srv := guardedServer(t)
	now := time.Now()
	token, _ := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: now.Unix(), ExpiresAt: now.Add(session.Lifetime).Unix()})
	tampered := token[:len(token)-2] + "xx"

	status, body := call(t, srv, tampered)

	if status != http.StatusUnauthorized || body["code"] != "NOT_PAIRED" {
		t.Fatalf("status = %d body = %v, want 401 NOT_PAIRED", status, body)
	}
}

func TestTheGuardFailsClosedWithoutASecret(t *testing.T) {
	srv := guardedServer(t)
	t.Setenv("JWT_SECRET", "")
	now := time.Now()
	token, _ := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: now.Unix(), ExpiresAt: now.Add(session.Lifetime).Unix()})

	status, body := call(t, srv, token)

	if status != http.StatusInternalServerError || body["code"] != "SERVER_MISCONFIGURED" {
		t.Fatalf("status = %d body = %v, want 500 SERVER_MISCONFIGURED", status, body)
	}
}
