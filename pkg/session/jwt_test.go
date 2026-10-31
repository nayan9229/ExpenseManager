package session_test

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/session"
)

var (
	secret    = []byte("test-secret-at-least-32-characters-long")
	issuedAt  = time.Date(2026, 10, 31, 9, 0, 0, 0, time.UTC)
	expiresAt = issuedAt.Add(365 * 24 * time.Hour)
)

func TestASignedSessionVerifiesWithTheSameSecret(t *testing.T) {
	token, err := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix()})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	claims, err := session.Verify(secret, token, issuedAt.Add(time.Hour))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.DeviceID != "dev-123" {
		t.Fatalf("deviceId = %q, want dev-123", claims.DeviceID)
	}
	if claims.IssuedAt != issuedAt.Unix() || claims.ExpiresAt != expiresAt.Unix() {
		t.Fatalf("claims = %+v, want iat %d exp %d", claims, issuedAt.Unix(), expiresAt.Unix())
	}
}

func TestAnExpiredSessionIsRejected(t *testing.T) {
	token, err := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix()})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	_, err = session.Verify(secret, token, expiresAt.Add(time.Second))
	if !errors.Is(err, session.ErrExpired) {
		t.Fatalf("Verify after exp: err = %v, want ErrExpired", err)
	}
}

func TestATamperedPayloadIsRejected(t *testing.T) {
	token, err := session.Sign(secret, session.Claims{DeviceID: "dev-123", IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix()})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	// Swap the payload for one naming another device; keep the signature.
	parts := strings.Split(token, ".")
	forged, _ := json.Marshal(session.Claims{DeviceID: "dev-999", IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix()})
	parts[1] = base64.RawURLEncoding.EncodeToString(forged)

	_, err = session.Verify(secret, strings.Join(parts, "."), issuedAt.Add(time.Hour))
	if !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("Verify tampered: err = %v, want ErrInvalid", err)
	}
}

func TestASessionSignedWithAnotherSecretIsRejected(t *testing.T) {
	token, err := session.Sign([]byte("the-previous-secret-before-rotation"), session.Claims{DeviceID: "dev-123", IssuedAt: issuedAt.Unix(), ExpiresAt: expiresAt.Unix()})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	_, err = session.Verify(secret, token, issuedAt.Add(time.Hour))
	if !errors.Is(err, session.ErrInvalid) {
		t.Fatalf("Verify with rotated secret: err = %v, want ErrInvalid", err)
	}
}

func TestGarbageIsRejected(t *testing.T) {
	for _, token := range []string{"", "not.a.jwt", "a.b", "a.b.c.d"} {
		if _, err := session.Verify(secret, token, issuedAt); !errors.Is(err, session.ErrInvalid) {
			t.Errorf("Verify(%q): err = %v, want ErrInvalid", token, err)
		}
	}
}
