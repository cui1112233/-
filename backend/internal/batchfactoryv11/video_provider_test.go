package batchfactoryv11

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestMemoryVideoProviderRegistryKeepsAPIKeyOutOfView(t *testing.T) {
	registry := NewMemoryVideoProviderRegistry()
	if err := registry.Put(context.Background(), "alice", VideoProviderConfig{
		Provider: VideoProviderPersonalAPI,
		APIKey:   "secret-video-key",
	}); err != nil {
		t.Fatal(err)
	}
	view, err := registry.View(context.Background(), "alice", VideoProviderPersonalAPI)
	if err != nil {
		t.Fatal(err)
	}
	if !view.Configured || view.Model != DefaultPersonalVideoModel || view.Provider != VideoProviderPersonalAPI {
		t.Fatalf("view=%+v", view)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-video-key") {
		t.Fatalf("provider view leaked key: %s", encoded)
	}
}

func TestNormalizeVideoProviderForHTTP(t *testing.T) {
	if got := NormalizeVideoProviderForHTTP("doubao"); got != VideoProviderDoubaoLocal {
		t.Fatalf("got %q", got)
	}
	if got := NormalizeVideoProviderForHTTP(""); got != VideoProviderPersonalAPI {
		t.Fatalf("got %q", got)
	}
}
