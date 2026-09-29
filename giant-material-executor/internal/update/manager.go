package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Manifest struct {
	Version             string `json:"version"`
	URL                 string `json:"url"`
	SHA256              string `json:"sha256"`
	Signature           string `json:"signature"`
	MinimumAgentVersion string `json:"minimumAgentVersion"`
}

type CodedError struct{ Code string }

func (e *CodedError) Error() string { return e.Code }

func CodeOf(err error) string {
	var coded *CodedError
	if errors.As(err, &coded) {
		return coded.Code
	}
	return ""
}

type Manager struct {
	Root            string
	CurrentVersion  string
	HTTPClient      *http.Client
	VerifySignature func([]byte, Manifest) bool
}

func (m Manager) Prepare(ctx context.Context, manifest Manifest, idle func() bool) (string, error) {
	if !validVersion(manifest.Version) || strings.TrimSpace(manifest.URL) == "" || len(strings.TrimSpace(manifest.SHA256)) != 64 || strings.TrimSpace(manifest.Signature) == "" {
		return "", &CodedError{Code: "UPDATE_MANIFEST_INVALID"}
	}
	parsed, err := url.Parse(manifest.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", &CodedError{Code: "UPDATE_MANIFEST_INVALID"}
	}
	if compareVersions(manifest.Version, m.CurrentVersion) <= 0 {
		return "", &CodedError{Code: "UPDATE_NOT_NEEDED"}
	}
	if manifest.MinimumAgentVersion != "" && compareVersions(m.CurrentVersion, manifest.MinimumAgentVersion) < 0 {
		return "", &CodedError{Code: "UPDATE_AGENT_TOO_OLD"}
	}
	if idle != nil && !idle() {
		return "", &CodedError{Code: "UPDATE_EXECUTOR_BUSY"}
	}
	if m.VerifySignature == nil {
		return "", &CodedError{Code: "UPDATE_SIGNATURE_INVALID"}
	}
	if err := os.MkdirAll(filepath.Join(m.Root, ".updates"), 0o700); err != nil {
		return "", &CodedError{Code: "UPDATE_STAGE_FAILED"}
	}
	client := m.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifest.URL, nil)
	if err != nil {
		return "", &CodedError{Code: "UPDATE_DOWNLOAD_FAILED"}
	}
	response, err := client.Do(req)
	if err != nil {
		return "", &CodedError{Code: "UPDATE_DOWNLOAD_FAILED"}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &CodedError{Code: "UPDATE_DOWNLOAD_FAILED"}
	}
	partPath := filepath.Join(m.Root, ".updates", manifest.Version+".part")
	file, err := os.OpenFile(partPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", &CodedError{Code: "UPDATE_STAGE_FAILED"}
	}
	data, copyErr := io.ReadAll(io.LimitReader(response.Body, 128<<20))
	if copyErr == nil {
		_, copyErr = file.Write(data)
	}
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(partPath)
		return "", &CodedError{Code: "UPDATE_DOWNLOAD_FAILED"}
	}
	hash := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(hash[:]), strings.TrimSpace(manifest.SHA256)) {
		_ = os.Remove(partPath)
		return "", &CodedError{Code: "UPDATE_HASH_MISMATCH"}
	}
	if !m.VerifySignature(data, manifest) {
		_ = os.Remove(partPath)
		return "", &CodedError{Code: "UPDATE_SIGNATURE_INVALID"}
	}
	finalPath := filepath.Join(m.Root, ".updates", manifest.Version+".exe")
	if err := os.Rename(partPath, finalPath); err != nil {
		_ = os.Remove(partPath)
		return "", &CodedError{Code: "UPDATE_STAGE_FAILED"}
	}
	return finalPath, nil
}

func validVersion(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), ".")
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != "" && allNumeric(parts)
}

func allNumeric(parts []string) bool {
	for _, part := range parts {
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

func compareVersions(left, right string) int {
	if !validVersion(left) || !validVersion(right) {
		return strings.Compare(left, right)
	}
	leftParts, rightParts := strings.Split(left, "."), strings.Split(right, ".")
	for index := range leftParts {
		leftNumber, _ := strconv.Atoi(leftParts[index])
		rightNumber, _ := strconv.Atoi(rightParts[index])
		if leftNumber < rightNumber {
			return -1
		}
		if leftNumber > rightNumber {
			return 1
		}
	}
	return 0
}
