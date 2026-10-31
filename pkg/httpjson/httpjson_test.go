package httpjson_test

import (
	"net/http/httptest"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
)

func TestWriteErrorUsesTheSpecErrorEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()

	httpjson.WriteError(rec, 405, "METHOD_NOT_ALLOWED", "use GET")

	if rec.Code != 405 {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", got)
	}
	want := `{"code":"METHOD_NOT_ALLOWED","message":"use GET"}` + "\n"
	if got := rec.Body.String(); got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}
