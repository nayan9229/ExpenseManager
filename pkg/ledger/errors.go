package ledger

import "errors"

// ErrNotFound means the Ledger spreadsheet (or one of its tabs) does not
// exist yet: Bootstrap has not run against this folder.
var ErrNotFound = errors.New("ledger: not found; run Bootstrap")
