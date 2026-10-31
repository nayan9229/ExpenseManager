package receiptstore

import (
	"context"
	"fmt"
	"slices"
	"sync"
)

// Fake is an in-memory Drive for tests. Exported fields are for assertions;
// the methods are the seam under test.
type Fake struct {
	mu      sync.Mutex
	Folders []FakeFolder
	Files   []FakeFile
	// Uploads records every resumable session opened, in order.
	Uploads []FakeUpload
	// Downloads records the ID of every file whose bytes were read.
	Downloads []string
	// Writes counts calls that changed something, so a test can prove an
	// idempotent handler wrote nothing the second time.
	Writes int
	// Err, when set, is returned by every call: a Google outage in one line.
	Err error
}

// FakeFolder is one folder the Fake knows about.
type FakeFolder struct {
	ID       string
	ParentID string
	Name     string
}

// FakeFile is one uploaded file.
type FakeFile struct {
	ID       string
	ParentID string
	Name     string
	MIMEType string
	Trashed  bool
	// Content is the file's bytes; Size, when zero, is len(Content).
	Content []byte
	Size    int64
}

// FakeUpload is a resumable session as the server opened it.
type FakeUpload struct {
	Upload
	SessionURI string
}

// NewFake returns an empty Drive.
func NewFake() *Fake { return &Fake{} }

// EnsureFolder implements Store.
func (f *Fake) EnsureFolder(_ context.Context, parentID, name string) (Folder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return Folder{}, f.Err
	}
	if found := f.find(parentID, name); found != nil {
		return Folder{ID: found.ID}, nil
	}
	folder := FakeFolder{ID: fmt.Sprintf("folder-%d", len(f.Folders)+1), ParentID: parentID, Name: name}
	f.Folders = append(f.Folders, folder)
	f.Writes++
	return Folder{ID: folder.ID, Created: true}, nil
}

// OpenUpload implements Store. The session URI is unique per call.
func (f *Fake) OpenUpload(_ context.Context, u Upload) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return "", f.Err
	}
	uri := fmt.Sprintf("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake-%d", len(f.Uploads)+1)
	f.Uploads = append(f.Uploads, FakeUpload{Upload: u, SessionURI: uri})
	return uri, nil
}

// Complete plays the browser's PUT to sessionURI: the file appears in the
// session's folder under its temporary name. It returns the new file.
func (f *Fake) Complete(sessionURI string) FakeFile {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.Uploads {
		if u.SessionURI == sessionURI {
			file := FakeFile{ID: fmt.Sprintf("file-%d", len(f.Files)+1), ParentID: u.FolderID, Name: u.Name, MIMEType: u.MIMEType}
			f.Files = append(f.Files, file)
			return file
		}
	}
	panic("receiptstore.Fake: no session " + sessionURI)
}

// AddFile puts a file anywhere, e.g. outside the Receipt Store.
func (f *Fake) AddFile(file FakeFile) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Files = append(f.Files, file)
}

// FileByID returns the stored file, or nil.
func (f *Fake) FileByID(id string) *FakeFile {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.Files {
		if f.Files[i].ID == id {
			c := f.Files[i]
			return &c
		}
	}
	return nil
}

// File implements Store; folders answer too, so a parent walk works.
func (f *Fake) File(_ context.Context, id string) (File, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return File{}, f.Err
	}
	for _, file := range f.Files {
		if file.ID == id {
			return fakeView(file), nil
		}
	}
	for _, folder := range f.Folders {
		if folder.ID == id {
			return File{ID: folder.ID, Name: folder.Name, MIMEType: "application/vnd.google-apps.folder", Parents: []string{folder.ParentID}}, nil
		}
	}
	return File{}, ErrNotFound
}

// Rename implements Store.
func (f *Fake) Rename(_ context.Context, r Rename) (File, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return File{}, f.Err
	}
	for i := range f.Files {
		if f.Files[i].ID != r.FileID {
			continue
		}
		file := &f.Files[i]
		file.Name = r.Name
		if r.AddParent != "" {
			if r.RemoveParent != file.ParentID {
				return File{}, fmt.Errorf("receiptstore.Fake: %s is not in %s", file.ID, r.RemoveParent)
			}
			file.ParentID = r.AddParent
		}
		f.Writes++
		return fakeView(*file), nil
	}
	return File{}, ErrNotFound
}

func fakeView(file FakeFile) File {
	size := file.Size
	if size == 0 {
		size = int64(len(file.Content))
	}
	return File{
		ID: file.ID, Name: file.Name, MIMEType: file.MIMEType, Parents: slices.Clip([]string{file.ParentID}),
		WebViewLink: "https://drive.google.com/file/d/" + file.ID + "/view?usp=drivesdk", Size: size, Trashed: file.Trashed,
	}
}

// Download implements Store.
func (f *Fake) Download(_ context.Context, id string, limit int64) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	for _, file := range f.Files {
		if file.ID != id {
			continue
		}
		f.Downloads = append(f.Downloads, id)
		if int64(len(file.Content)) > limit {
			return nil, ErrTooLarge
		}
		return slices.Clone(file.Content), nil
	}
	return nil, ErrNotFound
}

// Find returns the folder called name under parentID, or nil.
func (f *Fake) Find(parentID, name string) *FakeFolder {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.find(parentID, name)
}

func (f *Fake) find(parentID, name string) *FakeFolder {
	for i := range f.Folders {
		if f.Folders[i].ParentID == parentID && f.Folders[i].Name == name {
			return &f.Folders[i]
		}
	}
	return nil
}
