// Package session mints and checks the Session a paired device holds
// (GLOSSARY: Session, Pairing; ADR-0002).
//
// A Session is an HMAC-SHA256 JWT carrying only `deviceId`, `iat` and `exp`.
// It proves a device was paired with the Household; it never names a Member.
// The standard library is enough for HS256, so there is no JWT dependency.
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Claims is the JWT payload. Times are Unix seconds, as the JWT spec wants.
type Claims struct {
	DeviceID  string `json:"deviceId"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

var (
	// ErrInvalid covers every token that is malformed, tampered with, or
	// signed with a different secret. Callers must not distinguish further.
	ErrInvalid = errors.New("session: invalid token")
	// ErrExpired means the signature is good but `exp` has passed.
	ErrExpired = errors.New("session: token expired")
)

// header is the one JWT header this package ever emits or accepts.
const header = `{"alg":"HS256","typ":"JWT"}`

var b64 = base64.RawURLEncoding

// Sign serialises claims into a compact JWT signed with secret.
func Sign(secret []byte, claims Claims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signingInput := b64.EncodeToString([]byte(header)) + "." + b64.EncodeToString(payload)
	return signingInput + "." + b64.EncodeToString(mac(secret, signingInput)), nil
}

// Verify checks token's signature with secret and that it has not expired
// at now. It returns ErrInvalid or ErrExpired, never the claims of a bad token.
func Verify(secret []byte, token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalid
	}
	// Pin the header: a token asking for another algorithm is not ours.
	if rawHeader, err := b64.DecodeString(parts[0]); err != nil || string(rawHeader) != header {
		return Claims{}, ErrInvalid
	}
	signature, err := b64.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	if !hmac.Equal(signature, mac(secret, parts[0]+"."+parts[1])) {
		return Claims{}, ErrInvalid
	}
	payload, err := b64.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalid
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalid
	}
	if claims.ExpiresAt == 0 || !now.Before(time.Unix(claims.ExpiresAt, 0)) {
		return Claims{}, ErrExpired
	}
	return claims, nil
}

func mac(secret []byte, signingInput string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(signingInput))
	return h.Sum(nil)
}
