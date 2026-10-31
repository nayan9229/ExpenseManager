package ledger

import (
	"regexp"
	"strconv"
	"strings"
)

// The Admin edits the Ledger by hand (ADR-0001), so every parser here
// trims, normalises case, defaults what it can and skips only rows that
// have no identity. Nothing in this file returns an error.

// DefaultAvatarColor is Olive Sage, used when a row's colour is not #RRGGBB.
const DefaultAvatarColor = "#6E7250"

// DefaultEmoji stands in for a Category whose emoji cell is blank.
const DefaultEmoji = "📦"

var hexColour = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

// ParseMembers reads the Members tab. A row without a Member_ID is skipped;
// a blank Name becomes the ID, an unknown Role becomes `kid` (least
// privilege), an unknown Payment Method becomes UPI.
func ParseMembers(rows [][]string) []Member {
	members := []Member{}
	for _, row := range rows {
		row = padRow(row, len(Columns[Members]))
		id := strings.TrimSpace(row[0])
		if id == "" {
			continue
		}
		m := Member{
			MemberID:             id,
			Name:                 strings.TrimSpace(row[1]),
			Role:                 parseRole(row[2]),
			DefaultPaymentMethod: parsePaymentMethod(row[3]),
			PIN:                  strings.TrimSpace(row[4]),
			AvatarColor:          parseColour(row[5]),
		}
		if m.Name == "" {
			m.Name = id
		}
		members = append(members, m)
	}
	return members
}

// ParseCategories reads the Categories tab. A row without a name is skipped;
// a malformed Budget becomes 0 (no bar), blank roles become `all`.
func ParseCategories(rows [][]string) []Category {
	categories := []Category{}
	for _, row := range rows {
		row = padRow(row, len(Columns[Categories]))
		name := strings.TrimSpace(row[0])
		if name == "" {
			continue
		}
		c := Category{
			Name:           name,
			Emoji:          strings.TrimSpace(row[1]),
			ColorHex:       parseColour(row[2]),
			VisibleToRoles: parseRoles(row[4]),
		}
		if c.Emoji == "" {
			c.Emoji = DefaultEmoji
		}
		if budget, ok := parseNumber(row[3]); ok && budget > 0 {
			c.MonthlyBudgetLimit = budget
		}
		categories = append(categories, c)
	}
	return categories
}

// ParseRecurringRules reads the Recurring_Rules tab. A rule is an amount on
// a day of the month, so a row missing its ID, a numeric Amount or a
// Due_Day_Of_Month between 1 and 31 is skipped; a blank Title becomes the ID.
func ParseRecurringRules(rows [][]string) []RecurringRule {
	rules := []RecurringRule{}
	for _, row := range rows {
		row = padRow(row, len(Columns[RecurringRules]))
		id := strings.TrimSpace(row[0])
		if id == "" {
			continue
		}
		amount, ok := parseNumber(row[2])
		if !ok {
			continue
		}
		day, err := strconv.Atoi(strings.TrimSpace(row[4]))
		if err != nil || day < 1 || day > 31 {
			continue
		}
		r := RecurringRule{
			RuleID:        id,
			Title:         strings.TrimSpace(row[1]),
			Amount:        amount,
			Category:      strings.TrimSpace(row[3]),
			DueDayOfMonth: day,
		}
		if r.Title == "" {
			r.Title = id
		}
		rules = append(rules, r)
	}
	return rules
}

func parseRole(cell string) Role {
	switch Role(strings.ToLower(strings.TrimSpace(cell))) {
	case RoleAdmin:
		return RoleAdmin
	case RoleParent:
		return RoleParent
	default:
		return RoleKid
	}
}

// parseRoles reads Visible_To_Roles: `all`, or a comma-separated subset.
func parseRoles(cell string) []string {
	var roles []string
	for _, part := range strings.Split(cell, ",") {
		role := strings.ToLower(strings.TrimSpace(part))
		if role == "" {
			continue
		}
		if role == "all" {
			return []string{"all"}
		}
		roles = append(roles, role)
	}
	if len(roles) == 0 {
		return []string{"all"}
	}
	return roles
}

func parsePaymentMethod(cell string) PaymentMethod {
	key := normaliseKey(cell)
	for _, pm := range PaymentMethods {
		if normaliseKey(string(pm)) == key {
			return pm
		}
	}
	return UPI
}

func normaliseKey(s string) string {
	return strings.NewReplacer(" ", "", "_", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(s)))
}

func parseColour(cell string) string {
	cell = strings.TrimSpace(cell)
	if hexColour.MatchString(cell) {
		return cell
	}
	return DefaultAvatarColor
}

// parseNumber reads a rupee amount the way a human might have typed it:
// `1,500`, `₹2,000`, `1500.50`. Anything else is not a number.
func parseNumber(cell string) (float64, bool) {
	cleaned := strings.NewReplacer("₹", "", ",", "", " ", "", " ", "").Replace(strings.TrimSpace(cell))
	if cleaned == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
