package models

import (
	"strings"
	"testing"
)

func TestCredentialRegistryListsConfiguredStateWithoutSecrets(t *testing.T) {
	registry := NewCredentialRegistry(
		map[string]string{"TEXT_TOKEN": "text-secret", "IMAGE_TOKEN": ""},
		map[string]CredentialReferenceConfig{
			"text-provider":  {Label: "Text provider", EnvironmentVariable: "TEXT_TOKEN"},
			"image-provider": {Label: "Image provider", EnvironmentVariable: "IMAGE_TOKEN"},
		},
	)

	items := registry.List()
	if len(items) != 2 {
		t.Fatalf("List() length = %d, want 2", len(items))
	}
	for _, item := range items {
		if item.ID == "text-provider" && !item.Configured {
			t.Fatal("configured credential reference reported as unconfigured")
		}
		if item.ID == "image-provider" && item.Configured {
			t.Fatal("empty credential reference reported as configured")
		}
		body := item.ID + item.Label
		if strings.Contains(body, "TEXT_TOKEN") || strings.Contains(body, "IMAGE_TOKEN") || strings.Contains(body, "secret") {
			t.Fatalf("List() leaked credential data: %q", body)
		}
	}
}

func TestCredentialRegistryResolveRejectsUnknownAndMissingWithoutLeakage(t *testing.T) {
	registry := NewCredentialRegistry(
		map[string]string{"CONFIGURED_ENV": "resolved-secret", "MISSING_ENV": ""},
		map[string]CredentialReferenceConfig{
			"configured": {Label: "Configured", EnvironmentVariable: "CONFIGURED_ENV"},
			"missing":    {Label: "Missing", EnvironmentVariable: "MISSING_ENV"},
		},
	)

	value, err := registry.Resolve("configured")
	if err != nil || value != "resolved-secret" {
		t.Fatalf("Resolve(configured) = %q, %v", value, err)
	}
	for _, referenceID := range []string{"unknown", "missing"} {
		value, err := registry.Resolve(referenceID)
		if err == nil || value != "" {
			t.Fatalf("Resolve(%q) = %q, %v; want generic failure", referenceID, value, err)
		}
		for _, leaked := range []string{"CONFIGURED_ENV", "MISSING_ENV", "resolved-secret", referenceID} {
			if strings.Contains(err.Error(), leaked) {
				t.Fatalf("Resolve(%q) leaked %q in error %q", referenceID, leaked, err)
			}
		}
	}
}
