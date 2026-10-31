// Package uploadurl implements the `upload-url` function (spec "Receipt
// pipeline (upload-first)", step 4): it finds or creates the month folder
// for the Expense Date, opens a Drive resumable upload session with the
// browser's Origin forwarded, and hands the session URI back so the browser
// PUTs the Receipt straight to Drive.
//
// The session URI is a bearer secret: it is only ever written to the
// response body (with Cache-Control: no-store), never to a log or an error.
package uploadurl

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// MaxSize is the largest Receipt accepted, matching what OCR will read.
const MaxSize = 20 << 20

// Service is the function with its Receipt Store injected.
type Service struct {
	Store receiptstore.Store
	// FolderID is the Household's Drive folder (GOOGLE_DRIVE_FOLDER_ID).
	FolderID string
}

// Request is the POST body.
type Request struct {
	// Name is the temporary `<Expense ID>.<ext>` name.
	Name     string `json:"name"`
	MIMEType string `json:"mimeType"`
	Size     int64  `json:"size"`
	// ExpenseDate (`YYYY-MM-DD`) picks the month folder.
	ExpenseDate string `json:"expenseDate"`
}

// Response is the 200 body.
type Response struct {
	UploadURL  string `json:"uploadUrl"`
	FolderID   string `json:"folderId"`
	FolderPath string `json:"folderPath"`
	Name       string `json:"name"`
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
	if r.Method == http.MethodPost {
		return false
	}
	w.Header().Set("Allow", "POST")
	httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "upload-url accepts POST only")
	return true
}

var tempName = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]+)$`)

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if rejectMethod(w, r) {
		return
	}
	var req Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "The body must be JSON with name, mimeType, size and expenseDate")
		return
	}
	ext, ok := receiptstore.ExtensionFor(req.MIMEType)
	if !ok {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "UNSUPPORTED_TYPE", "Please choose a photo or PDF")
		return
	}
	m := tempName.FindStringSubmatch(req.Name)
	if m == nil || (m[1] != ext && !(ext == "jpg" && m[1] == "jpeg")) {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "INVALID_NAME", "The name must be <Expense ID>."+ext)
		return
	}
	if req.Size <= 0 {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "INVALID_SIZE", "The file is empty")
		return
	}
	if req.Size > MaxSize {
		httpjson.WriteError(w, http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "The file is over 20 MB")
		return
	}
	date, err := time.ParseInLocation(ledger.DateLayout, req.ExpenseDate, ledger.IST)
	if err != nil {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "INVALID_DATE", "The Expense Date must be YYYY-MM-DD")
		return
	}

	ctx := r.Context()
	month, err := receiptstore.EnsureMonthFolder(ctx, s.Store, s.FolderID, date)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return
	}
	uri, err := s.Store.OpenUpload(ctx, receiptstore.Upload{
		FolderID: month.ID, Name: req.Name, MIMEType: req.MIMEType, Size: req.Size, Origin: origin(r),
	})
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpjson.Write(w, http.StatusOK, Response{UploadURL: uri, FolderID: month.ID, FolderPath: month.Path, Name: req.Name})
}

// origin is the browser's Origin header. Browsers send it on every POST
// from fetch; if a proxy dropped it, the host the app was served from is
// the same origin (the app and /api share one).
func origin(r *http.Request) string {
	if o := r.Header.Get("Origin"); o != "" && o != "null" {
		return o
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return "https://" + strings.TrimSpace(strings.Split(host, ",")[0])
}
