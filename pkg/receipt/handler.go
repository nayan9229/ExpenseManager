// Package receipt implements the `receipt` function (spec "Receipt viewing",
// ADR-0003): it serves a Receipt's bytes, or Drive's generated thumbnail of
// it, with the server's token, so a family phone never needs a Google
// login. Only files inside the Receipt Store are served, so the proxy
// cannot be used to read anything else in the Admin's Drive.
package receipt

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/endpoint"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// MaxProxySize is the largest Receipt served whole. Vercel caps a Go
// function's buffered response at 4.5 MB
// (https://vercel.com/docs/functions/limitations); 4 MB leaves room for headers.
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
	function.Production(func(r *http.Request) (http.HandlerFunc, error) {
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			return nil, err
		}
		return Service{Store: d.Store, FolderID: d.FolderID}.serve, nil
	})(w, r)
}

// function is the `receipt` function's name and methods.
var function = endpoint.Function{Name: "receipt", Methods: []string{http.MethodGet}}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if function.RejectMethod(w, r) {
		return
	}
	ctx := r.Context()
	id := r.URL.Query().Get("id")
	if !driveID.MatchString(id) {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Pass the Receipt's Drive file ID as ?id=")
		return
	}
	file, err := receiptstore.Locate(ctx, s.Store, s.FolderID, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if r.URL.Query().Get("thumb") != "" {
		thumb, err := s.Store.Thumbnail(ctx, file)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		// The original's type, so the lightbox knows "PDF" before it
		// downloads anything.
		w.Header().Set("X-Receipt-Type", file.MIMEType)
		writeBytes(w, thumb.MIMEType, thumb.Bytes)
		return
	}
	if file.Size > MaxProxySize {
		writeTooLarge(w, file)
		return
	}
	body, err := s.Store.Download(ctx, file.ID, MaxProxySize)
	if errors.Is(err, receiptstore.ErrTooLarge) {
		writeTooLarge(w, file)
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeBytes(w, file.MIMEType, body)
}

// TooLarge is the 413 body: the usual envelope plus the way out.
type TooLarge struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	// WebViewLink opens the Receipt in Google Drive (needs the Admin's login).
	WebViewLink string `json:"webViewLink"`
	Size        int64  `json:"size"`
}

func writeTooLarge(w http.ResponseWriter, file receiptstore.File) {
	w.Header().Set("Cache-Control", "no-store")
	httpjson.Write(w, http.StatusRequestEntityTooLarge, TooLarge{
		Code:        "RECEIPT_TOO_LARGE",
		Message:     "This Receipt is too large to show in the app. Open it in Google Drive.",
		WebViewLink: file.WebViewLink,
		Size:        file.Size,
	})
}

// driveID is the shape of a Drive file ID.
var driveID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// servable are the types a Receipt may be shown as (spec: images and PDF).
// The proxy answers on the app's origin, so anything else (an HTML file
// dropped into the folder by hand) goes out as an opaque download.
var servable = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true,
	"image/heic": true, "image/heif": true, "application/pdf": true,
}

func writeBytes(w http.ResponseWriter, mimeType string, body []byte) {
	h := w.Header()
	if !servable[mimeType] {
		mimeType = "application/octet-stream"
		h.Set("Content-Disposition", "attachment")
	}
	h.Set("Content-Type", mimeType)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("Cache-Control", cacheFor)
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func writeStoreError(w http.ResponseWriter, err error) {
	w.Header().Set("Cache-Control", "no-store")
	switch {
	// A file outside the Receipt Store answers exactly like a missing one,
	// so the proxy does not even confirm that it exists.
	case errors.Is(err, receiptstore.ErrNotFound), errors.Is(err, receiptstore.ErrNotAReceipt):
		httpjson.WriteError(w, http.StatusNotFound, "RECEIPT_NOT_FOUND", "No Receipt has that ID")
	case errors.Is(err, receiptstore.ErrNoThumbnail):
		httpjson.WriteError(w, http.StatusNotFound, "NO_THUMBNAIL", "Google Drive has not made a preview of this Receipt yet")
	default:
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
	}
}
