package ocr

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// DefaultModel is used when GEMINI_MODEL is blank (spec "OCR"; research
// answer 1: 2.5 Flash is gated to projects that used it before).
const DefaultModel = "gemini-3.5-flash-lite"

// Endpoint is the Gemini API's REST root (research answer 2).
const Endpoint = "https://generativelanguage.googleapis.com"

// Timeout bounds one generateContent call; OCR takes 10 to 30 s and the
// function's maxDuration is 60 s (vercel.json), so the phone always gets a
// JSON answer rather than a platform timeout.
const Timeout = 50 * time.Second

// Config is the Gemini configuration.
type Config struct {
	APIKey string
	Model  string
}

// ConfigFromEnv reads GEMINI_API_KEY (required) and GEMINI_MODEL.
func ConfigFromEnv() (Config, error) {
	cfg := Config{APIKey: strings.TrimSpace(os.Getenv("GEMINI_API_KEY")), Model: strings.TrimSpace(os.Getenv("GEMINI_MODEL"))}
	if cfg.APIKey == "" {
		return Config{}, errors.New("GEMINI_API_KEY is not set: Receipt OCR needs a Gemini API key on a billed project")
	}
	if cfg.Model == "" {
		cfg.Model = DefaultModel
	}
	return cfg, nil
}

// Gemini is the production OCR: `models.generateContent` over plain REST,
// no SDK.
type Gemini struct {
	cfg      Config
	endpoint string
	http     *http.Client
}

// NewGemini returns the REST adapter.
func NewGemini(cfg Config) *Gemini {
	return &Gemini{cfg: cfg, endpoint: Endpoint, http: &http.Client{Timeout: Timeout}}
}

// request is the generateContent body. The schema goes in
// generationConfig.responseSchema with responseMimeType, the shape Google's
// current generateContent examples use (migration guide, research answer
// 2). The REST reference marks responseSchema deprecated in favour of
// generationConfig.responseFormat; swapping is this struct and nothing else.
type request struct {
	Contents         []content        `json:"contents"`
	GenerationConfig generationConfig `json:"generationConfig"`
	// Store false turns off Gemini API request logging for this call
	// (spec "OCR", user story 72; research answer 7).
	Store bool `json:"store"`
}

type content struct {
	Role  string `json:"role,omitempty"`
	Parts []part `json:"parts"`
}

type part struct {
	Text       string      `json:"text,omitempty"`
	InlineData *inlineData `json:"inlineData,omitempty"`
	Thought    bool        `json:"thought,omitempty"`
}

type inlineData struct {
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
}

type generationConfig struct {
	ResponseMIMEType string         `json:"responseMimeType"`
	ResponseSchema   map[string]any `json:"responseSchema"`
}

type response struct {
	Candidates []struct {
		Content       content `json:"content"`
		FinishReason  string  `json:"finishReason"`
		FinishMessage string  `json:"finishMessage"`
	} `json:"candidates"`
	PromptFeedback struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	ModelVersion string `json:"modelVersion"`
}

type apiError struct {
	Error struct {
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

// Read implements OCR.
func (g *Gemini) Read(ctx context.Context, r Receipt) (Answer, error) {
	file := part{InlineData: &inlineData{MIMEType: r.MIMEType, Data: base64.StdEncoding.EncodeToString(r.Bytes)}}
	prompt := part{Text: Prompt}
	// Research answer 3: prompt before a single image, after a single PDF page.
	parts := []part{prompt, file}
	if r.MIMEType == "application/pdf" {
		parts = []part{file, prompt}
	}
	body, err := json.Marshal(request{
		Contents:         []content{{Role: "user", Parts: parts}},
		GenerationConfig: generationConfig{ResponseMIMEType: "application/json", ResponseSchema: ResponseSchema(r.Categories)},
		Store:            false,
	})
	if err != nil {
		return Answer{}, err
	}
	u := g.endpoint + "/v1beta/models/" + url.PathEscape(g.cfg.Model) + ":generateContent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return Answer{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", g.cfg.APIKey)

	res, err := g.http.Do(req)
	if err != nil {
		// *url.Error carries the URL, which never holds the key (header only).
		return Answer{}, fmt.Errorf("gemini: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return Answer{}, fmt.Errorf("gemini: reading the answer: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		var e apiError
		msg := strings.TrimSpace(string(raw))
		if json.Unmarshal(raw, &e) == nil && e.Error.Message != "" {
			msg = e.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return Answer{}, fmt.Errorf("gemini %s: %s: %s", g.cfg.Model, res.Status, msg)
	}
	var out response
	if err := json.Unmarshal(raw, &out); err != nil {
		return Answer{}, fmt.Errorf("gemini: the answer is not JSON: %w", err)
	}
	a := Answer{BlockReason: out.PromptFeedback.BlockReason, ModelVersion: out.ModelVersion}
	if len(out.Candidates) > 0 {
		c := out.Candidates[0]
		a.FinishReason, a.FinishMessage = c.FinishReason, c.FinishMessage
		var text strings.Builder
		for _, p := range c.Content.Parts {
			if !p.Thought {
				text.WriteString(p.Text)
			}
		}
		a.Text = text.String()
	}
	return a, nil
}
