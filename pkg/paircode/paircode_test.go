package paircode_test

import (
	"strings"
	"testing"
	"time"

	"github.com/nayan9229/ExpenseManager/pkg/paircode"
)

var secret = []byte("test-secret-at-least-32-characters-long")

// noon is the start of a ten-minute bucket, so the arithmetic below is exact.
var noon = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

func TestACodeIsEightCharactersFromTheAlphabet(t *testing.T) {
	code := paircode.Derive(secret, noon).Code

	if len(code) != 8 {
		t.Fatalf("code %q has %d characters, want 8", code, len(code))
	}
	for _, c := range code {
		if !strings.ContainsRune(paircode.Alphabet, c) {
			t.Fatalf("code %q contains %q, outside %q", code, c, paircode.Alphabet)
		}
	}
}

func TestTheCodeIsStableWithinABucketAndChangesWithTheNext(t *testing.T) {
	first := paircode.Derive(secret, noon)
	later := paircode.Derive(secret, noon.Add(9*time.Minute+59*time.Second))
	next := paircode.Derive(secret, noon.Add(10*time.Minute))

	if first.Code != later.Code {
		t.Fatalf("code changed inside one bucket: %q then %q", first.Code, later.Code)
	}
	if first.Code == next.Code {
		t.Fatalf("code %q did not change in the next bucket", first.Code)
	}
}

func TestTheCodeExpiresAtTheEndOfTheFollowingBucket(t *testing.T) {
	got := paircode.Derive(secret, noon.Add(3*time.Minute)).ExpiresAt

	want := noon.Add(20 * time.Minute)
	if !got.Equal(want) {
		t.Fatalf("ExpiresAt = %v, want %v (current bucket plus the previous-bucket grace)", got, want)
	}
}

func TestVerifyAcceptsTheCurrentCode(t *testing.T) {
	code := paircode.Derive(secret, noon).Code

	if !paircode.Verify(secret, code, noon.Add(5*time.Minute)) {
		t.Fatalf("current code %q refused", code)
	}
}

func TestVerifyAcceptsThePreviousBucketsCode(t *testing.T) {
	code := paircode.Derive(secret, noon).Code

	if !paircode.Verify(secret, code, noon.Add(19*time.Minute+59*time.Second)) {
		t.Fatalf("previous-bucket code %q refused", code)
	}
}

func TestVerifyRefusesAStaleCode(t *testing.T) {
	code := paircode.Derive(secret, noon).Code

	if paircode.Verify(secret, code, noon.Add(20*time.Minute)) {
		t.Fatalf("code %q from two buckets ago accepted", code)
	}
}

func TestVerifyRefusesACodeFromAnotherSecret(t *testing.T) {
	code := paircode.Derive([]byte("a-different-secret-of-32-characters!!"), noon).Code

	if paircode.Verify(secret, code, noon) {
		t.Fatalf("code %q minted with another secret accepted (rotation must cut it off)", code)
	}
}

func TestVerifyRefusesJunk(t *testing.T) {
	for _, input := range []string{"", "ABCD", "ABCD-EFGH-JKMN", "!!!!!!!!"} {
		if paircode.Verify(secret, input, noon) {
			t.Fatalf("junk %q accepted", input)
		}
	}
}

func TestVerifyForgivesHowTheCodeWasTyped(t *testing.T) {
	code := paircode.Derive(secret, noon).Code
	typed := strings.ToLower(code[:4]) + " - " + strings.ToLower(code[4:])

	if !paircode.Verify(secret, typed, noon) {
		t.Fatalf("%q (lower case, dash, spaces) refused for %q", typed, code)
	}
}

func TestNormalise(t *testing.T) {
	cases := []struct{ in, want string }{
		{"abcd-efgh", "ABCDEFGH"},
		{" ab cd\tef-gh ", "ABCDEFGH"},
		// Look-alikes map onto the digits the alphabet keeps.
		{"oO0-iIlL1", "00011111"},
		{"ABCD–EFGH", "ABCDEFGH"}, // en dash from a phone keyboard
	}
	for _, c := range cases {
		if got := paircode.Normalise(c.in); got != c.want {
			t.Errorf("Normalise(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTheAlphabetAvoidsLookAlikes(t *testing.T) {
	if len(paircode.Alphabet) != 32 {
		t.Fatalf("alphabet has %d symbols, want 32", len(paircode.Alphabet))
	}
	for _, c := range "ILOU" {
		if strings.ContainsRune(paircode.Alphabet, c) {
			t.Errorf("alphabet contains look-alike %q", c)
		}
	}
}
