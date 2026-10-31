// Package endpoint is the production wrapper every guarded Vercel function
// shares: the Session first (session.Require), then the method (405 with an
// `Allow` header), then the function's seams built from the environment
// (500 SERVER_MISCONFIGURED on a missing variable), then the work.
//
// The method is checked before the environment is read, so a wrong method
// is never mistaken for a misconfigured server.
package endpoint

import (
	"net/http"
	"slices"
	"strings"

	"github.com/nayan9229/ExpenseManager/pkg/httpjson"
	"github.com/nayan9229/ExpenseManager/pkg/session"
)

// Function names a function and the methods it serves.
type Function struct {
	// Name is the function's route name (`expenses`, `upload-url`), used in
	// the 405 message.
	Name string
	// Methods are the methods served, in the order the `Allow` header lists them.
	Methods []string
}

// RejectMethod answers 405 METHOD_NOT_ALLOWED for a method f does not serve
// and reports whether it did.
func (f Function) RejectMethod(w http.ResponseWriter, r *http.Request) bool {
	if slices.Contains(f.Methods, r.Method) {
		return false
	}
	w.Header().Set("Allow", strings.Join(f.Methods, ", "))
	httpjson.WriteError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", f.Name+" accepts "+methodList(f.Methods))
	return true
}

// methodList is "POST only" for one method, "GET, POST and PUT" for several.
func methodList(methods []string) string {
	if len(methods) == 1 {
		return methods[0] + " only"
	}
	return strings.Join(methods[:len(methods)-1], ", ") + " and " + methods[len(methods)-1]
}

// Production is the entry point a function's package exports: Session,
// method, then build reads the environment and returns the handler that
// does the work for this one request.
func (f Function) Production(build func(r *http.Request) (http.HandlerFunc, error)) http.HandlerFunc {
	return session.Require(func(w http.ResponseWriter, r *http.Request) {
		if f.RejectMethod(w, r) {
			return
		}
		serve, err := build(r)
		if err != nil {
			httpjson.WriteError(w, http.StatusInternalServerError, "SERVER_MISCONFIGURED", err.Error())
			return
		}
		serve(w, r)
	})
}
