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
	ID               int64    `json:"id"`
	ModelID          string   `json:"modelId"`
	VersionID        int64    `json:"versionId"`
	Name             string   `json:"name"`
	Kind             Kind     `json:"kind"`
	AdapterKind      string   `json:"adapterKind"`
	SortOrder        int      `json:"sortOrder"`
	ParameterSchema  string   `json:"parameterSchema"`
	ImageInputFormat string   `json:"imageInputFormat"`
	ImageRequestMode string   `json:"imageRequestMode"`
	AllowedRoles     []string `json:"allowedRoles"`
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
	endpointConfigured := strings.TrimSpace(model.Endpoint) != "" || strings.TrimSpace(model.BaseDomain) != ""
	return endpointConfigured && strings.TrimSpace(model.RequestTemplate) != "" && strings.TrimSpace(model.ResponseMapping) != ""
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
	if strings.TrimSpace(model.ModelID) == "" {
		// Rows created before the model-center migration have a numeric ID and
		// may be validated while their stable model key is being backfilled.
		if model.ID == 0 {
			return fmt.Errorf("modelId is required for new definitions")
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
	if strings.TrimSpace(model.PollingTemplate) != "" {
		var polling any
		if err := json.Unmarshal([]byte(model.PollingTemplate), &polling); err != nil {
			return fmt.Errorf("invalid polling template: %w", err)
		}
		if _, ok := polling.(map[string]any); !ok {
			return fmt.Errorf("polling template must be a JSON object")
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
