package ocr

import (
	"context"
	"sync"
)

// Fake is a scripted model for tests: it answers every Read with Answer
// (or Err) and records what it was sent.
type Fake struct {
	mu     sync.Mutex
	Answer Answer
	Err    error
	// Seen holds every Receipt sent, in order.
	Seen []Receipt
}

// NewFake returns a model that answers nothing until Answer is set.
func NewFake() *Fake { return &Fake{} }

// Read implements OCR.
func (f *Fake) Read(_ context.Context, r Receipt) (Answer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Seen = append(f.Seen, r)
	if f.Err != nil {
		return Answer{}, f.Err
	}
	return f.Answer, nil
}
