package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/bootstrap"
)

// Bootstrap serves /api/bootstrap. The Session guard lives inside the
// package handler so the tests prove it.
func Bootstrap(w http.ResponseWriter, r *http.Request) {
	bootstrap.Handler(w, r)
}
