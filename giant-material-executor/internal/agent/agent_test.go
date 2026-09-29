package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPClientMapsEmptyClaimAndSendsBearerToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/giant-material-executor/v1/jobs/claim" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer executor-token" {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, server.Client())
	if _, err := client.Claim(context.Background(), "executor-token"); err != ErrNoClaimableJob {
		t.Fatalf("claim error=%v", err)
	}
}
