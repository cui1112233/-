package models

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type Kind string

const (
	KindText  Kind = "text"
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindAudio Kind = "audio"

	AdapterTextCompletion   = "text_completion"
	AdapterJimengImage      = "jimeng_image"
	AdapterViduImageToVideo = "vidu_image_to_video"
	AdapterGenericHTTP      = "generic_http"
)

type Definition struct {
	ID                int64     `json:"id"`
	ModelID           string    `json:"modelId"`
	VersionID         int64     `json:"versionId"`
	Name              string    `json:"name"`
	Kind              Kind      `json:"kind"`
	AdapterKind       string    `json:"adapterKind"`
	Enabled           bool      `json:"enabled"`
	Hidden            bool      `json:"hidden"`
	SortOrder         int       `json:"sortOrder"`
	AdminNote         string    `json:"adminNote"`
	AllowedRoles      []string  `json:"allowedRoles"`
	ParameterSchema   string    `json:"parameterSchema"`
	CredentialRef     string    `json:"credentialRef"`
	Endpoint          string    `json:"endpoint"`
	BaseDomain        string    `json:"baseDomain"`
	BasePath          string    `json:"basePath"`
	RequestTemplate   string    `json:"requestTemplate"`
	ResponseMapping   string    `json:"responseMapping"`
	PollingTemplate   string    `json:"pollingTemplate"`
	ImageInputFormat  string    `json:"imageInputFormat"`
	ImageRequestMode  string    `json:"imageRequestMode"`
	RuntimePolicyJSON string    `json:"runtimePolicyJson"`
	CreatedAt         time.Time `json:"createdAt"`
}

type PublicModel struct {
	ID                 int64    `json:"id"`
	ModelID            string   `json:"modelId"`
	VersionID          int64    `json:"versionId"`
	Name               string   `json:"name"`
	Kind               Kind     `json:"kind"`
	AdapterKind        string   `json:"adapterKind"`
	SortOrder          int      `json:"sortOrder"`
	ParameterSchema    string   `json:"parameterSchema"`
	ImageInputFormat   string   `json:"imageInputFormat"`
	ImageRequestMode   string   `json:"imageRequestMode"`
	AllowedRoles       []string `json:"allowedRoles"`
	RequiresImageInput bool     `json:"requiresImageInput"`
	MaxVideoDuration   int      `json:"maxVideoDuration"`
}

// AdminModel exposes operational configuration and credential reference IDs,
// never credential values.
type AdminModel struct {
	PublicModel
	Enabled              bool   `json:"enabled"`
	Hidden               bool   `json:"hidden"`
	AdminNote            string `json:"adminNote"`
	CredentialRef        string `json:"credentialRef"`
	Endpoint             string `json:"endpoint"`
	BaseDomain           string `json:"baseDomain"`
	BasePath             string `json:"basePath"`
	RequestTemplate      string `json:"requestTemplate"`
	ResponseMapping      string `json:"responseMapping"`
	PollingTemplate      string `json:"pollingTemplate"`
	RuntimePolicyJSON    string `json:"runtimePolicyJson"`
	CredentialConfigured bool   `json:"credentialConfigured"`
	ProviderConfigured   bool   `json:"providerConfigured"`
}

func ToPublic(model Definition) PublicModel {
	return PublicModel{
		ID: model.ID, ModelID: model.ModelID, VersionID: model.VersionID, Name: model.Name,
		Kind: model.Kind, AdapterKind: model.AdapterKind, SortOrder: model.SortOrder,
		ParameterSchema: model.ParameterSchema, ImageInputFormat: model.ImageInputFormat,
		ImageRequestMode: model.ImageRequestMode, AllowedRoles: append([]string(nil), model.AllowedRoles...),
		RequiresImageInput: model.RequiresImageInput(), MaxVideoDuration: model.MaxVideoDuration(),
	}
}

func ToAdmin(model Definition) AdminModel {
	return AdminModel{
		PublicModel:          ToPublic(model),
		Enabled:              model.Enabled,
		Hidden:               model.Hidden,
		AdminNote:            model.AdminNote,
		CredentialRef:        model.CredentialRef,
		Endpoint:             model.Endpoint,
		BaseDomain:           model.BaseDomain,
		BasePath:             model.BasePath,
		RequestTemplate:      model.RequestTemplate,
		ResponseMapping:      model.ResponseMapping,
		PollingTemplate:      model.PollingTemplate,
		RuntimePolicyJSON:    model.RuntimePolicyJSON,
		CredentialConfigured: strings.TrimSpace(model.CredentialRef) != "",
		ProviderConfigured:   model.ProviderConfigured(),
	}
}

func (model Definition) PubliclySelectable() bool {
	return model.Enabled && !model.Hidden
}

