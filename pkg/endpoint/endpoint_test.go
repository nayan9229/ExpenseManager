package endpoint_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/endpoint"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

const secret = "an-endpoint-test-secret-of-32-bytes!"

type answer struct {
	status int
	allow  string
	body   map[string]string
}

func do(t *testing.T, h http.HandlerFunc, method string, paired bool) answer {
	t.Helper()
	t.Setenv("JWT_SECRET", secret)
	req := httptest.NewRequest(method, "/api/thing", nil)
	if paired {
		now := time.Now()
		token, err := session.Sign([]byte(secret), session.Claims{DeviceID: "dev-1", IssuedAt: now.Unix(), ExpiresAt: now.Add(session.Lifetime).Unix()})
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: session.CookieName, Value: token})
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return answer{rec.Code, rec.Header().Get("Allow"), body}
}

var expenses = endpoint.Function{Name: "expenses", Methods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete}}

func TestAnUnpairedDeviceIsRefusedBeforeAnythingElse(t *testing.T) {
	built := false
	h := expenses.Production(func(*http.Request) (http.HandlerFunc, error) { built = true; return nil, errors.New("unused") })

	a := do(t, h, http.MethodPatch, false)

	if a.status != http.StatusUnauthorized || a.body["code"] != "NOT_PAIRED" || built {
		t.Fatalf("got %d %v (built=%v), want 401 NOT_PAIRED without building", a.status, a.body, built)
	}
}

func TestAWrongMethodIs405WithAllowBeforeTheEnvironmentIsRead(t *testing.T) {
	cases := []struct {
		f       endpoint.Function
		allow   string
		message string
	}{
		{expenses, "GET, POST, PUT, DELETE", "expenses accepts GET, POST, PUT and DELETE"},
		{endpoint.Function{Name: "ocr", Methods: []string{http.MethodPost}}, "POST", "ocr accepts POST only"},
		{endpoint.Function{Name: "pair-token", Methods: []string{http.MethodGet}}, "GET", "pair-token accepts GET only"},
	}
	for _, c := range cases {
		built := false
		h := c.f.Production(func(*http.Request) (http.HandlerFunc, error) {
			built = true
			return nil, errors.New("GOOGLE_* missing")
		})

		a := do(t, h, http.MethodPatch, true)

		if a.status != http.StatusMethodNotAllowed || a.allow != c.allow || a.body["code"] != "METHOD_NOT_ALLOWED" || a.body["message"] != c.message || built {
			t.Errorf("%s: got %d Allow=%q %v (built=%v), want 405 Allow=%q %q", c.f.Name, a.status, a.allow, a.body, built, c.allow, c.message)
		}
	}
}

func TestAMissingVariableIs500ServerMisconfigured(t *testing.T) {
	h := expenses.Production(func(*http.Request) (http.HandlerFunc, error) {
		return nil, errors.New("GOOGLE_DRIVE_FOLDER_ID is not set")
	})

	a := do(t, h, http.MethodGet, true)

	if a.status != http.StatusInternalServerError || a.body["code"] != "SERVER_MISCONFIGURED" || a.body["message"] != "GOOGLE_DRIVE_FOLDER_ID is not set" {
		t.Fatalf("got %d %v, want 500 SERVER_MISCONFIGURED with the error", a.status, a.body)
	}
}

func TestAPairedDeviceWithTheRightMethodReachesTheBuiltHandler(t *testing.T) {
	h := expenses.Production(func(*http.Request) (http.HandlerFunc, error) {
		return func(w http.ResponseWriter, r *http.Request) {
			if _, ok := session.FromContext(r.Context()); !ok {
				t.Error("no Session in the context")
			}
			w.WriteHeader(http.StatusTeapot)
		}, nil
	})

	if a := do(t, h, http.MethodPut, true); a.status != http.StatusTeapot {
		t.Fatalf("status = %d, want the built handler's 418", a.status)
	}
}
