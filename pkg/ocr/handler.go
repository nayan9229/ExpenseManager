package ocr

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/endpoint"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// MaxSize is the largest Receipt sent inline (research answer 3: 20 MB is
// the safe bound for an inline request). The phone already refuses bigger
// files, and upload-url does too; this guards a file put in Drive by hand.
const MaxSize = 20 << 20

// Service is the `ocr` function with its seams injected.
type Service struct {
	Store receiptstore.Store
	OCR   OCR
	// FolderID is the Household's Drive folder (GOOGLE_DRIVE_FOLDER_ID).
	FolderID string
}

// Request is the POST body: the Drive file ID the upload returned.
type Request struct {
	FileID string `json:"fileId"`
}

// Handler is the guarded function: a valid Session first, then the work.
func (s Service) Handler() http.HandlerFunc {
	return session.Require(s.serve)
}

// Handler is the production entry point: Session, method, then the Gemini
// configuration and the Google seams from the environment.
func Handler(w http.ResponseWriter, r *http.Request) {
	function.Production(func(r *http.Request) (http.HandlerFunc, error) {
		cfg, err := ConfigFromEnv()
		if err != nil {
			return nil, err
		}
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			return nil, err
		}
		return Service{Store: d.Store, OCR: NewGemini(cfg), FolderID: d.FolderID}.serve, nil
	})(w, r)
}

// function is the `ocr` function's name and methods.
var function = endpoint.Function{Name: "ocr", Methods: []string{http.MethodPost}}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if function.RejectMethod(w, r) {
		return
	}
	var req Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil || req.FileID == "" {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "The body must be JSON with fileId")
		return
	}

	ctx := r.Context()
	file, err := receiptstore.Locate(ctx, s.Store, s.FolderID, req.FileID)
	if errors.Is(err, receiptstore.ErrNotFound) || errors.Is(err, receiptstore.ErrNotAReceipt) {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "RECEIPT_NOT_IN_STORE", "The Receipt is not in the Receipt Store; scan it again")
		return
	}
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return
	}
	if file.Size > MaxSize {
		tooLarge(w)
		return
	}
	if _, ok := receiptstore.ExtensionFor(file.MIMEType); !ok {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, "UNSUPPORTED_TYPE", "Only photos and PDFs can be read")
		return
	}

	content, err := s.Store.Download(ctx, file.ID, MaxSize)
	// Drive's size can be missing; the bytes are the truth.
	if errors.Is(err, receiptstore.ErrTooLarge) {
		tooLarge(w)
		return
	}
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return
	}

	answer, err := s.OCR.Read(ctx, Receipt{Bytes: content, MIMEType: file.MIMEType})
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GEMINI_ERROR", err.Error())
		return
	}
	result, err := Validate(answer)
	var rejected *Rejected
	if errors.As(err, &rejected) {
		httpjson.WriteError(w, http.StatusUnprocessableEntity, rejected.Code, rejected.Message)
		return
	}
	if err != nil {
		httpjson.WriteError(w, http.StatusBadGateway, "GEMINI_ERROR", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpjson.Write(w, http.StatusOK, result)
}

func tooLarge(w http.ResponseWriter) {
	httpjson.WriteError(w, http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "The Receipt is over 20 MB, too big to read")
}
