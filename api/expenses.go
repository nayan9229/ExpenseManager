package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/expenses"
)

// Expenses serves /api/expenses. The Session guard lives inside the
// package handler so the tests prove it.
func Expenses(w http.ResponseWriter, r *http.Request) {
	expenses.Handler(w, r)
}
