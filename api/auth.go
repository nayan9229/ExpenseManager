// Package handler is the one package name shared by every file in api/, as
// the Vercel Go builder compiles the directory as a single package.
package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/auth"
)

// Handler serves /api/auth.
func Handler(w http.ResponseWriter, r *http.Request) {
	auth.Handler(w, r)
}
