package receiptstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"

	"github.com/nayan9229/ExpenseManager/pkg/googleclient"
)

// UploadEndpoint is Drive's media upload URL
// (docs/research/drive-resumable-upload-and-private-file-access.md, answer 1).
const UploadEndpoint = "https://www.googleapis.com/upload/drive/v3/files"

// fileFields is what File and Rename ask Drive for.
const fileFields = "id,name,mimeType,parents,webViewLink,size,trashed"

// Drive is the production Store, backed by the Drive v3 API.
type Drive struct {
	svc *drive.Service
	// http is the OAuth client behind svc; the resumable initiation is a raw
	// request because the Go client library would upload the bytes itself.
	http           *http.Client
	uploadEndpoint string
}

// NewDrive wraps an authenticated Drive service and the OAuth HTTP client
// it was built with.
func NewDrive(svc *drive.Service, client *http.Client) *Drive {
	return &Drive{svc: svc, http: client, uploadEndpoint: UploadEndpoint}
}

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

// OpenUpload implements Store: the initiation request of a resumable upload
// (POST ...?uploadType=resumable with the metadata), sent with the browser's
// Origin so Drive keys CORS to it. The answer's Location is the session URI.
func (d *Drive) OpenUpload(ctx context.Context, u Upload) (string, error) {
	meta, err := json.Marshal(map[string]any{"name": u.Name, "mimeType": u.MIMEType, "parents": []string{u.FolderID}})
	if err != nil {
		return "", err
	}
	q := url.Values{}
	q.Set("uploadType", "resumable")
	q.Set("supportsAllDrives", "true")
	// Shapes the final PUT's body so the browser can read the new file's id
	// (research answer 3: inferred, the documented default includes id anyway).
	q.Set("fields", "id,name,mimeType")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.uploadEndpoint+"?"+q.Encode(), bytes.NewReader(meta))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("X-Upload-Content-Type", u.MIMEType)
	req.Header.Set("X-Upload-Content-Length", strconv.FormatInt(u.Size, 10))
	if u.Origin != "" {
		req.Header.Set("Origin", u.Origin)
	}
	res, err := d.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("drive: open upload session: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return "", fmt.Errorf("drive: open upload session: %s: %s", res.Status, bytes.TrimSpace(body))
	}
	location := res.Header.Get("Location")
	if location == "" {
		return "", errors.New("drive: open upload session: no Location in the answer")
	}
	return location, nil
}

// File implements Store.
func (d *Drive) File(ctx context.Context, id string) (File, error) {
	f, err := d.svc.Files.Get(id).Fields(fileFields).SupportsAllDrives(true).Context(ctx).Do()
	if err != nil {
		return File{}, driveError("get "+id, err)
	}
	return viewOf(f), nil
}

// Rename implements Store. A move uses addParents/removeParents, never the
// body's parents (research answer 6).
func (d *Drive) Rename(ctx context.Context, r Rename) (File, error) {
	call := d.svc.Files.Update(r.FileID, &drive.File{Name: r.Name}).Fields(fileFields).SupportsAllDrives(true)
	if r.AddParent != "" {
		call = call.AddParents(r.AddParent).RemoveParents(r.RemoveParent)
	}
	f, err := call.Context(ctx).Do()
	if err != nil {
		return File{}, driveError("rename "+r.FileID, err)
	}
	return viewOf(f), nil
}

// Download implements Store: `files.get?alt=media` through the client
// library, which follows Drive's redirect to the content.
func (d *Drive) Download(ctx context.Context, id string) (io.ReadCloser, error) {
	res, err := d.svc.Files.Get(id).SupportsAllDrives(true).Context(ctx).Download()
	if err != nil {
		return nil, driveError("download "+id, err)
	}
	return res.Body, nil
}

func viewOf(f *drive.File) File {
	return File{
		ID: f.Id, Name: f.Name, MIMEType: f.MimeType, Parents: f.Parents,
		WebViewLink: f.WebViewLink, Size: f.Size, Trashed: f.Trashed,
	}
}

func driveError(what string, err error) error {
	var gerr *googleapi.Error
	if errors.As(err, &gerr) && gerr.Code == http.StatusNotFound {
		return fmt.Errorf("drive: %s: %w", what, ErrNotFound)
	}
	return fmt.Errorf("drive: %s: %w", what, err)
}
