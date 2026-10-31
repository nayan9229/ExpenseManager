package handler

// Every file in api/ is one Vercel function and all of them share this
// `handler` name, because the Go builder compiles the directory as a single
// unit. Keep the first line of every file here the bare clause above: the
// `vercel dev` server rewrites the first "package <word>" it finds in the file
// to "package main", so a leading comment that contains those words breaks
// the local build.

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/auth"
)

// Handler serves /api/auth.
func Handler(w http.ResponseWriter, r *http.Request) {
	auth.Handler(w, r)
}
