// Package expenses implements the `expenses` function (spec "Expense API
// contract"): GET is the read model every device loads after pairing, POST
// creates an Expense. Members arrive with a `pinHash` and never the PIN
// (ADR-0002): the client verifies a typed PIN against
// SHA-256("<memberId>:<pin>") offline.
//
// PUT edits an Expense in place and DELETE marks it deleted (Soft Delete).
// Whether the acting Member may edit it is the client's call (ADR-0002).
package expenses

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/deps"
	"github.com/nayan9229/ExpenseManager/pkg/endpoint"
	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/ledger"
	"github.com/nayan9229/ExpenseManager/pkg/receiptstore"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// Service is the function with its Ledger and Receipt Store injected.
type Service struct {
	Ledger ledger.Ledger
	// Store and FolderID are the Receipt Store a create's Drive_File_ID must
	// point into (FolderID is GOOGLE_DRIVE_FOLDER_ID).
	Store    receiptstore.Store
	FolderID string
	// Now is the server clock; nil means time.Now. Tests pin it.
	Now func() time.Time
}

func (s Service) now() time.Time {
	if s.Now == nil {
		return time.Now()
	}
	return s.Now()
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
	// Expenses are the active Expenses in the window, newest Expense_Date
	// first (then newest Created_At).
	Expenses       []Expense       `json:"expenses"`
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

// function is the `expenses` function's name and methods.
var function = endpoint.Function{Name: "expenses", Methods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete}}

// Handler is the production entry point: the Session and the method are
// checked first, then the Ledger is built from the environment for this one
// request.
func Handler(w http.ResponseWriter, r *http.Request) {
	function.Production(func(r *http.Request) (http.HandlerFunc, error) {
		d, err := deps.FromEnv(r.Context())
		if err != nil {
			return nil, err
		}
		return Service{Ledger: d.Ledger, Store: d.Store, FolderID: d.FolderID}.serve, nil
	})(w, r)
}

func (s Service) serve(w http.ResponseWriter, r *http.Request) {
	if function.RejectMethod(w, r) {
		return
	}
	switch r.Method {
	case http.MethodPost:
		s.create(w, r)
	case http.MethodPut:
		s.update(w, r)
	case http.MethodDelete:
		s.remove(w, r)
	default:
		s.read(w, r)
	}
}

func (s Service) read(w http.ResponseWriter, r *http.Request) {
	now := s.now()
	from, to, err := window(r.URL.Query().Get("from"), r.URL.Query().Get("to"), now)
	if err != nil {
		httpjson.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	snap, err := s.Ledger.Read(r.Context(), ledger.Expenses, ledger.Members, ledger.Categories, ledger.RecurringRules)
	if err != nil {
		writeLedgerError(w, err)
		return
	}
	model := ReadModel{
		Expenses:       []Expense{},
		Members:        []Member{},
		Categories:     []Category{},
		RecurringRules: []RecurringRule{},
		LedgerURL:      snap.URL,
		ServerTime:     now.In(ledger.IST).Format(time.RFC3339),
	}
	for _, e := range inWindow(ledger.ParseExpenses(snap.Rows[ledger.Expenses]), from, to) {
		model.Expenses = append(model.Expenses, viewOf(e))
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
