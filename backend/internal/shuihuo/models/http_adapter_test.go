package models

import (
	"context"
	"errors"
	"net"
	"testing"
)

type staticResolver map[string][]net.IPAddr

func (r staticResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	return r[host], nil
}

func TestHTTPAdapterRejectsPrivateTarget(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:8080/admin", "https://127.0.0.1/admin", "https://10.0.0.1", "https://169.254.169.254"} {
		_, err := ValidateOutboundURL(raw)
		if raw[:5] == "http:" {
			if err == nil {
				t.Fatalf("%q accepted", raw)
			}
			continue
		}
		if !errors.Is(err, ErrPrivateNetworkTarget) {
			t.Fatalf("%q err=%v", raw, err)
		}
	}
}

func TestHTTPAdapterAcceptsPublicHTTPS(t *testing.T) {
	resolver := staticResolver{"models.example.com": {{IP: net.ParseIP("8.8.8.8")}}}
	if _, err := ValidateOutboundURLWithResolver(context.Background(), "https://models.example.com/v1/generate", resolver); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPAdapterRejectsPrivateResolvedHostname(t *testing.T) {
	resolver := staticResolver{"127.0.0.1.nip.io": {{IP: net.ParseIP("127.0.0.1")}}}
	_, err := ValidateOutboundURLWithResolver(context.Background(), "https://127.0.0.1.nip.io/admin", resolver)
	if !errors.Is(err, ErrPrivateNetworkTarget) {
		t.Fatalf("err = %v, want private target rejection", err)
	}
}
