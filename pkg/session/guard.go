package session

import (
	"context"
	"net/http"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
)

// Require wraps a function's handler so it only runs for a paired device.
// Every function except `pair` wraps itself in it, and it runs before
// anything else (in particular before any Google call), answering
// 401 NOT_PAIRED without a valid Session. The verified Claims are put in the
// request context for FromContext. Production handlers reach it through
// endpoint.Function.Production; the Service.Handler test seams call it
// directly.
func Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secret, err := SecretFromEnv()
		if err != nil {
			httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
			return
		}
		claims, err := FromRequest(r, secret, time.Now())
		if err != nil {
			httpjson.WriteError(w, http.StatusUnauthorized, "NOT_PAIRED", "This device is not paired with the Household")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	}
}

type claimsKey struct{}

// FromContext returns the Session that Require verified for this request.
func FromContext(ctx context.Context) (Claims, bool) {
	claims, ok := ctx.Value(claimsKey{}).(Claims)
	return claims, ok
}
