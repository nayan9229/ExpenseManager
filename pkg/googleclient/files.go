package googleclient

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/api/drive/v3"
)

// Drive MIME types for the two kinds of child Bootstrap creates.
const (
	FolderMIME      = "application/vnd.google-apps.folder"
	SpreadsheetMIME = "application/vnd.google-apps.spreadsheet"
)

// FindChild returns the ID of the oldest non-trashed file called name with
// the given MIME type directly under parentID, or "" when there is none
// (https://developers.google.com/workspace/drive/api/guides/search-files).
func FindChild(ctx context.Context, svc *drive.Service, parentID, name, mimeType string) (string, error) {
	q := fmt.Sprintf("name = '%s' and mimeType = '%s' and '%s' in parents and trashed = false",
		escapeQuery(name), mimeType, escapeQuery(parentID))
	list, err := svc.Files.List().
		Q(q).
		Spaces("drive").
		Fields("files(id,name,createdTime)").
		OrderBy("createdTime").
		PageSize(10).
		SupportsAllDrives(true).
		IncludeItemsFromAllDrives(true).
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("drive: list %q under %s: %w", name, parentID, err)
	}
	if len(list.Files) == 0 {
		return "", nil
	}
	return list.Files[0].Id, nil
}

// CreateChild creates an empty file (a folder or a Google-native document,
// by MIME type) called name under parentID and returns its ID.
func CreateChild(ctx context.Context, svc *drive.Service, parentID, name, mimeType string) (string, error) {
	file, err := svc.Files.Create(&drive.File{Name: name, MimeType: mimeType, Parents: []string{parentID}}).
		Fields("id").
		SupportsAllDrives(true).
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("drive: create %q under %s: %w", name, parentID, err)
	}
	return file.Id, nil
}

// escapeQuery makes a value safe inside single quotes in a Drive `q` string.
func escapeQuery(v string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(v)
}
