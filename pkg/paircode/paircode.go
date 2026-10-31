// Package paircode derives and verifies Pair Codes (GLOSSARY: Pair Token,
// Pair Code; spec "Sessions, pairing, trust").
//
// A Pair Code is eight base32 characters taken from
// HMAC-SHA256(server secret, "pair" + ten-minute bucket). Nothing is stored:
// Verify recomputes the code for the current and the previous bucket, so a
// code works for ten to twenty minutes and stops working everywhere the
// moment the secret is rotated. Codes are not single-use.
//
// The alphabet is Crockford's base32 (digits plus letters without I, L, O
// and U), so a code read off the Admin's screen has no 0/O or 1/I/L
// ambiguity; Normalise maps those look-alikes onto the digits anyway.
package paircode

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Alphabet is Crockford's base32: 0-9 and A-Z without I, L, O, U.
const Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Length is the number of characters in a Pair Code.
const Length = 8

// Bucket is how long one code is the current code.
const Bucket = 10 * time.Minute

// Minted is a code and the moment it stops being accepted.
type Minted struct {
	Code      string
	ExpiresAt time.Time
}

// Derive returns the current code. It is accepted until the end of the
// bucket after this one (Verify's previous-bucket grace).
func Derive(secret []byte, now time.Time) Minted {
	b := bucketOf(now)
	return Minted{
		Code:      codeFor(secret, b),
		ExpiresAt: time.Unix((b+2)*int64(Bucket/time.Second), 0).UTC(),
	}
}

// Verify reports whether input, however it was typed, is the code for the
// current or the previous bucket. Both comparisons always run, in constant
// time.
func Verify(secret []byte, input string, now time.Time) bool {
	got := []byte(Normalise(input))
	b := bucketOf(now)
	current := subtle.ConstantTimeCompare(got, []byte(codeFor(secret, b)))
	previous := subtle.ConstantTimeCompare(got, []byte(codeFor(secret, b-1)))
	return current|previous == 1
}

// Normalise turns what a person typed into the canonical code: upper case,
// no spaces or dashes, look-alike letters O, I and L mapped to 0 and 1.
func Normalise(input string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.Is(unicode.Pd, r) {
			return -1
		}
		switch r = unicode.ToUpper(r); r {
		case 'O':
			return '0'
		case 'I', 'L':
			return '1'
		}
		return r
	}, input)
}

func bucketOf(t time.Time) int64 {
	return t.Unix() / int64(Bucket/time.Second)
}

// codeFor encodes the first 40 bits of the HMAC as eight base32 characters.
func codeFor(secret []byte, bucket int64) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("pair" + strconv.FormatInt(bucket, 10)))
	sum := mac.Sum(nil)
	var bits uint64
	for _, b := range sum[:5] {
		bits = bits<<8 | uint64(b)
	}
	code := make([]byte, Length)
	for i := Length - 1; i >= 0; i-- {
		code[i] = Alphabet[bits&31]
		bits >>= 5
	}
	return string(code)
}
