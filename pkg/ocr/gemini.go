package ocr

import (
	"context"
	"errors"
	"os"
	"strings"
)

// DefaultModel is used when GEMINI_MODEL is blank (spec "OCR"; research
// answer 1: 2.5 Flash is gated to projects that used it before).
const DefaultModel = "gemini-3.5-flash-lite"

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

// Gemini is the production OCR.
type Gemini struct{ cfg Config }

// NewGemini returns the REST adapter.
func NewGemini(cfg Config) *Gemini { return &Gemini{cfg: cfg} }

// Read implements OCR.
func (g *Gemini) Read(ctx context.Context, r Receipt) (Answer, error) {
	return Answer{}, errors.New("not yet")
}
