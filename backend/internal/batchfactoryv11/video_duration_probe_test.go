package batchfactoryv11

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

type durationProbeRoundTripper func(*http.Request) (*http.Response, error)

func (f durationProbeRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestHTTPVideoDurationProbeRetriesTransientStreamFailure(t *testing.T) {
	calls := 0
	probe := HTTPVideoDurationProbe{Client: &http.Client{Transport: durationProbeRoundTripper(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("stream error: INTERNAL_ERROR")
	})}}
	_, err := probe.DurationSeconds(context.Background(), "https://media.example/video.mp4")
	if err == nil {
		t.Fatal("expected stream probe failure")
	}
	if calls != 3 {
		t.Fatalf("transient stream error should receive bounded retries, calls=%d", calls)
	}
}
