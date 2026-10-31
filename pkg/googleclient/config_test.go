package googleclient_test

import (
	"strings"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/googleclient"
)

func setAll(t *testing.T) {
	t.Helper()
	t.Setenv("GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com")
	t.Setenv("GOOGLE_CLIENT_SECRET", "GOCSPX-secret")
	t.Setenv("GOOGLE_REFRESH_TOKEN", "1//0refresh")
	t.Setenv("GOOGLE_DRIVE_FOLDER_ID", "folder-123")
	t.Setenv("GOOGLE_SHEET_ID", "")
}

func TestConfigComesFromTheEnvironment(t *testing.T) {
	setAll(t)
	t.Setenv("GOOGLE_SHEET_ID", "sheet-9")

	cfg, err := googleclient.ConfigFromEnv()

	if err != nil {
		t.Fatal(err)
	}
	want := googleclient.Config{
		ClientID:      "id.apps.googleusercontent.com",
		ClientSecret:  "GOCSPX-secret",
		RefreshToken:  "1//0refresh",
		DriveFolderID: "folder-123",
		SheetID:       "sheet-9",
	}
	if cfg != want {
		t.Fatalf("config = %+v, want %+v", cfg, want)
	}
}

func TestTheSheetIDIsOptional(t *testing.T) {
	setAll(t)

	cfg, err := googleclient.ConfigFromEnv()

	if err != nil {
		t.Fatal(err)
	}
	if cfg.SheetID != "" {
		t.Fatalf("SheetID = %q, want blank", cfg.SheetID)
	}
}

func TestMissingVariablesAreNamed(t *testing.T) {
	setAll(t)
	t.Setenv("GOOGLE_REFRESH_TOKEN", "")
	t.Setenv("GOOGLE_DRIVE_FOLDER_ID", "  ")

	_, err := googleclient.ConfigFromEnv()

	if err == nil {
		t.Fatal("err = nil, want an error naming the missing variables")
	}
	for _, name := range []string{"GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_FOLDER_ID"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not name %s", err, name)
		}
	}
	if strings.Contains(err.Error(), "GOOGLE_CLIENT_ID") {
		t.Errorf("error %q names a variable that was set", err)
	}
}
