// Package deps is the composition root for the Google-backed functions: it
// turns the environment into the production Ledger and ReceiptStore seams.
// Handlers call FromEnv once per request after the Session check, so a
// missing variable becomes a 500 SERVER_MISCONFIGURED, never a panic.
package deps

import (
	"context"

	"github.com/nayan9229/ExpenseManager/pkg/googleclient"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
)

// Deps are the seams a handler needs plus the folder they live in.
type Deps struct {
	Store  receiptstore.Store
	Ledger ledger.Ledger
	// FolderID is the Household's Drive folder (GOOGLE_DRIVE_FOLDER_ID).
	FolderID string
}

// FromEnv builds the production seams. The error names every missing
// GOOGLE_* variable.
func FromEnv(ctx context.Context) (Deps, error) {
	cfg, err := googleclient.ConfigFromEnv()
	if err != nil {
		return Deps{}, err
	}
	svc, err := googleclient.NewServices(ctx, cfg)
	if err != nil {
		return Deps{}, err
	}
	return Deps{
		Store:    receiptstore.NewDrive(svc.Drive),
		Ledger:   ledger.NewSheets(svc.Sheets, svc.Drive, cfg.DriveFolderID, cfg.SheetID),
		FolderID: cfg.DriveFolderID,
	}, nil
}
