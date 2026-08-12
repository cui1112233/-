package providers

import (
	"strings"
	"testing"
	"time"
)

func TestJimengSignsCanonicalRequestWithoutLeakingSecret(t *testing.T) {
	secret := "secret-that-must-not-appear"
	signed := SignVolcengineRequest("AKID", secret, time.Date(2026, time.August, 12, 11, 12, 13, 0, time.UTC), []byte(`{"req_key":"high_aes_general_v30l","prompt":"雨夜车站"}`))
	if !strings.HasPrefix(signed.Authorization, "HMAC-SHA256 Credential=AKID/20260812/cn-north-1/cv/request") {
		t.Fatalf("authorization = %q", signed.Authorization)
	}
	if strings.Contains(signed.Authorization, secret) {
		t.Fatalf("authorization leaked secret: %q", signed.Authorization)
	}
	if got, want := signed.XDate, "20260812T111213Z"; got != want {
		t.Fatalf("X-Date = %q, want %q", got, want)
	}
}

func TestJimengMapsProviderTaskToResultURL(t *testing.T) {
	result, err := ParseJimengResult(`{"code":10000,"data":{"image_urls":["https://cdn.example/a.png"]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := result.ResultURL, "https://cdn.example/a.png"; got != want {
		t.Fatalf("result URL = %q, want %q", got, want)
	}
}
