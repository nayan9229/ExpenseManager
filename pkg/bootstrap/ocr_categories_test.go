package bootstrap

import (
	"slices"
	"testing"

	"github.com/nayan9229/ExpenseManager/pkg/ocr"
)

// The OCR schema's Category enum is "the seven" (spec "OCR"): the seeds.
func TestOCRPicksFromTheSeededCategories(t *testing.T) {
	var seeded []string
	for _, c := range seedCategories {
		seeded = append(seeded, c.Name)
	}
	if !slices.Equal(seeded, ocr.Categories) {
		t.Errorf("ocr.Categories = %q, want the seeds %q", ocr.Categories, seeded)
	}
}
