package ocr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/ledger"
)

// Categories are the seven Categories Bootstrap seeds (spec "Bootstrap"),
// the enum the model picks from. A Household that renamed its Categories
// gets no Category match on the phone, and the field is highlighted.
var Categories = []string{
	"Groceries & Vegetables",
	"Medical & Pharmacy",
	"Utilities & Bills",
	"School & Kids",
	"Household & Help",
	"Dining & Outings",
	"Other",
}

// PaymentMethods is the Payment Method enum (spec "Ledger schema").
var PaymentMethods = func() []string {
	out := make([]string, len(ledger.PaymentMethods))
	for i, m := range ledger.PaymentMethods {
		out[i] = string(m)
	}
	return out
}()

// Result is what the `ocr` function answers: the fields that prefill the
// form. A null means the Receipt did not show it.
type Result struct {
	Merchant      *string  `json:"merchant"`
	ExpenseDate   *string  `json:"expenseDate"`
	TotalAmount   *float64 `json:"totalAmount"`
	TaxAmount     *float64 `json:"taxAmount"`
	Currency      *string  `json:"currency"`
	Category      string   `json:"category"`
	PaymentMethod *string  `json:"paymentMethod"`
	// Confidence is the model's own 0..1 estimate per prefilled field; the
	// phone highlights anything under 0.6.
	Confidence      Confidence `json:"confidence"`
	LineItemSummary string     `json:"lineItemSummary"`
	// Model is the model that answered, for the Admin's curiosity.
	Model string `json:"model"`
}

// Confidence is per field so the phone can highlight just the doubtful ones.
type Confidence struct {
	Merchant      float64 `json:"merchant"`
	ExpenseDate   float64 `json:"expenseDate"`
	TotalAmount   float64 `json:"totalAmount"`
	Category      float64 `json:"category"`
	PaymentMethod float64 `json:"paymentMethod"`
}

// fields is the property order: the schema's propertyOrdering and the keys
// Validate demands.
var fields = []string{"merchant", "expenseDate", "totalAmount", "taxAmount", "currency", "category", "paymentMethod", "confidence", "lineItemSummary"}

var confidenceFields = []string{"merchant", "expenseDate", "totalAmount", "category", "paymentMethod"}

// ResponseSchema is generationConfig.responseSchema: the OpenAPI-subset
// Schema object of the REST reference (docs/research/gemini-structured-ocr.md,
// answer 2). Every key is required and the unknowns are nullable, so the
// model always writes every key and says null rather than guessing.
func ResponseSchema() map[string]any {
	nullableString := func(desc string) map[string]any {
		return map[string]any{"type": "STRING", "nullable": true, "description": desc}
	}
	confidence := map[string]any{}
	for _, f := range confidenceFields {
		confidence[f] = map[string]any{"type": "NUMBER", "minimum": 0, "maximum": 1}
	}
	return map[string]any{
		"type": "OBJECT",
		"properties": map[string]any{
			"merchant":    nullableString("Shop or biller name as printed"),
			"expenseDate": map[string]any{"type": "STRING", "nullable": true, "description": "Purchase or bill date as YYYY-MM-DD"},
			"totalAmount": map[string]any{"type": "NUMBER", "nullable": true, "minimum": 0, "description": "Grand total actually paid, in the receipt currency"},
			"taxAmount":   map[string]any{"type": "NUMBER", "nullable": true, "minimum": 0, "description": "Total tax (GST etc.) included in the total"},
			"currency":    map[string]any{"type": "STRING", "nullable": true, "description": "ISO 4217 code, e.g. INR"},
			"category":    map[string]any{"type": "STRING", "format": "enum", "enum": Categories},
			"paymentMethod": map[string]any{
				"type": "STRING", "format": "enum", "nullable": true, "enum": PaymentMethods,
				"description": "How it was paid, only if the receipt says so",
			},
			"confidence": map[string]any{
				"type": "OBJECT", "properties": confidence, "required": confidenceFields, "propertyOrdering": confidenceFields,
				"description": "Your confidence from 0 to 1 in each field",
			},
			"lineItemSummary": map[string]any{"type": "STRING", "description": "What was bought, in at most five words"},
		},
		"required":         fields,
		"propertyOrdering": fields,
	}
}

// Prompt is the instruction sent with every Receipt.
const Prompt = "This is a receipt, bill or invoice from India. Read it and fill every field of the schema. " +
	"Use null for anything the receipt does not show; do not guess. totalAmount is the final amount paid. " +
	"Pick the closest category; use Other when none fits. " +
	"paymentMethod is UPI for UPI, GPay, PhonePe, Paytm or a VPA; Card for credit or debit cards; Cash; or Bank Transfer for NEFT, IMPS or RTGS."

// Rejected is a model answer the phone cannot use: the handler's 422.
type Rejected struct {
	// Code is OCR_BLOCKED (the model did not finish) or OCR_INVALID (the
	// JSON broke the schema).
	Code    string
	Message string
}

func (r *Rejected) Error() string { return r.Code + ": " + r.Message }

func invalid(format string, args ...any) *Rejected {
	return &Rejected{Code: "OCR_INVALID", Message: "The receipt could not be read: " + fmt.Sprintf(format, args...)}
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)

