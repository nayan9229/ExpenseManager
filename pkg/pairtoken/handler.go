// Package pairtoken implements the `pair-token` function: an Admin's phone
// asks for the current Pair Code to show as a QR link and as typeable text
// (GLOSSARY: Pair Token, Pair Code).
//
// The Session is required; the role is not checked (ADR-0002: only the
// Admin's client calls this, behind the Admin PIN).
package pairtoken

import (
	"net/http"
	"net/url"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/paircode"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// Token is the GET response. `url` is the app URL with the code as the
// `pairToken` query parameter (what the QR encodes); `expiresAt` is the
// last moment `auth` accepts the code (RFC 3339, UTC).
type Token struct {
	PairCode  string `json:"pairCode"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

// Handler serves GET for a paired device.
func Handler(w http.ResponseWriter, r *http.Request) {
	session.Require(serve)(w, r)
}

func serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "pair-token accepts GET only")
		return
	}
	secret, err := session.SecretFromEnv()
	if err != nil {
		httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
		return
	}
	minted := paircode.Derive(secret, time.Now())
	link := url.URL{Scheme: scheme(r), Host: host(r), Path: "/", RawQuery: url.Values{"pairToken": {minted.Code}}.Encode()}
	w.Header().Set("Cache-Control", "no-store")
	httpjson.Write(w, http.StatusOK, Token{
		PairCode:  minted.Code,
		URL:       link.String(),
		ExpiresAt: minted.ExpiresAt.Format(time.RFC3339),
	})
}

// scheme is https unless a proxy says the app was reached over plain http
// (`vercel dev` on localhost).
func scheme(r *http.Request) string {
	if r.Header.Get("X-Forwarded-Proto") == "http" {
		return "http"
	}
	return "https"
}

func host(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		return h
	}
	return r.Host
}
