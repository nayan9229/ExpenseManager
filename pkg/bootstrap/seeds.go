package bootstrap

import "github.com/nayan9229/ExpenseManager/pkg/ledger"

// Palette colours (spec: "Design system"); the same six the app's CSS tokens
// define. Seeds only ever use these.
const (
	oliveSage  = "#6E7250"
	terracotta = "#A9603F"
	brass      = "#A98545"
	mocha      = "#4A3728"
	sand       = "#D8C9AE"
)

// seedCategories are the seven Categories a fresh Household starts with
// (spec: "Bootstrap"). Budget 0 means no Burn Rate bar until the Admin sets one.
var seedCategories = []ledger.Category{
	{Name: "Groceries & Vegetables", Emoji: "🥬", ColorHex: oliveSage},
	{Name: "Medical & Pharmacy", Emoji: "💊", ColorHex: terracotta},
	{Name: "Utilities & Bills", Emoji: "💡", ColorHex: brass},
	{Name: "School & Kids", Emoji: "🎒", ColorHex: mocha},
	{Name: "Household & Help", Emoji: "🧹", ColorHex: sand},
	{Name: "Dining & Outings", Emoji: "🍽️", ColorHex: terracotta},
	{Name: "Other", Emoji: "📦", ColorHex: oliveSage},
}

// seedAdmin is the one Member every Household starts with. The PIN is blank
// on purpose: the Admin sets it in the Ledger, and the app says so until then.
var seedAdmin = ledger.Member{
	MemberID:             "admin",
	Name:                 "Admin",
	Role:                 ledger.RoleAdmin,
	DefaultPaymentMethod: ledger.UPI,
	AvatarColor:          oliveSage,
}

// seedRows returns the rows to write into a tab that is empty. Tabs without
// seeds (Expenses, Recurring_Rules) return nil.
func seedRows(tab ledger.Tab) [][]string {
	switch tab {
	case ledger.Categories:
		rows := make([][]string, 0, len(seedCategories))
		for _, c := range seedCategories {
			c.VisibleToRoles = []string{"all"}
			rows = append(rows, c.Row())
		}
		return rows
	case ledger.Members:
		return [][]string{seedAdmin.Row()}
	default:
		return nil
	}
}
