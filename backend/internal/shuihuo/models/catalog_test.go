package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateDefinitionRejectsUnsupportedKind(t *testing.T) {
	if err := ValidateDefinition(Definition{ModelID: "bad-model", Name: "bad", Kind: Kind("other"), AdapterKind: "generic_http"}); err == nil {
		t.Fatal("ValidateDefinition() accepted an unsupported model kind")
	}
}

func TestValidateDefinitionAcceptsConfiguredImageModel(t *testing.T) {
	err := ValidateDefinition(Definition{ModelID: "image-demo", Name: "image-demo", Kind: KindImage, AdapterKind: AdapterJimengImage})
	if err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestJimengDoesNotRequireModelCredentialReference(t *testing.T) {
	err := ValidateDefinition(Definition{ModelID: "jimeng-image", Name: "即梦", Kind: KindImage, AdapterKind: AdapterJimengImage, Enabled: true})
	if err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestValidateDefinitionAcceptsAllModelKinds(t *testing.T) {
	tests := []Definition{
		{ModelID: "text-completion", Name: "text", Kind: KindText, AdapterKind: AdapterTextCompletion, Enabled: true, CredentialRef: "text-provider"},
		{ModelID: "image-jimeng", Name: "image", Kind: KindImage, AdapterKind: AdapterJimengImage, Enabled: true},
		{ModelID: "video-vidu", Name: "video", Kind: KindVideo, AdapterKind: AdapterViduImageToVideo, Enabled: true, CredentialRef: "video-provider"},
		{ModelID: "video-yd", Name: "video", Kind: KindVideo, AdapterKind: AdapterYDVideo, Enabled: true, CredentialRef: "video-provider"},
		{ModelID: "audio-generic", Name: "audio", Kind: KindAudio, AdapterKind: AdapterGenericHTTP, Enabled: true, CredentialRef: "audio-provider", Endpoint: "https://audio.example.com", RequestTemplate: `{}`, ResponseMapping: `{}`},
	}
	for _, model := range tests {
		if err := ValidateDefinition(model); err != nil {
			t.Fatalf("ValidateDefinition(%s) error = %v", model.Kind, err)
		}
	}
}

func TestYDVideoAdapterRequiresVideoKindAndSupportsExecution(t *testing.T) {
	model := Definition{Kind: KindVideo, AdapterKind: AdapterYDVideo}
	if err := ValidateDefinition(Definition{ModelID: "video-yd", Name: "YD", Kind: KindVideo, AdapterKind: AdapterYDVideo, Enabled: true, CredentialRef: "yd-key"}); err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
	if !model.SupportsTaskExecution() {
		t.Fatal("YD video adapter must support task execution")
	}
	if !model.RequiresVideoImage() {
		t.Fatal("YD video adapter must require a scene image")
	}

	wrongKind := Definition{ModelID: "yd-image", Name: "YD image", Kind: KindImage, AdapterKind: AdapterYDVideo}
	if err := ValidateDefinition(wrongKind); err == nil || !strings.Contains(err.Error(), "requires") {
		t.Fatalf("ValidateDefinition() error = %v, want kind mismatch", err)
	}
}

func TestIsAsyncVideoAdapter(t *testing.T) {
	if !IsAsyncVideoAdapter(AdapterViduImageToVideo) || !IsAsyncVideoAdapter(AdapterYDVideo) {
		t.Fatal("fixed async video adapters must be identified")
	}
	if IsAsyncVideoAdapter(AdapterGenericHTTP) || IsAsyncVideoAdapter(AdapterJimengImage) {
		t.Fatal("non-async adapters must not be identified as async video")
	}
}

func TestValidateDefinitionAcceptsViduAdminModelID(t *testing.T) {
	model := Definition{
		ModelID:       "video-vidu-admin",
		Name:          "Vidu",
		Kind:          KindVideo,
		AdapterKind:   AdapterViduImageToVideo,
		Enabled:       true,
		CredentialRef: "VIDU_API_KEY",
	}
	if err := ValidateDefinition(model); err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestValidateDefinitionAcceptsConfiguredAudioModel(t *testing.T) {
	err := ValidateDefinition(Definition{
		ModelID:         "audio-provider",
		Name:            "配音服务",
		Kind:            KindAudio,
		AdapterKind:     AdapterGenericHTTP,
		Enabled:         true,
		CredentialRef:   "AUDIO_PROVIDER_TOKEN",
		Endpoint:        "https://audio.example.com/v1/speech",
		RequestTemplate: `{"body":{"text":"{{prompt}}","voice":"{{voice}}","rate":"{{speech_rate}}","pitch":"{{pitch}}"}}`,
		ResponseMapping: `{"resultUrl":"data.url"}`,
	})
	if err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestValidateDefinitionRejectsUnapprovedAdapter(t *testing.T) {
	err := ValidateDefinition(Definition{ModelID: "bad-adapter", Name: "x", Kind: KindImage, AdapterKind: "arbitrary_shell"})
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("ValidateDefinition() error = %v, want unsupported adapter", err)
	}
}

func TestValidateDefinitionRejectsAdapterKindMismatch(t *testing.T) {
	err := ValidateDefinition(Definition{ModelID: "wrong-kind", Name: "wrong", Kind: KindImage, AdapterKind: AdapterTextCompletion})
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

func TestAdminModelIncludesCredentialReferenceButNotCredentialValue(t *testing.T) {
	body, err := json.Marshal(ToAdmin(Definition{
		ID: 1, Name: "Vidu", Kind: KindVideo, AdapterKind: AdapterViduImageToVideo,
		CredentialRef: "vidu-production", Endpoint: "https://private.example", RequestTemplate: "secret", ResponseMapping: "hidden",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "vidu-production") {
		t.Fatalf("admin model omitted credential reference: %s", body)
	}
}

func TestGenericHTTPCanBePubliclySelectable(t *testing.T) {
	model := Definition{Name: "legacy", Kind: KindImage, AdapterKind: AdapterGenericHTTP, Enabled: true}
	if !model.PubliclySelectable() {
		t.Fatal("enabled visible generic_http must be publicly selectable")
	}
}

func TestImageTaskExecutionRequiresAnInstalledImageAdapter(t *testing.T) {
	for _, model := range []Definition{
		{Kind: KindImage, AdapterKind: AdapterJimengImage},
		{Kind: KindImage, AdapterKind: AdapterAccountOpenAICompatibleImage},
		{Kind: KindImage, AdapterKind: AdapterGenericHTTP},
	} {
		if !model.SupportsTaskExecution() {
			t.Fatalf("%q must support queued image tasks", model.AdapterKind)
		}
	}
	if (Definition{Kind: KindImage, AdapterKind: "standard"}).SupportsTaskExecution() {
		t.Fatal("legacy standard adapter must not be presented as executable")
	}
}

func TestValidateModelID(t *testing.T) {
	for _, value := range []string{"text-gpt-4o", "image-v2", "video-123", "a1-b2-c3"} {
		if err := ValidateModelID(value); err != nil {
			t.Fatalf("ValidateModelID(%q) error = %v", value, err)
		}
	}
	for _, value := range []string{"", "Text-gpt", "text gpt", "text/gpt", "text--gpt", "-text", "text-", "text_gpt"} {
		if err := ValidateModelID(value); err == nil {
			t.Fatalf("ValidateModelID(%q) accepted malformed value", value)
		}
	}
}

func TestValidateDefinitionRequiresModelIDForNewDefinitions(t *testing.T) {
	model := Definition{Name: "new model", Kind: KindImage, AdapterKind: AdapterJimengImage}
	if err := ValidateDefinition(model); err == nil || !strings.Contains(err.Error(), "modelId") {
		t.Fatalf("ValidateDefinition() error = %v, want missing modelId", err)
	}
}

func TestValidateDefinitionAllowsPersistedLegacyModelWithoutModelID(t *testing.T) {
	model := Definition{ID: 12, Name: "legacy model", Kind: KindImage, AdapterKind: AdapterJimengImage}
	if err := ValidateDefinition(model); err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestPublicModelRedactsPrivateConfiguration(t *testing.T) {
	body, err := json.Marshal(ToPublic(Definition{
		ID: 1, ModelID: "jimeng-image", Name: "jimeng", Kind: KindImage, AdapterKind: AdapterJimengImage,
		CredentialRef: "JIMENG_KEY", Endpoint: "https://private.example", RequestTemplate: "secret", ResponseMapping: "hidden",
		BaseDomain: "private.example", BasePath: "/v1/private", PollingTemplate: "poll-secret", AdminNote: "internal-only",
		RuntimePolicyJSON: `{"credential":"secret"}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"JIMENG_KEY", "private.example", "secret", "hidden", "poll-secret", "internal-only"} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("public model leaked private configuration %q: %s", secret, body)
		}
	}
}

func TestAdminModelIncludesOperationalConfigurationButNotCredentialValues(t *testing.T) {
	body, err := json.Marshal(ToAdmin(Definition{
		ID: 1, ModelID: "vidu-q1", Name: "Vidu", Kind: KindVideo, AdapterKind: AdapterViduImageToVideo,
		CredentialRef: "vidu-production", Endpoint: "https://private.example", RequestTemplate: "secret", ResponseMapping: "hidden",
		BaseDomain: "private.example", BasePath: "/v1", PollingTemplate: "poll-secret", ImageInputFormat: "url",
		ImageRequestMode: "reference", RuntimePolicyJSON: `{"timeout":30}`, AdminNote: "internal-only",
	}))
	if err != nil {
		t.Fatal(err)
	}
	for _, operational := range []string{"vidu-production", "private.example", "secret", "hidden", "poll-secret", "internal-only"} {
		if !strings.Contains(string(body), operational) {
			t.Fatalf("admin model omitted operational configuration %q: %s", operational, body)
		}
	}
}

func TestAvailableToEnforcesDirectVisibilityAndRoles(t *testing.T) {
	hidden := Definition{Enabled: true, Hidden: true}
	if hidden.AvailableTo("owner", false) {
		t.Fatal("owner direct request must not access a hidden model")
	}
	if !hidden.AvailableTo("owner", true) {
		t.Fatal("persisted server reference must access an enabled hidden model")
	}

	ownerOnly := Definition{Enabled: true, AllowedRoles: []string{"owner"}}
	if !ownerOnly.AvailableTo("owner", false) {
		t.Fatal("owner must access a visible owner-only model")
	}
	if ownerOnly.AvailableTo("user", false) {
		t.Fatal("user must not access a visible owner-only model")
	}
	if ownerOnly.AvailableTo(" owner", false) {
		t.Fatal("role matching must be explicit")
	}

	open := Definition{Enabled: true}
	if !open.AvailableTo("user", false) {
		t.Fatal("empty allowed roles must allow an enabled visible model")
	}
	open.Enabled = false
	if open.AvailableTo("user", false) {
		t.Fatal("disabled model must not be available")
	}
}
