package receiptstore

import (
	"context"

	"google.golang.org/api/drive/v3"

	"github.com/nayan9229/ExpenseManager/pkg/googleclient"
)

// Drive is the production Store, backed by the Drive v3 API.
type Drive struct {
	svc *drive.Service
}

// NewDrive wraps an authenticated Drive service.
func NewDrive(svc *drive.Service) *Drive { return &Drive{svc: svc} }

// EnsureFolder implements Store.
func (d *Drive) EnsureFolder(ctx context.Context, parentID, name string) (Folder, error) {
	id, err := googleclient.FindChild(ctx, d.svc, parentID, name, googleclient.FolderMIME)
	if err != nil {
		return Folder{}, err
	}
	if id != "" {
		return Folder{ID: id}, nil
	}
	id, err = googleclient.CreateChild(ctx, d.svc, parentID, name, googleclient.FolderMIME)
	if err != nil {
		return Folder{}, err
	}
	return Folder{ID: id, Created: true}, nil
}
