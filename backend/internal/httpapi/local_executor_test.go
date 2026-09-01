package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/localexecutor"
)

func signNewlineBridgeRequest(req *http.Request, username string, isOwner bool, at time.Time, secret string) {
	issued := strconv.FormatInt(at.Unix(), 10)
	owner := strconv.FormatBool(isOwner)
	payload := strings.Join([]string{username, issued, owner, req.Method, req.URL.Path}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	req.Header.Set(HeaderUsername, username)
	req.Header.Set(HeaderIsOwner, owner)
	req.Header.Set(HeaderIssuedAt, issued)
	req.Header.Set(HeaderSignature, hex.EncodeToString(mac.Sum(nil)))
}

func newExecutorTestAPI(t *testing.T, now func() time.Time) (http.Handler, *localexecutor.Service) {
	t.Helper()
	store := localexecutor.NewMemoryStore()
	svc := localexecutor.NewService(store, now)
	root := http.NewServeMux()
	RegisterLocalExecutorRoutes(root, BridgeAuth{Secret: "secret", Now: now}, svc)
	return root, svc
}

func jsonRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

func TestLocalExecutorListRejectsUnsignedWebsiteRequest(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	api, _ := newExecutorTestAPI(t, func() time.Time { return now })
	req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executors", nil)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestWebsiteCanCreatePairingAndExecutorCanPair(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	api, _ := newExecutorTestAPI(t, func() time.Time { return now })

	pairingReq := jsonRequest(t, http.MethodPost, "/api/shuihuo-production/local-executors/pairings", map[string]any{"platform": "doubao"})
	signNewlineBridgeRequest(pairingReq, "alice", false, now, "secret")
	pairingRec := httptest.NewRecorder()
	api.ServeHTTP(pairingRec, pairingReq)
	if pairingRec.Code != http.StatusCreated {
		t.Fatalf("pairing status=%d body=%s", pairingRec.Code, pairingRec.Body.String())
	}
	var pairing struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(pairingRec.Body).Decode(&pairing); err != nil {
		t.Fatal(err)
	}
	if pairing.Code == "" {
		t.Fatal("missing pairing code")
	}

	pairReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/pair", localexecutor.PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao", OS: "windows", Version: "0.1.14"})
	pairRec := httptest.NewRecorder()
	api.ServeHTTP(pairRec, pairReq)
	if pairRec.Code != http.StatusOK {
		t.Fatalf("pair status=%d body=%s", pairRec.Code, pairRec.Body.String())
	}
	var paired localexecutor.PairResult
	if err := json.NewDecoder(pairRec.Body).Decode(&paired); err != nil {
		t.Fatal(err)
	}
	if paired.Token == "" || paired.ExecutorID == "" {
		t.Fatalf("paired=%+v", paired)
	}
}

func TestExecutorHeartbeatRequiresBearerToken(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	api, svc := newExecutorTestAPI(t, func() time.Time { return now })
	pairing, _ := svc.CreatePairing(context.Background(), "alice", "doubao")
	paired, _ := svc.Pair(context.Background(), localexecutor.PairInput{Code: pairing.Code, DeviceName: "DESKTOP-A", Platform: "doubao"})

	input := localexecutor.HeartbeatInput{Accounts: localexecutor.AccountStats{Total: 2, Available: 1, Busy: 1}}
	unauthReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/heartbeat", input)
	unauthRec := httptest.NewRecorder()
	api.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth=%d", unauthRec.Code)
	}

	authReq := jsonRequest(t, http.MethodPost, "/api/local-executor/v1/heartbeat", input)
	authReq.Header.Set("Authorization", "Bearer "+paired.Token)
	authRec := httptest.NewRecorder()
	api.ServeHTTP(authRec, authReq)
	if authRec.Code != http.StatusOK {
		t.Fatalf("auth=%d body=%s", authRec.Code, authRec.Body.String())
	}
}

func TestAliceCannotListBobsExecutor(t *testing.T) {
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	api, svc := newExecutorTestAPI(t, func() time.Time { return now })
	pairing, _ := svc.CreatePairing(context.Background(), "bob", "doubao")
	bob, _ := svc.Pair(context.Background(), localexecutor.PairInput{Code: pairing.Code, DeviceName: "BOB-PC", Platform: "doubao"})
	_ = svc.Heartbeat(context.Background(), bob.Token, localexecutor.HeartbeatInput{Accounts: localexecutor.AccountStats{Total: 1, Available: 1}})

	req := httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/local-executors", nil)
	SignBridgeRequest(req, "alice", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Executors []localexecutor.ExecutorView `json:"executors"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Executors) != 0 {
		t.Fatalf("executors=%+v", body.Executors)
	}
}
