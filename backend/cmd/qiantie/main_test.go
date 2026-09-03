package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthURLNormalizesWildcardListenAddresses(t *testing.T) {
	for _, tc := range []struct {
		listen string
		want   string
	}{
		{listen: ":4000", want: "http://127.0.0.1:4000/health"},
		{listen: "0.0.0.0:4000", want: "http://127.0.0.1:4000/health"},
		{listen: "[::]:4000", want: "http://127.0.0.1:4000/health"},
		{listen: "127.0.0.1:4555", want: "http://127.0.0.1:4555/health"},
	} {
		if got := healthURL(tc.listen); got != tc.want {
			t.Fatalf("healthURL(%q) = %q, want %q", tc.listen, got, tc.want)
		}
	}
}

func TestRunHealthcheckRequiresHTTP200(t *testing.T) {
	okServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("healthcheck path = %q, want /health", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer okServer.Close()
	if err := runHealthcheck(okServer.URL + "/health"); err != nil {
		t.Fatalf("runHealthcheck returned error for healthy server: %v", err)
	}

	badServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer badServer.Close()
	if err := runHealthcheck(badServer.URL + "/health"); err == nil {
		t.Fatal("runHealthcheck accepted non-200 response")
	}
}