// Validate gates on the finish reason and checks the JSON against the
// schema in Go: the API promises syntactically valid JSON, not values that
// keep to the schema (research answer 5). Anything else is a *Rejected.
func Validate(a Answer) (Result, error) {
	if a.BlockReason != "" {
		return Result{}, &Rejected{Code: "OCR_BLOCKED", Message: "Gemini refused to read this receipt (" + a.BlockReason + ")"}
	}
	if a.FinishReason != "STOP" {
		reason := a.FinishReason
		if reason == "" {
			reason = "no answer"
		}
		msg := "Gemini did not finish reading this receipt (" + reason + ")"
		if a.FinishMessage != "" {
			msg += ": " + a.FinishMessage
		}
		return Result{}, &Rejected{Code: "OCR_BLOCKED", Message: msg}
	}

	raw, err := object(a.Text, fields, "the answer")
	if err != nil {
		return Result{}, err
	}
	var r Result
	if r.Merchant, err = optionalString(raw, "merchant"); err != nil {
		return Result{}, err
	}
	if r.ExpenseDate, err = optionalString(raw, "expenseDate"); err != nil {
		return Result{}, err
	}
	if r.ExpenseDate != nil {
		if _, perr := time.Parse(ledger.DateLayout, *r.ExpenseDate); !isoDate.MatchString(*r.ExpenseDate) || perr != nil {
			return Result{}, invalid("expenseDate %q is not a YYYY-MM-DD date", *r.ExpenseDate)
		}
	}
	if r.TotalAmount, err = optionalAmount(raw, "totalAmount"); err != nil {
		return Result{}, err
	}
	if r.TaxAmount, err = optionalAmount(raw, "taxAmount"); err != nil {
		return Result{}, err
	}
	if r.Currency, err = optionalString(raw, "currency"); err != nil {
		return Result{}, err
	}
	if r.Currency != nil && !currencyCode.MatchString(*r.Currency) {
		return Result{}, invalid("currency %q is not an ISO 4217 code", *r.Currency)
	}
	category, err := optionalString(raw, "category")
	if err != nil {
		return Result{}, err
	}
	if category == nil || !slices.Contains(Categories, *category) {
		return Result{}, invalid("category %s is not one of the seven", show(raw["category"]))
	}
	r.Category = *category
	if r.PaymentMethod, err = optionalString(raw, "paymentMethod"); err != nil {
		return Result{}, err
	}
	if r.PaymentMethod != nil && !slices.Contains(PaymentMethods, *r.PaymentMethod) {
		return Result{}, invalid("paymentMethod %q is not one of %s", *r.PaymentMethod, strings.Join(PaymentMethods, ", "))
	}
	if r.Confidence, err = confidenceOf(raw["confidence"]); err != nil {
		return Result{}, err
	}
	summary, err := optionalString(raw, "lineItemSummary")
	if err != nil {
		return Result{}, err
	}
	if summary == nil {
		return Result{}, invalid("lineItemSummary is null")
	}
	r.LineItemSummary = *summary
	r.Model = a.ModelVersion
	return r, nil
}

// object decodes one JSON object with exactly the keys want: a missing key
// or one the schema does not have is a violation.
func object(text string, want []string, what string) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(strings.NewReader(text))
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil || raw == nil {
		return nil, invalid("%s is not a JSON object", what)
	}
	if dec.More() {
		return nil, invalid("%s has text after the JSON object", what)
	}
	var missing, extra []string
	for _, k := range want {
		if _, ok := raw[k]; !ok {
			missing = append(missing, k)
		}
	}
	for k := range raw {
		if !slices.Contains(want, k) {
			extra = append(extra, k)
		}
	}
	sort.Strings(extra)
	if len(missing) > 0 {
		return nil, invalid("%s is missing %s", what, strings.Join(missing, ", "))
	}
	if len(extra) > 0 {
		return nil, invalid("%s has unexpected %s", what, strings.Join(extra, ", "))
	}
	return raw, nil
}

func isNull(v json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(v), []byte("null")) }

func show(v json.RawMessage) string { return string(bytes.TrimSpace(v)) }

func optionalString(raw map[string]json.RawMessage, key string) (*string, error) {
	if isNull(raw[key]) {
		return nil, nil
	}
	var s string
	if err := json.Unmarshal(raw[key], &s); err != nil {
		return nil, invalid("%s is %s, not a string", key, show(raw[key]))
	}
	s = strings.TrimSpace(s)
	return &s, nil
}

func optionalAmount(raw map[string]json.RawMessage, key string) (*float64, error) {
	if isNull(raw[key]) {
		return nil, nil
	}
	var n float64
	if err := json.Unmarshal(raw[key], &n); err != nil {
		return nil, invalid("%s is %s, not a number", key, show(raw[key]))
	}
	if n < 0 || math.IsInf(n, 0) || math.IsNaN(n) {
		return nil, invalid("%s %v is negative", key, n)
	}
	return &n, nil
}

func confidenceOf(v json.RawMessage) (Confidence, error) {
	raw, err := object(string(v), confidenceFields, "confidence")
	if err != nil {
		return Confidence{}, err
	}
	var out [5]float64
	for i, k := range confidenceFields {
		var n float64
		if err := json.Unmarshal(raw[k], &n); err != nil || n < 0 || n > 1 {
			return Confidence{}, invalid("confidence.%s is %s, not a number from 0 to 1", k, show(raw[k]))
		}
		out[i] = n
	}
	return Confidence{Merchant: out[0], ExpenseDate: out[1], TotalAmount: out[2], Category: out[3], PaymentMethod: out[4]}, nil
}
