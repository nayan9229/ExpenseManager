package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"time"
)

// CookieName is the cookie a paired device carries on every request.
const CookieName = "fem_session"

// Lifetime is how long a Session lasts: one year, below Chrome's 400-day cap
// and exempt from iOS ITP's 7-day cap because the server sets it httpOnly
// (https://webkit.org/blog/8613/intelligent-tracking-prevention-2-1/).
const Lifetime = 365 * 24 * time.Hour

// ErrNoSecret means JWT_SECRET is unset or too short to sign anything.
var ErrNoSecret = errors.New("session: JWT_SECRET must be set to at least 32 characters")

// SecretFromEnv reads the signing secret the deployment was configured with.
func SecretFromEnv() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return nil, ErrNoSecret
	}
	return []byte(secret), nil
}

// Issue mints a Session for a newly paired device and sets it as the cookie.
// The deviceId is random; nothing else about the device is recorded.
func Issue(w http.ResponseWriter, secret []byte, now time.Time) (Claims, error) {
	claims := Claims{
		DeviceID:  newDeviceID(),
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(Lifetime).Unix(),
	}
	token, err := Sign(secret, claims)
	if err != nil {
		return Claims{}, err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(Lifetime / time.Second),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	return claims, nil
}

// FromRequest returns the valid Session the request carries, or ErrInvalid /
// ErrExpired when it carries none, a bad one, or a stale one.
func FromRequest(r *http.Request, secret []byte, now time.Time) (Claims, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return Claims{}, ErrInvalid
	}
	return Verify(secret, cookie.Value, now)
}

func newDeviceID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("session: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}
