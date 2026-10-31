package ledger

import (
	"strconv"
	"strings"
)

// Role is a Member's permission tier (GLOSSARY: Role).
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleParent Role = "parent"
	RoleKid    Role = "kid"
)

// PaymentMethod is how an Expense was paid (GLOSSARY: Payment Method).
type PaymentMethod string

const (
	UPI          PaymentMethod = "UPI"
	Cash         PaymentMethod = "Cash"
	Card         PaymentMethod = "Card"
	BankTransfer PaymentMethod = "Bank Transfer"
)

// PaymentMethods lists the enum in display order.
var PaymentMethods = []PaymentMethod{UPI, Cash, Card, BankTransfer}

// ParsePaymentMethod reads a Payment Method sent by the app: it must be one
// of PaymentMethods spelled exactly. (A cell the Admin typed by hand is read
// leniently by the row parsers instead.)
func ParsePaymentMethod(s string) (PaymentMethod, bool) {
	for _, pm := range PaymentMethods {
		if string(pm) == s {
			return pm, true
		}
	}
	return "", false
}

// Member is one row of the Members tab. PIN is the raw cell and must never
// leave the server; the `expenses` function hashes it.
type Member struct {
	MemberID             string
	Name                 string
	Role                 Role
	DefaultPaymentMethod PaymentMethod
	PIN                  string
	AvatarColor          string
}

// Row maps the Member onto the Members column order.
func (m Member) Row() []string {
	return []string{m.MemberID, m.Name, string(m.Role), string(m.DefaultPaymentMethod), m.PIN, m.AvatarColor}
}

// Category is one row of the Categories tab.
type Category struct {
	Name               string
	Emoji              string
	ColorHex           string
	MonthlyBudgetLimit float64
	// VisibleToRoles is `all` or a subset of the roles.
	VisibleToRoles []string
}

// Row maps the Category onto the Categories column order.
func (c Category) Row() []string {
	return []string{c.Name, c.Emoji, c.ColorHex, formatAmount(c.MonthlyBudgetLimit), joinRoles(c.VisibleToRoles)}
}

// CategoryNames lists the Categories' names in Ledger order.
func CategoryNames(categories []Category) []string {
	var names []string
	for _, c := range categories {
		names = append(names, c.Name)
	}
	return names
}

// FindCategory matches name against the Category names the way a human
// would (case and surrounding spaces ignored) and returns the Ledger's
// spelling. A blank name is no Category.
func FindCategory(names []string, name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", false
	}
	for _, c := range names {
		if strings.EqualFold(c, name) {
			return c, true
		}
	}
	return "", false
}

// RecurringRule is one row of the Recurring_Rules tab.
type RecurringRule struct {
	RuleID        string
	Title         string
	Amount        float64
	Category      string
	DueDayOfMonth int
}

// Row maps the rule onto the Recurring_Rules column order.
func (r RecurringRule) Row() []string {
	return []string{r.RuleID, r.Title, formatAmount(r.Amount), r.Category, strconv.Itoa(r.DueDayOfMonth)}
}

// formatAmount writes a rupee amount the way the Admin would type it: no
// exponent, no trailing zeros, at most two decimals.
func formatAmount(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func joinRoles(roles []string) string {
	out := ""
	for i, r := range roles {
		if i > 0 {
			out += ","
		}
		out += r
	}
	return out
}
