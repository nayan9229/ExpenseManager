package receiptstore

import (
	"context"
	"fmt"
	"sync"
)

// Fake is an in-memory Drive for tests. Exported fields are for assertions;
// the methods are the seam under test.
type Fake struct {
	mu      sync.Mutex
	Folders []FakeFolder
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
