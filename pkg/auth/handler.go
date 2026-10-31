// Package auth implements the `auth` function: Pairing a device and reporting
// whether the device already holds a Session (GLOSSARY: Pairing, Access Code,
// Session; ADR-0002).
//
// GET answers `{ "paired": bool }` from the cookie alone. POST takes the
// Household Access Code and, when it matches, issues the year-long Session.
// Pair Tokens (`pairToken` from a QR link or typed as a Pair Code) are the
// second input the spec lists; they arrive with ticket 12 and plug into
// `pair` below next to the Access Code branch.
package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// SessionState is the GET response: does this device hold a valid Session?
type SessionState struct {
	Paired bool `json:"paired"`
}

// PairRequest is the POST body. Exactly one Pairing input is used; ticket 12
// adds `pairToken` beside `accessCode`.
type PairRequest struct {
	AccessCode string `json:"accessCode"`
}

// minAccessCodeLength is the documented floor (.env.example). A deployment
// with a shorter code refuses to pair rather than pair with a weak secret.
const minAccessCodeLength = 10

// failedAttemptDelay slows an attacker guessing the Access Code (user story 8).
const failedAttemptDelay = 500 * time.Millisecond

var errNoAccessCode = errors.New("FAMILY_ACCESS_CODE must be set to at least 10 characters")

// Handler routes the `auth` function by method.
func Handler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getSessionState(w, r)
	case http.MethodPost:
		pair(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "auth accepts GET and POST only")
	}
}

// getSessionState answers whether the request carries a valid Session.
// A missing secret is reported as unpaired rather than as an error, so the
// app still boots to the Gatekeeper on a half-configured deployment.
func getSessionState(w http.ResponseWriter, r *http.Request) {
	secret, err := session.SecretFromEnv()
	if err != nil {
		httpjson.Write(w, http.StatusOK, SessionState{Paired: false})
		return
	}
	_, err = session.FromRequest(r, secret, time.Now())
	httpjson.Write(w, http.StatusOK, SessionState{Paired: err == nil})
}

// pair checks the Access Code and issues a Session on a match.
func pair(w http.ResponseWriter, r *http.Request) {
	secret, err := session.SecretFromEnv()
	if err != nil {
		httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
		return
	}
	expected, err := accessCodeFromEnv()
	if err != nil {
		httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
		return
	}
	var body PairRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "body must be JSON like {\"accessCode\": \"...\"}")
		return
	}
	if !codesMatch(body.AccessCode, expected) {
		time.Sleep(failedAttemptDelay)
		httpjson.WriteError(w, http.StatusUnauthorized, "WRONG_ACCESS_CODE", "That code didn't work")
		return
	}
	if _, err := session.Issue(w, secret, time.Now()); err != nil {
		httpjson.WriteError(w, http.StatusInternalServerError, "SESSION_FAILED", "could not issue a Session")
		return
	}
	httpjson.Write(w, http.StatusOK, SessionState{Paired: true})
}

// accessCodeFromEnv reads the Household Access Code the deployment was
// configured with.
func accessCodeFromEnv() (string, error) {
	code := os.Getenv("FAMILY_ACCESS_CODE")
	if len(code) < minAccessCodeLength {
		return "", errNoAccessCode
	}
	return code, nil
}

// codesMatch compares in constant time. Hashing first means the comparison
// takes the same time whatever the lengths, so length is not leaked either.
func codesMatch(got, want string) bool {
	g := sha256.Sum256([]byte(got))
	e := sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(g[:], e[:]) == 1
}
