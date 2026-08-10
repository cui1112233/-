package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func HashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func CheckPassword(password string, passwordHash string) bool {
	return hmac.Equal([]byte(HashPassword(password)), []byte(passwordHash))
}

func NewToken(secret string, userID int64, username string) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	issuedAt := time.Now().Unix()
	payload := fmt.Sprintf("%d:%s:%d:%s", userID, username, issuedAt, base64.RawURLEncoding.EncodeToString(nonce))
	sig := sign(secret, payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig, nil
}

func ParseToken(secret string, token string) (int64, string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid token")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, "", fmt.Errorf("invalid token payload")
	}
	payload := string(payloadBytes)
	if !hmac.Equal([]byte(sign(secret, payload)), []byte(parts[1])) {
		return 0, "", fmt.Errorf("invalid token signature")
	}
	fields := strings.Split(payload, ":")
	if len(fields) != 4 {
		return 0, "", fmt.Errorf("invalid token fields")
	}
	userID, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid user id")
	}
	return userID, fields[1], nil
}

func sign(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
