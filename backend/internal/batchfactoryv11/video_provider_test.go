package batchfactoryv11

import (
	"context"
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
	if _, ok := any(view).(interface{ APIKey() string }); ok {
		t.Fatal("provider view must not expose an API key")
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
