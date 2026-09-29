package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareRejectsInvalidHashAndLeavesNoStagedBinary(t *testing.T) {
	root := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("new-binary")) }))
	defer server.Close()
	m := Manager{Root: root, CurrentVersion: "1.0.0", HTTPClient: &http.Client{Transport: rewriteTransport{target: server.URL}}, VerifySignature: func([]byte, Manifest) bool { return true }}
	_, err := m.Prepare(context.Background(), Manifest{Version: "1.1.0", URL: "https://updates.example/agent.exe", SHA256: stringsHash("wrong"), Signature: "sig", MinimumAgentVersion: "1.0.0"}, func() bool { return true })
	if CodeOf(err) != "UPDATE_HASH_MISMATCH" {
		t.Fatalf("error=%v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(root, ".updates"))
	if len(entries) != 0 {
		t.Fatalf("staged files=%v", entries)
	}
}

type rewriteTransport struct{ target string }

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	base, _ := http.NewRequest(http.MethodGet, t.target, nil)
	clone.URL.Scheme = base.URL.Scheme
	clone.URL.Host = base.URL.Host
	return http.DefaultTransport.RoundTrip(clone)
}

func TestPrepareIgnoresLowerVersionAndDefersBusyExecutor(t *testing.T) {
	m := Manager{Root: t.TempDir(), CurrentVersion: "2.0.0", VerifySignature: func([]byte, Manifest) bool { return true }}
	_, err := m.Prepare(context.Background(), Manifest{Version: "1.9.0", URL: "https://example.com/agent.exe", SHA256: stringsHash("binary"), Signature: "sig"}, func() bool { return true })
	if CodeOf(err) != "UPDATE_NOT_NEEDED" {
		t.Fatalf("lower version error=%v", err)
	}
	m.CurrentVersion = "1.0.0"
	_, err = m.Prepare(context.Background(), Manifest{Version: "1.1.0", URL: "https://example.com/agent.exe", SHA256: stringsHash("binary"), Signature: "sig"}, func() bool { return false })
	if CodeOf(err) != "UPDATE_EXECUTOR_BUSY" {
		t.Fatalf("busy error=%v", err)
	}
}

func stringsHash(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}
