package agent

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPClientMapsUnauthorizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, server.Client())
	if _, err := client.Claim(context.Background(), "executor-token"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("claim error=%v, want ErrUnauthorized", err)
	}
}

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
