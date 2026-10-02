package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
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

func TestConfigureDatabasePoolReusesBurstConnections(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(false)
	configureDatabasePool(db)

	const workers = 8
	for i := 0; i < workers; i++ {
		mock.ExpectPing().WillDelayFor(50 * time.Millisecond)
	}
	start := make(chan struct{})
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- db.PingContext(context.Background())
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	stats := db.Stats()
	if stats.MaxOpenConnections != 24 {
		t.Fatalf("max open connections = %d, want 24", stats.MaxOpenConnections)
	}
	if stats.Idle < workers {
		t.Fatalf("idle connections = %d, want at least %d reusable burst connections", stats.Idle, workers)
	}
}
