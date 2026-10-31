// Package receiptstore is the ReceiptStore seam: the Drive folder tree that
// holds Receipts (GLOSSARY: Receipt Store; spec "Testing Decisions"). Drive is
// the production implementation; Fake is what handler tests inject.
//
// Bootstrap needs only the find-or-create of the `Receipts` folder. The
// `upload-url` and `receipt` functions extend this interface with month
// folders, upload sessions, renames and downloads (tickets 06 and 07).
package receiptstore

import "context"

// Store is what the handlers talk to.
type Store interface {
	// EnsureFolder finds the folder called name directly under parentID and
	// creates it when absent. Names are not unique in Drive, so the oldest
	// match wins and a second call never creates a duplicate.
	EnsureFolder(ctx context.Context, parentID, name string) (Folder, error)
}

// Folder is the result of EnsureFolder.
type Folder struct {
	ID string
	// Created is true when this call made the folder, false when it was found.
	Created bool
}
