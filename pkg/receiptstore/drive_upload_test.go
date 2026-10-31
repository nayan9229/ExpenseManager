package receiptstore

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// The resumable initiation is the one raw HTTP call in the adapter, and the
// cross-origin PUT depends on exactly these headers (research answer 1), so
// it is checked against a stand-in for the Drive upload endpoint.
func TestOpenUploadSendsTheInitiationDriveDocuments(t *testing.T) {
	var got struct {
		method, query string
		header        http.Header
		meta          map[string]any
	}
	const session = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=xa298sd"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.query, got.header = r.Method, r.URL.RawQuery, r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got.meta)
		w.Header().Set("Location", session)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	d := &Drive{http: srv.Client(), uploadEndpoint: srv.URL + "/upload/drive/v3/files"}

	uri, err := d.OpenUpload(context.Background(), Upload{
		FolderID: "month-1", Name: "6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10.jpg", MIMEType: "image/jpeg", Size: 245000, Origin: "https://app.example",
	})

	if err != nil || uri != session {
		t.Fatalf("uri = %q err = %v, want the Location header", uri, err)
	}
	if got.method != http.MethodPost || !strings.Contains(got.query, "uploadType=resumable") {
		t.Errorf("request = %s ?%s, want POST ?uploadType=resumable", got.method, got.query)
	}
	for name, want := range map[string]string{
		"Origin":                  "https://app.example",
		"X-Upload-Content-Type":   "image/jpeg",
		"X-Upload-Content-Length": "245000",
		"Content-Type":            "application/json; charset=UTF-8",
	} {
		if v := got.header.Get(name); v != want {
			t.Errorf("%s = %q, want %q", name, v, want)
		}
	}
	wantMeta := map[string]any{"name": "6f1c2a52-8a0e-4d7b-9d55-0b9e1c3f7a10.jpg", "mimeType": "image/jpeg", "parents": []any{"month-1"}}
	if !reflect.DeepEqual(got.meta, wantMeta) {
		t.Errorf("metadata = %v, want %v", got.meta, wantMeta)
	}
}

func TestOpenUploadReportsDrivesRefusalWithoutASessionURI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":{"code":404,"message":"File not found: month-1."}}`, http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	d := &Drive{http: srv.Client(), uploadEndpoint: srv.URL}

	_, err := d.OpenUpload(context.Background(), Upload{FolderID: "month-1", Name: "x.jpg", MIMEType: "image/jpeg", Size: 1})

	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want Drive's 404 passed through", err)
	}
}
