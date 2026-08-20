package credentials_test

import (
	"encoding/base64"
	"strings"
	"testing"

	"qiantie/backend/internal/credentials"
)

func TestCipherRoundTripUsesVersionedCiphertext(t *testing.T) {
	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatalf("NewFromBase64() error = %v", err)
	}

	plaintext := "sk-yadi-secret"
	ciphertext, err := cipher.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	if !strings.HasPrefix(ciphertext, "v1:") {
		t.Fatalf("Encrypt() = %q, want v1: prefix", ciphertext)
	}
	if strings.Contains(ciphertext, plaintext) {
		t.Fatalf("Encrypt() leaked plaintext in ciphertext")
	}

	decrypted, err := cipher.Decrypt(ciphertext)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("Decrypt() = %q, want %q", decrypted, plaintext)
	}
}

func TestCipherUsesRandomNonce(t *testing.T) {
	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatalf("NewFromBase64() error = %v", err)
	}

	first, err := cipher.Encrypt("same-secret")
	if err != nil {
		t.Fatalf("first Encrypt() error = %v", err)
	}
	second, err := cipher.Encrypt("same-secret")
	if err != nil {
		t.Fatalf("second Encrypt() error = %v", err)
	}
	if first == second {
		t.Fatal("Encrypt() produced identical ciphertexts for the same plaintext")
	}
}

func TestCipherRejectsInvalidKeysAndCiphertextsWithoutLeakingPlaintext(t *testing.T) {
	for _, encodedKey := range []string{"not-base64", base64.StdEncoding.EncodeToString([]byte("too-short"))} {
		if _, err := credentials.NewFromBase64(encodedKey); err == nil {
			t.Fatalf("NewFromBase64(%q) succeeded, want error", encodedKey)
		}
	}

	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatalf("NewFromBase64() error = %v", err)
	}
	plaintext := "sk-yadi-secret"
	ciphertext, err := cipher.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, "v1:"))
	if err != nil {
		t.Fatalf("DecodeString() error = %v", err)
	}
	payload[len(payload)-1] ^= 1
	tampered := "v1:" + base64.StdEncoding.EncodeToString(payload)

	for _, value := range []string{"v2:payload", "v1:not-base64", tampered} {
		decrypted, err := cipher.Decrypt(value)
		if err == nil || decrypted != "" {
			t.Fatalf("Decrypt(%q) = %q, %v; want generic failure", value, decrypted, err)
		}
		if strings.Contains(err.Error(), plaintext) {
			t.Fatalf("Decrypt() leaked plaintext in error %q", err)
		}
	}
}

func testKey() string {
	return base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}
