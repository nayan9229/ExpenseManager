// Package expenses implements the `expenses` function: the read model every
// device loads after pairing (spec "Expense API contract", Read). Members
// arrive with a `pinHash` and never the PIN (ADR-0002): the client verifies
// a typed PIN against SHA-256("<memberId>:<pin>") offline.
//
// GET is all this ticket needs. Create, Update and Delete (POST, PUT,
// DELETE on the same path) arrive with ticket 04, as does reading the
// Expenses tab for the date window; until then `expenses` is always empty.
package expenses

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// Service is the function with its Ledger injected.
type Service struct {
	Ledger ledger.Ledger
}

// Member is a Members row as the client sees it.
type Member struct {
	MemberID             string               `json:"memberId"`
	Name                 string               `json:"name"`
	Role                 ledger.Role          `json:"role"`
	DefaultPaymentMethod ledger.PaymentMethod `json:"defaultPaymentMethod"`
	// PinHash is hex SHA-256 of "<memberId>:<pin>", or null when no PIN is set.
	PinHash     *string `json:"pinHash"`
	AvatarColor string  `json:"avatarColor"`
}

// Category is a Categories row as the client sees it.
type Category struct {
	Name               string   `json:"name"`
	Emoji              string   `json:"emoji"`
	ColorHex           string   `json:"colorHex"`
	MonthlyBudgetLimit float64  `json:"monthlyBudgetLimit"`
	VisibleToRoles     []string `json:"visibleToRoles"`
}

// RecurringRule is a Recurring_Rules row as the client sees it.
type RecurringRule struct {
	RuleID        string  `json:"ruleId"`
	Title         string  `json:"title"`
	Amount        float64 `json:"amount"`
	Category      string  `json:"category"`
	DueDayOfMonth int     `json:"dueDayOfMonth"`
}

// ReadModel is the GET response.
type ReadModel struct {
	// Expenses is empty until ticket 04 reads the date window; the typed
	// Expense view replaces `any` then.
	Expenses       []any           `json:"expenses"`
	Members        []Member        `json:"members"`
	Categories     []Category      `json:"categories"`
	RecurringRules []RecurringRule `json:"recurringRules"`
	LedgerURL      string          `json:"ledgerUrl"`
	// ServerTime is RFC 3339 in IST, the Household's clock.
	ServerTime string `json:"serverTime"`
}

// Handler is the guarded function: a valid Session first, then the work.
func (s Service) Handler() http.HandlerFunc {
	return session.Require(s.serve)
}

// Handler is the production entry point: the Session is checked first, then
// the Ledger is built from the environment for this one request.
func Handler(w http.ResponseWriter, r *http.Request) {
	session.Require(func(w http.ResponseWriter, r *http.Request) {
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
			return
		}
		Service{Ledger: d.Ledger}.serve(w, r)
	})(w, r)
}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.read(w, r)
	default:
		w.Header().Set("Allow", "GET")
		httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "expenses accepts GET only for now")
	}
}

func (s Service) read(w http.ResponseWriter, r *http.Request) {
	snap, err := s.Ledger.Read(r.Context(), ledger.Members, ledger.Categories, ledger.RecurringRules)
	if err != nil {
		if errors.Is(err, ledger.ErrNotFound) {
			httpjson.WriteError(w, http.StatusNotFound, "LEDGER_NOT_FOUND", "The Ledger is missing; run Bootstrap")
			return
		}
		httpjson.WriteError(w, http.StatusBadGateway, "GOOGLE_ERROR", err.Error())
		return
	}
	model := ReadModel{
		Expenses:       []any{},
		Members:        []Member{},
		Categories:     []Category{},
		RecurringRules: []RecurringRule{},
		LedgerURL:      snap.URL,
		ServerTime:     time.Now().In(ledger.IST).Format(time.RFC3339),
	}
	for _, m := range ledger.ParseMembers(snap.Rows[ledger.Members]) {
		model.Members = append(model.Members, Member{
			MemberID:             m.MemberID,
			Name:                 m.Name,
			Role:                 m.Role,
			DefaultPaymentMethod: m.DefaultPaymentMethod,
			PinHash:              pinHash(m.MemberID, m.PIN),
			AvatarColor:          m.AvatarColor,
		})
	}
	for _, c := range ledger.ParseCategories(snap.Rows[ledger.Categories]) {
		model.Categories = append(model.Categories, Category(c))
	}
	for _, rule := range ledger.ParseRecurringRules(snap.Rows[ledger.RecurringRules]) {
		model.RecurringRules = append(model.RecurringRules, RecurringRule(rule))
	}
	httpjson.Write(w, http.StatusOK, model)
}

// pinHash is what the client compares a typed PIN against; nil when no PIN
// is set so the client knows not to ask.
func pinHash(memberID, pin string) *string {
	if pin == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(memberID + ":" + pin))
	h := hex.EncodeToString(sum[:])
	return &h
}
