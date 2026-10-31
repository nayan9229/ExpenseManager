package receiptstore

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

// Download is `files.get?alt=media` (ticket 07 reads the bytes for OCR).
func TestDownloadReadsTheFileContent(t *testing.T) {
	var query, path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, query = r.URL.Path, r.URL.RawQuery
		if !strings.HasSuffix(r.URL.Path, "/files/file-1") {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error": {"code": 404, "message": "File not found: nope.", "errors": [{"reason": "notFound"}]}}`)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = io.WriteString(w, "\xff\xd8\xff jpeg bytes")
	}))
	t.Cleanup(srv.Close)
	svc, err := drive.NewService(t.Context(), option.WithEndpoint(srv.URL+"/drive/v3/"), option.WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatal(err)
	}
	d := NewDrive(svc, srv.Client())

	got, err := d.Download(t.Context(), "file-1", 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "\xff\xd8\xff jpeg bytes" {
		t.Errorf("bytes = %q, want the file content", got)
	}
	if !strings.Contains(query, "alt=media") {
		t.Errorf("GET %s?%s, want alt=media", path, query)
	}

	if _, err := d.Download(t.Context(), "nope", 1<<20); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown file: err = %v, want ErrNotFound", err)
	}

	// One byte over the caller's limit is ErrTooLarge, never a short read.
	content := "\xff\xd8\xff jpeg bytes"
	if _, err := d.Download(t.Context(), "file-1", int64(len(content))-1); !errors.Is(err, ErrTooLarge) {
		t.Errorf("over the limit: err = %v, want ErrTooLarge", err)
	}
	if got, err := d.Download(t.Context(), "file-1", int64(len(content))); err != nil || string(got) != content {
		t.Errorf("exactly the limit: %q, %v; want the whole file", got, err)
	}
}
