package handler

// Every file in api/ is one Vercel function and all of them share this
// `handler` name, because the Go builder compiles the directory as a single
// unit. Keep the first line of every file here the bare clause above: the
// `vercel dev` server rewrites the first "package <word>" it finds in the file
// to "package main", so a leading comment that contains those words breaks
// the local build.
//
// Each file exports one differently named function (Pair, Bootstrap, ...):
// the builder picks the first exported func with the http.HandlerFunc shape
// whatever it is called, and `go vet ./...` compiles api/ as one package, so
// two files could not both export `Handler`.

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/pairing"
)

// Pair serves /api/pair.
func Pair(w http.ResponseWriter, r *http.Request) {
	pairing.Handler(w, r)
}
