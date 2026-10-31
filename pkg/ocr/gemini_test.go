package ocr

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const testKey = "AIzaSy-test-key-not-real"

type recorded struct {
	method, path, query string
	header              http.Header
	body                map[string]any
}

// geminiStandIn answers like generateContent with status and body, and
// records the request.
func geminiStandIn(t *testing.T, status int, body string) (*Gemini, *recorded) {
	t.Helper()
	got := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path, got.query, got.header = r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got.body)
		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	g := NewGemini(Config{APIKey: testKey, Model: "gemini-3.5-flash-lite"})
	g.endpoint, g.http = srv.URL, srv.Client()
	return g, got
}

// okResponse has the shape of the generateContent answers in the
// migration guide (research answer 5), with a thought part first.
const okResponse = `{
  "candidates": [{
    "content": {"role": "model", "parts": [
      {"text": "Reading the totals…", "thought": true},
      {"text": "{\"merchant\": \"Apollo Pharmacy\","},
      {"text": " \"totalAmount\": 450}"}
    ]},
    "finishReason": "STOP",
    "index": 0
  }],
  "usageMetadata": {"promptTokenCount": 1032, "candidatesTokenCount": 61, "thoughtsTokenCount": 12, "totalTokenCount": 1105},
  "modelVersion": "gemini-3.5-flash-lite",
  "responseId": "mAitaKqXJ4ug1MkPuZ7XqAo"
}`

func TestGeminiSendsTheReceiptInlineWithTheSchemaAndStorageOff(t *testing.T) {
	g, got := geminiStandIn(t, http.StatusOK, okResponse)
	photo := []byte("\xff\xd8\xff\xe0 pharmacy bill")

	categories := []string{"Groceries", "Petrol & Transport", "Other"}
	if _, err := g.Read(t.Context(), Receipt{Bytes: photo, MIMEType: "image/jpeg", Categories: categories}); err != nil {
		t.Fatal(err)
	}

	if got.method != http.MethodPost || got.path != "/v1beta/models/gemini-3.5-flash-lite:generateContent" {
		t.Errorf("request = %s %s, want POST /v1beta/models/gemini-3.5-flash-lite:generateContent", got.method, got.path)
	}
	if k := got.header.Get("x-goog-api-key"); k != testKey {
		t.Errorf("x-goog-api-key = %q, want the key", k)
	}
	if strings.Contains(got.query, testKey) {
		t.Errorf("query %q carries the key; it belongs in the header only", got.query)
	}
	if got.body["store"] != false {
		t.Errorf("store = %v, want false (spec: request storage disabled)", got.body["store"])
	}
	config, _ := got.body["generationConfig"].(map[string]any)
	if config["responseMimeType"] != "application/json" {
		t.Errorf("responseMimeType = %v, want application/json", config["responseMimeType"])
	}
	if !reflect.DeepEqual(config["responseSchema"], roundTrip(ResponseSchema(categories))) {
		t.Errorf("responseSchema = %v\nwant %v", config["responseSchema"], ResponseSchema(categories))
	}
	if _, ok := config["thinkingConfig"]; ok {
		t.Errorf("thinkingConfig sent; the spec leaves thinking at the model's default")
	}
	parts := partsOf(t, got.body)
	wantParts := []any{
		map[string]any{"text": Prompt},
		map[string]any{"inlineData": map[string]any{"mimeType": "image/jpeg", "data": base64.StdEncoding.EncodeToString(photo)}},
	}
	if !reflect.DeepEqual(parts, wantParts) {
		t.Errorf("parts = %v\nwant %v (prompt before a single image)", parts, wantParts)
	}
}

func TestGeminiPutsThePromptAfterAPDF(t *testing.T) {
	g, got := geminiStandIn(t, http.StatusOK, okResponse)

	if _, err := g.Read(t.Context(), Receipt{Bytes: []byte("%PDF-1.7"), MIMEType: "application/pdf"}); err != nil {
		t.Fatal(err)
	}

	parts := partsOf(t, got.body)
	if len(parts) != 2 || parts[1].(map[string]any)["text"] != Prompt {
		t.Errorf("parts = %v, want the PDF then the prompt (research answer 3)", parts)
	}
	if inline := parts[0].(map[string]any)["inlineData"].(map[string]any); inline["mimeType"] != "application/pdf" {
		t.Errorf("inlineData = %v, want application/pdf", inline)
	}
}

func TestGeminiUsesTheConfiguredModel(t *testing.T) {
	g, got := geminiStandIn(t, http.StatusOK, okResponse)
	g.cfg.Model = "gemini-2.5-flash"

	if _, err := g.Read(t.Context(), Receipt{Bytes: []byte("x"), MIMEType: "image/jpeg"}); err != nil {
		t.Fatal(err)
	}
	if got.path != "/v1beta/models/gemini-2.5-flash:generateContent" {
		t.Errorf("path = %s, want the GEMINI_MODEL id", got.path)
	}
}

func TestGeminiAnswerIsTheJSONTextWithoutThoughtsAndTheFinishReason(t *testing.T) {
	g, _ := geminiStandIn(t, http.StatusOK, okResponse)

	a, err := g.Read(t.Context(), Receipt{Bytes: []byte("x"), MIMEType: "image/jpeg"})

	want := Answer{FinishReason: "STOP", Text: `{"merchant": "Apollo Pharmacy", "totalAmount": 450}`, ModelVersion: "gemini-3.5-flash-lite"}
	if err != nil || a != want {
		t.Errorf("answer = %+v err = %v\nwant %+v", a, err, want)
	}
}

