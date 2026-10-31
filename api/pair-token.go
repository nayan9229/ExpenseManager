package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/pairtoken"
)

// PairToken serves /api/pair-token: the current Pair Code, the QR link that
// carries it, and its expiry. The Session guard lives inside the package
// handler so the tests prove it.
func PairToken(w http.ResponseWriter, r *http.Request) {
	pairtoken.Handler(w, r)
}
