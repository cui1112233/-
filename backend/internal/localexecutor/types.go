package localexecutor

import (
	"errors"
	"time"
)

var (
	ErrInvalidPlatform      = errors.New("invalid executor platform")
	ErrInvalidInput         = errors.New("invalid executor input")
	ErrPairingInvalid       = errors.New("pairing code is invalid or expired")
	ErrExecutorUnauthorized = errors.New("executor is unauthorized")
	ErrInvalidAccountStats  = errors.New("invalid executor account stats")
)

const (
	PlatformDoubao           = "doubao"
	PairingTTL               = 10 * time.Minute
	HeartbeatIntervalSeconds = 15
	OnlineThreshold          = 45 * time.Second
)

type SecretHash [32]byte

type PairingRecord struct {
	ID            string
	OwnerUsername string
	Platform      string
	CodeHash      SecretHash
	ExpiresAt     time.Time
	ConsumedAt    *time.Time
	CreatedAt     time.Time
}

type PairingSecret struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type PairInput struct {
	Code       string `json:"code"`
	DeviceName string `json:"deviceName"`
	Platform   string `json:"platform"`
	OS         string `json:"os"`
	Version    string `json:"version"`
}

type PairResult struct {
	ExecutorID               string `json:"executorId"`
	Token                    string `json:"token"`
	HeartbeatIntervalSeconds int    `json:"heartbeatIntervalSeconds"`
}

type AccountStats struct {
	Total             int `json:"total"`
	Available         int `json:"available"`
	Busy              int `json:"busy"`
	QuotaExhausted    int `json:"quotaExhausted"`
	LoginError        int `json:"loginError"`
	HumanVerification int `json:"humanVerification"`
}

type HeartbeatInput struct {
	DeviceName string       `json:"deviceName"`
	OS         string       `json:"os"`
	Version    string       `json:"version"`
	Accounts   AccountStats `json:"accounts"`
}

type ExecutorRecord struct {
	ID            string
	OwnerUsername string
	Platform      string
	TokenHash     SecretHash
	DeviceName    string
	OS            string
	Version       string
	Accounts      AccountStats
	LastSeenAt    *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type ExecutorView struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Platform   string       `json:"platform"`
	OS         string       `json:"os"`
	Version    string       `json:"version"`
	Online     bool         `json:"online"`
	LastSeenAt *time.Time   `json:"lastSeenAt,omitempty"`
	Accounts   AccountStats `json:"accounts"`
}
