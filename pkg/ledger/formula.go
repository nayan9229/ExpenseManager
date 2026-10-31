package ledger

import "strings"

// Formula injection guard. The Sheets adapter writes with USER_ENTERED so
// `450` lands as a number and a date can be a date, but USER_ENTERED also
// turns any cell starting with `=` (and, in Sheets, `+`, `-` or `@`) into a
// formula: a Merchant_Note of `=HYPERLINK(...)` or `=IMPORTXML(...)` would run
// in the Admin's spreadsheet. escapeText prefixes such a cell with an
// apostrophe, which Sheets treats as "this is text" and does not store; the
// cell then reads back as the literal string.

// formulaLeads are the first characters that make Sheets (or a CSV export
// opened in a desktop spreadsheet) treat a cell as a formula (OWASP CSV
// injection list).
const formulaLeads = "=+-@\t\r"

// escapeText makes cell safe to send with USER_ENTERED. Plain numbers such
// as `-5` or `+5` are left alone so they stay numbers.
func escapeText(cell string) string {
	if cell == "" || !strings.ContainsRune(formulaLeads, rune(cell[0])) {
		return cell
	}
	if _, ok := parseNumber(cell); ok && !strings.ContainsAny(cell, "₹, ") {
		return cell
	}
	return "'" + cell
}

// unescapeText undoes an apostrophe that survived into the stored value (a
// cell the Admin pasted, or a text-formatted cell that kept the prefix), so
// the app shows what the Member typed.
func unescapeText(cell string) string {
	if len(cell) >= 2 && cell[0] == '\'' && strings.ContainsRune(formulaLeads, rune(cell[1])) {
		return cell[1:]
	}
	return cell
}
