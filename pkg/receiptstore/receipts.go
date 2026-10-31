package receiptstore

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// ReceiptsFolderName is the top of the Receipt Store tree inside the
// Household's Drive folder.
const ReceiptsFolderName = "Receipts"

// MonthFolder is a `Receipts/YYYY/MM-Month` folder.
type MonthFolder struct {
	ID string
	// Path is human-readable, e.g. "Receipts/2026/10-October".
	Path string
}

// MonthFolderName is the folder a date's Receipts live in, e.g. "10-October".
func MonthFolderName(date time.Time) string {
	return fmt.Sprintf("%02d-%s", int(date.Month()), date.Month())
}

// EnsureMonthFolder finds or creates `Receipts/YYYY/MM-Month` for date under
// the Household folder rootID (spec "Bootstrap": month folders are lazy).
func EnsureMonthFolder(ctx context.Context, s Store, rootID string, date time.Time) (MonthFolder, error) {
	path := []string{ReceiptsFolderName, strconv.Itoa(date.Year()), MonthFolderName(date)}
	parent := rootID
	for _, name := range path {
		folder, err := s.EnsureFolder(ctx, parent, name)
		if err != nil {
			return MonthFolder{}, err
		}
		parent = folder.ID
	}
	return MonthFolder{ID: parent, Path: strings.Join(path, "/")}, nil
}

// ErrNotAReceipt means a file exists but is not inside the Receipt Store
// (or is in the trash), so an Expense must not point at it.
var ErrNotAReceipt = errors.New("receiptstore: the file is not in the Receipt Store")

var (
	yearName  = regexp.MustCompile(`^\d{4}$`)
	monthName = regexp.MustCompile(`^(0[1-9]|1[0-2])-[A-Z][a-z]+$`)
)

// Locate returns a file that sits in a `Receipts/YYYY/MM-Month` folder of
// the Household folder rootID: the file's parent, grandparent and great-
// grandparent are walked and checked by name, and the last must sit
// directly in rootID. ErrNotFound for an unknown ID, ErrNotAReceipt for a
// file anywhere else.
func Locate(ctx context.Context, s Store, rootID, fileID string) (File, error) {
	file, err := s.File(ctx, fileID)
	if err != nil {
		return File{}, err
	}
	if file.Trashed || strings.HasPrefix(file.MIMEType, "application/vnd.google-apps.") {
		return File{}, ErrNotAReceipt
	}
	current := file
	for _, want := range []func(string) bool{monthName.MatchString, yearName.MatchString, func(n string) bool { return n == ReceiptsFolderName }} {
		if len(current.Parents) != 1 {
			return File{}, ErrNotAReceipt
		}
		parent, err := s.File(ctx, current.Parents[0])
		if errors.Is(err, ErrNotFound) {
			return File{}, ErrNotAReceipt
		}
		if err != nil {
			return File{}, err
		}
		if parent.Trashed || !want(parent.Name) {
			return File{}, ErrNotAReceipt
		}
		current = parent
	}
	if len(current.Parents) != 1 || current.Parents[0] != rootID {
		return File{}, ErrNotAReceipt
	}
	return file, nil
}

// SlugMax is the longest a name part may be (spec "Receipt pipeline", step 7).
const SlugMax = 20

// Slug makes s safe and short for a Drive file name: ASCII letters and
// digits only, every other run of characters becomes one hyphen, at most
// SlugMax characters, no hyphen at either end. "" when nothing survives.
func Slug(s string) string {
	var b strings.Builder
	hyphen := false
	for _, r := range s {
		if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			if hyphen && b.Len() > 0 {
				b.WriteByte('-')
			}
			hyphen = false
			b.WriteRune(r)
			continue
		}
		hyphen = true
	}
	out := b.String()
	if len(out) > SlugMax {
		out = strings.TrimRight(out[:SlugMax], "-")
	}
	return out
}

// FinalName is a Receipt's name once its Expense is saved:
// `YYYY-MM-DD_<Category>_<Merchant>_<Amount>.<ext>`, each text part a Slug.
// A blank merchant part is left out rather than leaving `__` in the name.
func FinalName(expenseDate, category, merchant string, amount float64, ext string) string {
	parts := []string{expenseDate}
	for _, p := range []string{Slug(category), Slug(merchant)} {
		if p != "" {
			parts = append(parts, p)
		}
	}
	parts = append(parts, formatAmount(amount))
	name := strings.Join(parts, "_")
	if ext != "" {
		name += "." + ext
	}
	return name
}

// formatAmount is whole rupees without decimals, otherwise two decimals.
func formatAmount(amount float64) string {
	if amount == float64(int64(amount)) {
		return strconv.FormatInt(int64(amount), 10)
	}
	return strconv.FormatFloat(amount, 'f', 2, 64)
}

// Extension is the file name extension to keep: the one on the current
// (temporary) name, else one derived from the MIME type.
func Extension(name, mimeType string) string {
	if i := strings.LastIndexByte(name, '.'); i >= 0 && i < len(name)-1 {
		ext := strings.ToLower(name[i+1:])
		if Slug(ext) == ext && len(ext) <= 5 {
			return ext
		}
	}
	return extensionFor[mimeType]
}

// extensionFor maps the MIME types a Receipt may have to their extension.
var extensionFor = map[string]string{
	"image/jpeg":      "jpg",
	"image/png":       "png",
	"image/webp":      "webp",
	"application/pdf": "pdf",
}

// ExtensionFor reports the extension for a Receipt MIME type and whether
// the type is one the Receipt Store takes (photos the app shrank, PDFs).
func ExtensionFor(mimeType string) (string, bool) {
	ext, ok := extensionFor[mimeType]
	return ext, ok
}
