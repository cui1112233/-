package localexecutor

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrInvalidArtifactToken = errors.New("invalid artifact public token")

// ArtifactPublicToken creates a short-lived, owner-bound token for a media
// artifact. The token contains no credential and is useless after expiry.
func ArtifactPublicToken(secret, owner, artifactID string, expiresAt time.Time) (string, error) {
	secret = strings.TrimSpace(secret)
	owner = strings.TrimSpace(owner)
	artifactID = strings.TrimSpace(artifactID)
	if secret == "" || owner == "" || artifactID == "" || expiresAt.IsZero() {
		return "", ErrInvalidArtifactToken
	}
	payload := fmt.Sprintf("%d.%s.%s", expiresAt.UTC().Unix(), owner, artifactID)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// VerifyArtifactPublicToken validates the signature, expiry, owner binding and
// path binding. It returns the owner encoded in the token.
func VerifyArtifactPublicToken(secret, expectedArtifactID, token string, now time.Time) (string, error) {
	secret = strings.TrimSpace(secret)
	expectedArtifactID = strings.TrimSpace(expectedArtifactID)
	parts := strings.Split(strings.TrimSpace(token), ".")
	if secret == "" || expectedArtifactID == "" || len(parts) != 2 {
		return "", ErrInvalidArtifactToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", ErrInvalidArtifactToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ErrInvalidArtifactToken
	}
	fields := strings.Split(string(payload), ".")
	if len(fields) != 3 {
		return "", ErrInvalidArtifactToken
	}
	expiresUnix, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil || strings.TrimSpace(fields[1]) == "" || fields[2] != expectedArtifactID {
		return "", ErrInvalidArtifactToken
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return "", ErrInvalidArtifactToken
	}
	if !time.Unix(expiresUnix, 0).After(now.UTC()) {
		return "", ErrInvalidArtifactToken
	}
	return fields[1], nil
}
