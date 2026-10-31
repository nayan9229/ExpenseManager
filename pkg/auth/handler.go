// Package auth implements the `auth` function: Pairing a device and reporting
// whether the device already holds a Session.
//
// This ticket ships only the session-state GET. Pairing (POST with an Access
// Code or Pair Token) and Session verification arrive with ticket 02.
package auth

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
)

// SessionState is the GET response: does this device hold a valid Session?
type SessionState struct {
	Paired bool `json:"paired"`
}

// Handler routes the `auth` function by method.
func Handler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getSessionState(w, r)
	default:
		w.Header().Set("Allow", http.MethodGet)
		httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "auth accepts GET only")
	}
}

// getSessionState answers whether the request carries a valid Session.
// No Session can be valid yet because none is ever issued before ticket 02.
func getSessionState(w http.ResponseWriter, _ *http.Request) {
	httpjson.Write(w, http.StatusOK, SessionState{Paired: false})
}
