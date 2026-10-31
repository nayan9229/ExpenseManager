// Package ocr is the OCR seam (GLOSSARY: OCR; spec "OCR"): it reads a
// Receipt's bytes with the Gemini API and hands back the fields that
// prefill the Expense form. Gemini is the production implementation; Fake
// is what handler tests inject.
//
// The seam is deliberately thin: it carries the model's raw answer (text
// and finish reason). Turning that answer into a Result, and refusing
// anything that breaks the schema, is Validate's job in this package, so
// the handler tests exercise every rule against the dumb fake.
//
// The package also holds the `ocr` function's handler (handler.go).
package ocr

import "context"

// OCR is what the handler talks to.
type OCR interface {
	// Read sends one Receipt to the model with the response schema
	// (schema.go) and returns its answer unchecked. An error means the call
	// itself failed (network, HTTP status, unreadable envelope).
	Read(ctx context.Context, r Receipt) (Answer, error)
}

// Receipt is the file the model reads.
type Receipt struct {
	Bytes    []byte
	MIMEType string
}

// Answer is the model's reply, before validation.
type Answer struct {
	// FinishReason is candidates[0].finishReason; only "STOP" is a
	// complete answer.
	FinishReason string
	// FinishMessage is candidates[0].finishMessage, when the model gave one.
	FinishMessage string
	// BlockReason is promptFeedback.blockReason: the prompt was refused and
	// no candidate came back.
	BlockReason string
	// Text is the JSON document the model wrote.
	Text string
	// ModelVersion is the model that answered.
	ModelVersion string
}
