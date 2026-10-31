package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/auth"
)

func TestGetReportsAnUnpairedDevice(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(auth.Handler))
	defer srv.Close()

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
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if state.Paired {
		t.Fatal("paired = true, want false for a device with no Session")
	}
}

func TestUnsupportedMethodIsRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(auth.Handler))
	defer srv.Close()

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
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Code != "METHOD_NOT_ALLOWED" {
		t.Fatalf("code = %q, want METHOD_NOT_ALLOWED", body.Code)
	}
}
