package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/ocr"
)

// OCR serves /api/ocr: reads a Receipt already in Drive with Gemini and
// returns the fields that prefill the Expense form. The Session guard lives
// inside the package handler so the tests prove it.
func OCR(w http.ResponseWriter, r *http.Request) {
	ocr.Handler(w, r)
}
