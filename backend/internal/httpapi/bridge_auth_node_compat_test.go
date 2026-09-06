package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func nodeGatewayBridgeSignature(secret, username, issuedAt string, isOwner bool, method, pathname string) string {
	payload := strings.Join([]string{username, issuedAt, strconv.FormatBool(isOwner), method, pathname}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestBridgeAuthAcceptsNodeGatewayCanonicalSignature(t *testing.T) {
	const (
		secret   = "test-bridge-secret"
		username = "public-user"
		pathname = "/api/shuihuo-production/local-executors"
	)
	now := time.Unix(1_800_000_000, 0)
	issuedAt := strconv.FormatInt(now.Unix(), 10)

	req := httptest.NewRequest(http.MethodGet, pathname, nil)
	req.Header.Set(HeaderUsername, username)
	req.Header.Set(HeaderIsOwner, "false")
	req.Header.Set(HeaderIssuedAt, issuedAt)
	req.Header.Set(HeaderSignature, nodeGatewayBridgeSignature(secret, username, issuedAt, false, req.Method, req.URL.Path))

	called := false
	handler := BridgeAuth{
		Secret: secret,
		Now:    func() time.Time { return now },
	}.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		called = true
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			t.Fatal("expected bridge identity in request context")
		}
		if identity.Username != username || identity.IsOwner {
			t.Fatalf("unexpected bridge identity: %#v", identity)
		}
		w.WriteHeader(http.StatusOK)
	}))

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Node gateway signature should be accepted; got status %d body %s", recorder.Code, recorder.Body.String())
	}
	if !called {
		t.Fatal("expected authenticated handler to be called")
	}
}
