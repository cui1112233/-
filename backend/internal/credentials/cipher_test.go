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
		t.Fatal("NewFromBase64() failed")
	}

	plaintext := "sk-yadi-secret"
	ciphertext, err := cipher.Encrypt(plaintext)
	if err != nil {
		t.Fatal("Encrypt() failed")
	}
	if !strings.HasPrefix(ciphertext, "v1:") {
		t.Fatal("Encrypt() did not return a versioned ciphertext")
	}
	if strings.Contains(ciphertext, plaintext) {
		t.Fatalf("Encrypt() leaked plaintext in ciphertext")
	}

	decrypted, err := cipher.Decrypt(ciphertext)
	if err != nil {
		t.Fatal("Decrypt() failed")
	}
	if decrypted != plaintext {
		t.Fatal("Decrypt() did not round trip")
	}
}

func TestCipherUsesRandomNonce(t *testing.T) {
	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatal("NewFromBase64() failed")
	}

	first, err := cipher.Encrypt("same-secret")
	if err != nil {
		t.Fatal("first Encrypt() failed")
	}
	second, err := cipher.Encrypt("same-secret")
	if err != nil {
		t.Fatal("second Encrypt() failed")
	}
	if first == second {
		t.Fatal("Encrypt() produced identical ciphertexts for the same plaintext")
	}
}

func TestCipherRejectsInvalidKeysAndCiphertextsWithoutLeakingPlaintext(t *testing.T) {
	for _, encodedKey := range []string{"not-base64", base64.StdEncoding.EncodeToString([]byte("too-short"))} {
		if _, err := credentials.NewFromBase64(encodedKey); err == nil {
			t.Fatal("NewFromBase64() accepted an invalid key")
		}
	}

	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatal("NewFromBase64() failed")
	}
	plaintext := "sk-yadi-secret"
	ciphertext, err := cipher.Encrypt(plaintext)
	if err != nil {
		t.Fatal("Encrypt() failed")
	}
	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, "v1:"))
	if err != nil {
		t.Fatal("DecodeString() failed")
	}
	payload[len(payload)-1] ^= 1
	tampered := "v1:" + base64.StdEncoding.EncodeToString(payload)

	for _, value := range []string{"v2:payload", "v1:not-base64", tampered} {
		decrypted, err := cipher.Decrypt(value)
		if err == nil || decrypted != "" {
			t.Fatal("Decrypt() accepted invalid ciphertext")
		}
		if strings.Contains(err.Error(), plaintext) {
			t.Fatal("Decrypt() leaked plaintext in an error")
		}
	}
}

func TestCipherRejectsShortVersionedPayloadWithoutLeakingPlaintext(t *testing.T) {
	cipher, err := credentials.NewFromBase64(testKey())
	if err != nil {
		t.Fatal("NewFromBase64() failed")
	}

	plaintext := "sk-yadi-secret"
	shortVersionedPayload := "v1:" + base64.StdEncoding.EncodeToString([]byte("short"))
	decrypted, err := cipher.Decrypt(shortVersionedPayload)
	if err == nil || decrypted != "" {
		t.Fatal("Decrypt() accepted a short versioned payload")
	}
	if strings.Contains(err.Error(), plaintext) {
		t.Fatal("Decrypt() leaked plaintext in an error")
	}
}

func testKey() string {
	return base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}
