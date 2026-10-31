// Package googleclient turns the Admin's OAuth refresh token into Drive v3
// and Sheets v4 services (spec: "Architecture", Google access). It knows
// nothing about the Ledger or the Receipt Store; those seams live in
// pkg/ledger and pkg/receiptstore and take the services this package builds.
package googleclient

import (
	"errors"
	"os"
	"strings"
)

// Config is everything the deployment needs to reach the Admin's Google
// account and the one Drive folder the Household lives in.
type Config struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
	// DriveFolderID is the folder that holds the Ledger and the Receipt Store.
	DriveFolderID string
	// SheetID is optional: blank means "find or create Expenses_Database in
	// DriveFolderID".
	SheetID string
}

// ConfigFromEnv reads the GOOGLE_* variables (.env.example). The error names
// every required variable that is blank, so a half-configured deployment is
// diagnosed in one round.
func ConfigFromEnv() (Config, error) {
	get := func(name string) string { return strings.TrimSpace(os.Getenv(name)) }
	cfg := Config{
		ClientID:      get("GOOGLE_CLIENT_ID"),
		ClientSecret:  get("GOOGLE_CLIENT_SECRET"),
		RefreshToken:  get("GOOGLE_REFRESH_TOKEN"),
		DriveFolderID: get("GOOGLE_DRIVE_FOLDER_ID"),
		SheetID:       get("GOOGLE_SHEET_ID"),
	}
	var missing []string
	for _, v := range []struct{ name, value string }{
		{"GOOGLE_CLIENT_ID", cfg.ClientID},
		{"GOOGLE_CLIENT_SECRET", cfg.ClientSecret},
		{"GOOGLE_REFRESH_TOKEN", cfg.RefreshToken},
		{"GOOGLE_DRIVE_FOLDER_ID", cfg.DriveFolderID},
	} {
		if v.value == "" {
			missing = append(missing, v.name)
		}
	}
	if len(missing) > 0 {
		return Config{}, errors.New("googleclient: missing " + strings.Join(missing, ", "))
	}
	return cfg, nil
}