// RequiresImageInput is derived from the server-side adapter contract instead of
// a mutable database flag. Vidu is always image-to-video. Generic HTTP video
// models are image-to-video only when the request template actually consumes
// {{image_url}}; otherwise they can be used as text-to-video models such as
// Seedance-style endpoints.
func (model Definition) RequiresImageInput() bool {
	if model.Kind != KindVideo {
		return false
	}
	if model.AdapterKind == AdapterViduImageToVideo {
		return true
	}
	return model.AdapterKind == AdapterGenericHTTP && strings.Contains(model.RequestTemplate, "{{image_url}}")
}

// MaxVideoDuration returns the provider capability used to constrain one
// generated VIDEO. The public parameter schema is the preferred source because
// this value is a user-visible capability. Runtime policy is accepted as a
// backwards-compatible fallback. A value of 0 means the model has not declared
// a provider-specific maximum yet.
func (model Definition) MaxVideoDuration() int {
	if model.Kind != KindVideo {
		return 0
	}
	if value := maxVideoDurationFromJSON(model.ParameterSchema); value > 0 {
		return value
	}
	return maxVideoDurationFromJSON(model.RuntimePolicyJSON)
}

func maxVideoDurationFromJSON(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	var data map[string]any
	if json.Unmarshal([]byte(raw), &data) != nil {
		return 0
	}
	for _, key := range []string{"maxVideoDuration", "maxDuration"} {
		if value := normalizedDurationCapability(data[key]); value > 0 {
			return value
		}
	}
	properties, _ := data["properties"].(map[string]any)
	duration, _ := properties["duration"].(map[string]any)
	if value := normalizedDurationCapability(duration["maximum"]); value > 0 {
		return value
	}
	if values, ok := duration["enum"].([]any); ok {
		maximum := 0
		for _, candidate := range values {
			if value := normalizedDurationCapability(candidate); value > maximum {
				maximum = value
			}
		}
		return maximum
	}
	return 0
}

func normalizedDurationCapability(value any) int {
	number, ok := value.(float64)
	if !ok || number < 1 || number > 60 || number != float64(int(number)) {
		return 0
	}
	return int(number)
}

func (model Definition) ProviderConfigured() bool {
	if model.AdapterKind == AdapterJimengImage {
		// Jimeng uses the platform's fixed Volcengine AK/SK pair. A model row
		// must not carry, resolve, or reveal that provider credential name.
		return true
	}
	if strings.TrimSpace(model.CredentialRef) == "" {
		return false
	}
	if model.AdapterKind != AdapterGenericHTTP {
		return true
	}
	return strings.TrimSpace(model.Endpoint) != "" && strings.TrimSpace(model.RequestTemplate) != "" && strings.TrimSpace(model.ResponseMapping) != ""
}

func (model Definition) AvailableTo(role string, persistedReference bool) bool {
	if !model.Enabled || (model.Hidden && !persistedReference) {
		return false
	}
	if len(model.AllowedRoles) == 0 {
		return true
	}
	for _, allowedRole := range model.AllowedRoles {
		if role == allowedRole {
			return true
		}
	}
	return false
}

func ValidateDefinition(model Definition) error {
	if strings.TrimSpace(model.Name) == "" {
		return fmt.Errorf("model name is required")
	}
	if expectedKind, ok := adapterKinds[model.AdapterKind]; !ok {
		return fmt.Errorf("unsupported model adapter %q", model.AdapterKind)
	} else if expectedKind != "" && model.Kind != expectedKind {
		return fmt.Errorf("adapter %q requires %s model kind", model.AdapterKind, expectedKind)
	}
	if model.Kind != KindText && model.Kind != KindImage && model.Kind != KindVideo && model.Kind != KindAudio {
		return fmt.Errorf("unsupported model kind %q", model.Kind)
	}
	// New definitions must provide the immutable model key. Existing rows that
	// predate model_key are still readable during the migration, identified by
	// their persisted primary key.
	if strings.TrimSpace(model.ModelID) == "" {
		if model.ID == 0 {
			return fmt.Errorf("modelId is required")
		}
	} else if err := ValidateModelID(model.ModelID); err != nil {
		return err
	}
	if strings.TrimSpace(model.ParameterSchema) != "" {
		var schema any
		if err := json.Unmarshal([]byte(model.ParameterSchema), &schema); err != nil {
			return fmt.Errorf("invalid public parameter schema: %w", err)
		}
		if _, ok := schema.(map[string]any); !ok {
			return fmt.Errorf("public parameter schema must be a JSON object")
		}
	}
	if model.Enabled && !model.ProviderConfigured() {
		return fmt.Errorf("enabled model requires a credential reference and valid provider configuration")
	}
	return nil
}

var modelIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// ValidateModelID accepts immutable, globally unique lower-case kebab-case IDs.
func ValidateModelID(value string) error {
	if !modelIDPattern.MatchString(value) {
		return fmt.Errorf("modelId must be lower-case kebab-case")
	}
	return nil
}

var adapterKinds = map[string]Kind{
	AdapterTextCompletion:   KindText,
	AdapterJimengImage:      KindImage,
	AdapterViduImageToVideo: KindVideo,
	AdapterGenericHTTP:      "",
}
