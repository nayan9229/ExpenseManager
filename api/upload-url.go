package handler

import (
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/uploadurl"
)

// UploadURL serves /api/upload-url: a fresh Drive resumable session for one
// Receipt. The Session guard lives inside the package handler so the tests
// prove it.
func UploadURL(w http.ResponseWriter, r *http.Request) {
	uploadurl.Handler(w, r)
}
