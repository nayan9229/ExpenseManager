// Package receiptstore is the ReceiptStore seam: the Drive folder tree that
// holds Receipts (GLOSSARY: Receipt Store; spec "Testing Decisions"). Drive is
// the production implementation; Fake is what handler tests inject.
//
// The interface is a handful of Drive primitives. The Receipt Store's own
// rules (the `Receipts/YYYY/MM-Month` layout, "is this file a Receipt", the
// final file name) live in receipts.go on top of them, so the fake stays
// dumb and every rule is exercised against it.
package receiptstore

import (
	"context"
	"errors"
)

// Store is what the handlers talk to.
type Store interface {
	// EnsureFolder finds the folder called name directly under parentID and
	// creates it when absent. Names are not unique in Drive, so the oldest
	// match wins and a second call never creates a duplicate.
	EnsureFolder(ctx context.Context, parentID, name string) (Folder, error)

	// OpenUpload starts a Drive resumable upload session for one file and
	// returns the session URI the browser PUTs the bytes to. The URI is a
	// bearer secret (anyone holding it can upload): never log it.
	OpenUpload(ctx context.Context, u Upload) (sessionURI string, err error)

	// File returns a file's (or folder's) metadata. ErrNotFound when Drive
	// does not know the ID or the token cannot see it.
	File(ctx context.Context, id string) (File, error)

	// Rename gives a file its final name and, when AddParent is set, moves
	// it from RemoveParent into AddParent in the same call.
	Rename(ctx context.Context, r Rename) (File, error)

	// Download reads a file's bytes (`files.get?alt=media`) with the
	// server's token. More than limit bytes is ErrTooLarge, so a caller
	// never holds more than it can send on; ErrNotFound for an unknown ID.
	Download(ctx context.Context, id string, limit int64) ([]byte, error)
}

// ErrTooLarge is returned by Download when a file has more bytes than the
// caller's limit.
var ErrTooLarge = errors.New("receiptstore: the file is larger than the limit")

// ErrNotFound is returned by File and Rename for an unknown file ID.
var ErrNotFound = errors.New("receiptstore: file not found")

// Folder is the result of EnsureFolder.
type Folder struct {
	ID string
	// Created is true when this call made the folder, false when it was found.
	Created bool
}

// Upload describes the file a resumable session is opened for.
type Upload struct {
	// FolderID is the month folder the file lands in.
	FolderID string
	// Name is the temporary `<Expense ID>.<ext>` name.
	Name     string
	MIMEType string
	// Size is the byte length the browser will PUT.
	Size int64
	// Origin is the browser's Origin, forwarded so Drive answers the
	// cross-origin PUT with CORS headers.
	Origin string
}

// File is the metadata the handlers need.
type File struct {
	ID       string
	Name     string
	MIMEType string
	// Parents holds the one parent folder ID (Drive allows one).
	Parents []string
	// WebViewLink opens the file in Drive's own viewer (needs a Google
	// login with access: the Admin's way out for oversize Receipts).
	WebViewLink string
	// ThumbnailLink is Drive's short-lived generated thumbnail; it needs a
	// credentialed fetch and is blank until Drive has made one.
	ThumbnailLink string
	Size          int64
	Trashed       bool
}

// Rename is a name change, optionally with a move.
type Rename struct {
	FileID string
	Name   string
	// AddParent and RemoveParent move the file; both blank means stay put.
	AddParent    string
	RemoveParent string
}