func TestGeminiReportsABlockedPromptAndAStoppedCandidate(t *testing.T) {
	t.Run("prompt blocked: no candidates", func(t *testing.T) {
		g, _ := geminiStandIn(t, http.StatusOK, `{"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}, "modelVersion": "gemini-3.5-flash-lite"}`)

		a, err := g.Read(t.Context(), Receipt{Bytes: []byte("x"), MIMEType: "image/jpeg"})

		if err != nil || a.BlockReason != "PROHIBITED_CONTENT" || a.FinishReason != "" {
			t.Errorf("answer = %+v err = %v, want BlockReason PROHIBITED_CONTENT", a, err)
		}
	})
	t.Run("candidate stopped for personal data", func(t *testing.T) {
		g, _ := geminiStandIn(t, http.StatusOK, `{"candidates": [{"finishReason": "SPII", "finishMessage": "Sensitive data", "index": 0}]}`)

		a, err := g.Read(t.Context(), Receipt{Bytes: []byte("x"), MIMEType: "image/jpeg"})

		if err != nil || a.FinishReason != "SPII" || a.FinishMessage != "Sensitive data" || a.Text != "" {
			t.Errorf("answer = %+v err = %v, want FinishReason SPII with its message", a, err)
		}
	})
}

func TestGeminiRefusalsAreErrorsWithGooglesMessageAndNeverTheKey(t *testing.T) {
	g, _ := geminiStandIn(t, http.StatusTooManyRequests,
		`{"error": {"code": 429, "message": "Resource has been exhausted (e.g. check quota).", "status": "RESOURCE_EXHAUSTED"}}`)

	_, err := g.Read(t.Context(), Receipt{Bytes: []byte("x"), MIMEType: "image/jpeg"})

	if err == nil || !strings.Contains(err.Error(), "429") || !strings.Contains(err.Error(), "Resource has been exhausted") {
		t.Fatalf("err = %v, want the status and Google's message", err)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Errorf("err = %v leaks the API key", err)
	}
}

func property(t *testing.T, schema map[string]any, name string) map[string]any {
	t.Helper()
	p, ok := schema["properties"].(map[string]any)[name].(map[string]any)
	if !ok {
		t.Fatalf("schema has no property %q", name)
	}
	return p
}

func TestTheCategoryEnumIsTheCategoriesGivenAndMayBeNull(t *testing.T) {
	schema := ResponseSchema([]string{"Fuel", "Kirana"})

	category := property(t, schema, "category")
	if category["type"] != "STRING" || category["format"] != "enum" || category["nullable"] != true {
		t.Errorf("category = %v, want a nullable STRING enum", category)
	}
	if !reflect.DeepEqual(category["enum"], []string{"Fuel", "Kirana"}) {
		t.Errorf("category enum = %v, want the Categories given", category["enum"])
	}

	empty := property(t, ResponseSchema(nil), "category")
	if _, ok := empty["enum"]; ok || empty["nullable"] != true {
		t.Errorf("category with no Categories = %v, want a nullable STRING without an empty enum", empty)
	}
}

func TestTheReceiptNumberIsANullableStringWithItsOwnConfidence(t *testing.T) {
	schema := ResponseSchema([]string{"Other"})

	if p := property(t, schema, "receiptNumber"); p["type"] != "STRING" || p["nullable"] != true {
		t.Errorf("receiptNumber = %v, want a nullable STRING", p)
	}
	confidence := property(t, schema, "confidence")
	if _, ok := confidence["properties"].(map[string]any)["receiptNumber"]; !ok {
		t.Errorf("confidence = %v, want a receiptNumber score", confidence)
	}
	for _, list := range []any{schema["required"], confidence["required"]} {
		found := false
		for _, k := range list.([]string) {
			found = found || k == "receiptNumber"
		}
		if !found {
			t.Errorf("required %v does not list receiptNumber", list)
		}
	}
}

func TestGeminiConfigComesFromTheEnvironment(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", testKey)
	t.Setenv("GEMINI_MODEL", "")
	if cfg, err := ConfigFromEnv(); err != nil || cfg.Model != "gemini-3.5-flash-lite" {
		t.Errorf("cfg = %+v err = %v, want the default model gemini-3.5-flash-lite", cfg, err)
	}
	t.Setenv("GEMINI_MODEL", "gemini-3.8-flash")
	if cfg, _ := ConfigFromEnv(); cfg.Model != "gemini-3.8-flash" {
		t.Errorf("model = %q, want GEMINI_MODEL", cfg.Model)
	}
	t.Setenv("GEMINI_API_KEY", "  ")
	if _, err := ConfigFromEnv(); err == nil || !strings.Contains(err.Error(), "GEMINI_API_KEY") {
		t.Errorf("err = %v, want one naming GEMINI_API_KEY", err)
	}
}

func partsOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	contents, _ := body["contents"].([]any)
	if len(contents) != 1 {
		t.Fatalf("contents = %v, want one", body["contents"])
	}
	parts, _ := contents[0].(map[string]any)["parts"].([]any)
	return parts
}

func roundTrip(v any) any {
	raw, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(raw, &out)
	return out
}
