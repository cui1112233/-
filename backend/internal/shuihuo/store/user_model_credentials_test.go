package store

import "testing"

func TestUserModelCredentialEncryptionRoundTrip(t *testing.T) {
	key := userCredentialTestKey("primary-secret")
	ciphertext, err := encryptUserCredential(key, "sk-yadi-private-value")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "sk-yadi-private-value" || len(ciphertext) <= len(userCredentialCipherPrefix) {
		t.Fatalf("credential was not encrypted: %q", ciphertext)
	}
	plaintext, err := decryptUserCredential(key, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "sk-yadi-private-value" {
		t.Fatalf("unexpected plaintext: %q", plaintext)
	}
}

func TestUserModelCredentialWrongKeyFails(t *testing.T) {
	ciphertext, err := encryptUserCredential(userCredentialTestKey("first"), "sk-yadi-private-value")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decryptUserCredential(userCredentialTestKey("second"), ciphertext); err == nil {
		t.Fatal("expected decryption with a different key to fail")
	}
}

func userCredentialTestKey(secret string) [32]byte {
	return NewUserModelCredentials(nil, secret).key
}
