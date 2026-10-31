package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/receipt"
)

// Receipt serves /api/receipt: a Receipt's bytes (or, with thumb=1, Drive's
// thumbnail of it) through the server's token (ADR-0003). The Session guard
// lives inside the package handler so the tests prove it.
func Receipt(w http.ResponseWriter, r *http.Request) {
	receipt.Handler(w, r)
}
