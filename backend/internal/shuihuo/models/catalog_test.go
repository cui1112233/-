package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateDefinitionRejectsUnsupportedKind(t *testing.T) {
	if err := ValidateDefinition(Definition{Name: "bad", Kind: Kind("other"), AdapterKind: "generic_http"}); err == nil {
		t.Fatal("ValidateDefinition() accepted an unsupported model kind")
	}
}

func TestValidateDefinitionAcceptsConfiguredImageModel(t *testing.T) {
	err := ValidateDefinition(Definition{Name: "image-demo", Kind: KindImage, AdapterKind: AdapterJimengImage})
	if err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestJimengDoesNotRequireModelCredentialReference(t *testing.T) {
	err := ValidateDefinition(Definition{Name: "即梦", Kind: KindImage, AdapterKind: AdapterJimengImage, Enabled: true})
	if err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestValidateDefinitionRejectsUnapprovedAdapter(t *testing.T) {
	err := ValidateDefinition(Definition{Name: "x", Kind: KindImage, AdapterKind: "arbitrary_shell"})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("ValidateDefinition() error = %v, want unsupported adapter", err)
	}
}

func TestValidateDefinitionRejectsAdapterKindMismatch(t *testing.T) {
	err := ValidateDefinition(Definition{Name: "wrong", Kind: KindImage, AdapterKind: AdapterTextCompletion})
	if err == nil || !strings.Contains(err.Error(), "requires") {
		t.Fatalf("ValidateDefinition() error = %v, want adapter kind mismatch", err)
	}
}

func TestPublicModelNeverIncludesCredentialOrTemplate(t *testing.T) {
	body, err := json.Marshal(ToPublic(Definition{
		ID: 1, Name: "即梦", Kind: KindImage, AdapterKind: AdapterJimengImage,
		CredentialRef: "JIMENG_KEY", Endpoint: "https://private.example", RequestTemplate: "secret", ResponseMapping: "hidden",
	}))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"JIMENG_KEY", "private.example", "secret", "hidden"} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("public model leaked private configuration %q: %s", secret, body)
		}
	}
}

func TestAdminModelNeverIncludesPrivateRuntimeConfiguration(t *testing.T) {
	body, err := json.Marshal(ToAdmin(Definition{
		ID: 1, Name: "Vidu", Kind: KindVideo, AdapterKind: AdapterViduImageToVideo,
		CredentialRef: "VIDU_KEY", Endpoint: "https://private.example", RequestTemplate: "secret", ResponseMapping: "hidden",
	}))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"VIDU_KEY", "private.example", "secret", "hidden"} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("admin model leaked private configuration %q: %s", secret, body)
		}
	}
}

func TestGenericHTTPIsOwnerOnlyAndNeverPublic(t *testing.T) {
	model := Definition{Name: "legacy", Kind: KindImage, AdapterKind: AdapterGenericHTTP, Enabled: true}
	if !model.OwnerOnly() {
		t.Fatal("generic_http must be owner-only")
	}
	if model.PubliclySelectable() {
		t.Fatal("generic_http must never be visible to normal users")
	}
}
