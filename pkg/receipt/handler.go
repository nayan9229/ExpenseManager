// Package receipt implements the `receipt` function (spec "Receipt viewing",
// ADR-0003): it serves a Receipt's bytes, or Drive's generated thumbnail of
// it, with the server's token, so a family phone never needs a Google
// login. Only files inside the Receipt Store are served, so the proxy
// cannot be used to read anything else in the Admin's Drive.
package receipt

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// MaxProxySize is the largest Receipt served whole. Vercel caps a Go
// function's buffered response at 4.5 MB (docs/research/vercel-go-runtime.md
// answer 4); 4 MB leaves room for headers.
const MaxProxySize = 4 << 20

// cacheFor is how long the browser may keep an answer. A Receipt's bytes
// never change under its file ID (edits never replace the file), and the
// answer is per-Household, so it is private.
const cacheFor = "private, max-age=86400"

// Service is the function with its Receipt Store injected.
type Service struct {
	Store receiptstore.Store
	// FolderID is the Household's Drive folder (GOOGLE_DRIVE_FOLDER_ID).
	FolderID string
}

// Handler is the guarded function: a valid Session first, then the work.
func (s Service) Handler() http.HandlerFunc {
	return session.Require(s.serve)
}

// Handler is the production entry point: the Session and the method are
// checked first, then the Receipt Store is built from the environment.
func Handler(w http.ResponseWriter, r *http.Request) {
	session.Require(func(w http.ResponseWriter, r *http.Request) {
		if rejectMethod(w, r) {
			return
		}
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
			return
		}
		Service{Store: d.Store, FolderID: d.FolderID}.serve(w, r)
	})(w, r)
}

func rejectMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet {
		return false
	}
	w.Header().Set("Allow", "GET")
	httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "receipt accepts GET only")
	return true
}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if rejectMethod(w, r) {
		return
	}
	ctx := r.Context()
	id := r.URL.Query().Get("id")
	file, err := receiptstore.Locate(ctx, s.Store, s.FolderID, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	body, err := s.Store.Download(ctx, file.ID, MaxProxySize)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeBytes(w, file.MIMEType, body)
}

func writeBytes(w http.ResponseWriter, mimeType string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", mimeType)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("Cache-Control", cacheFor)
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func writeStoreError(w http.ResponseWriter, err error) {
	w.Header().Set("Cache-Control", "no-store")
	httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
	_ = errors.Is
}
