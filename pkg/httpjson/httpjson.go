// Package httpjson writes the JSON responses every function returns.
//
// Success bodies are whatever the handler passes in; error bodies always use
// the spec's `{ code, message }` envelope so the client can switch on `code`.
package httpjson

import (
	"encoding/json"
	"net/http"
)

// Error is the body of every non-2xx response.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Write encodes v as JSON with the given status.
func Write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes the error envelope with the given status.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	Write(w, status, Error{Code: code, Message: message})
}
