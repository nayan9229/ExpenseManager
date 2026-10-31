package expenses

import (
	"errors"
	"sort"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// DefaultWindowDays is how far back the read model reaches without `from`.
const DefaultWindowDays = 90

// window resolves the GET's `from` / `to` (YYYY-MM-DD, inclusive) against
// the IST clock. The default is 90 days back to tomorrow: tomorrow because
// a create accepts a date one day ahead, and the Member must see it.
func window(fromParam, toParam string, now time.Time) (from, to string, err error) {
	today := now.In(ledger.IST)
	from = today.AddDate(0, 0, -DefaultWindowDays).Format(ledger.DateLayout)
	to = today.AddDate(0, 0, 1).Format(ledger.DateLayout)
	if fromParam != "" {
		if from, err = dateParam(fromParam); err != nil {
			return "", "", err
		}
	}
	if toParam != "" {
		if to, err = dateParam(toParam); err != nil {
			return "", "", err
		}
	}
	if from > to {
		return "", "", errors.New("from must not be after to")
	}
	return from, to, nil
}

func dateParam(s string) (string, error) {
	t, err := time.Parse(ledger.DateLayout, s)
	if err != nil {
		return "", errors.New("from and to must be dates as YYYY-MM-DD")
	}
	return t.Format(ledger.DateLayout), nil
}

// inWindow keeps the active Expenses dated from..to (inclusive; YYYY-MM-DD
// strings compare in date order) and sorts them newest first.
func inWindow(all []ledger.Expense, from, to string) []ledger.Expense {
	return newestFirst(all, func(e ledger.Expense) bool {
		return e.Status == ledger.StatusActive && e.ExpenseDate >= from && e.ExpenseDate <= to
	})
}

// pendingReimbursements keeps every active Expense whose Reimbursement is
// pending, whatever its date, newest first.
func pendingReimbursements(all []ledger.Expense) []ledger.Expense {
	return newestFirst(all, func(e ledger.Expense) bool {
		return e.Status == ledger.StatusActive && e.Reimbursement == ledger.ReimbursementPending
	})
}

func newestFirst(all []ledger.Expense, keep func(ledger.Expense) bool) []ledger.Expense {
	kept := []ledger.Expense{}
	for _, e := range all {
		if keep(e) {
			kept = append(kept, e)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool {
		if kept[i].ExpenseDate != kept[j].ExpenseDate {
			return kept[i].ExpenseDate > kept[j].ExpenseDate
		}
		return kept[i].CreatedAt > kept[j].CreatedAt
	})
	return kept
}
