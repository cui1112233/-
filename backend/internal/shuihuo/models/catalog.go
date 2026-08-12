package models

import (
	"encoding/json"
	"fmt"
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
	ID              int64     `json:"id"`
	VersionID       int64     `json:"versionId"`
	Name            string    `json:"name"`
	Kind            Kind      `json:"kind"`
	AdapterKind     string    `json:"adapterKind"`
	Enabled         bool      `json:"enabled"`
	AllowedRoles    []string  `json:"allowedRoles"`
	ParameterSchema string    `json:"parameterSchema"`
	CredentialRef   string    `json:"credentialRef"`
	Endpoint        string    `json:"endpoint"`
	RequestTemplate string    `json:"requestTemplate"`
	ResponseMapping string    `json:"responseMapping"`
	CreatedAt       time.Time `json:"createdAt"`
}

type PublicModel struct {
	ID              int64    `json:"id"`
	VersionID       int64    `json:"versionId"`
	Name            string   `json:"name"`
	Kind            Kind     `json:"kind"`
	AdapterKind     string   `json:"adapterKind"`
	ParameterSchema string   `json:"parameterSchema"`
	AllowedRoles    []string `json:"allowedRoles"`
}

// AdminModel exposes operational configuration state without returning any
// credential reference, endpoint, template, or response mapping.
type AdminModel struct {
	PublicModel
	Enabled              bool `json:"enabled"`
	CredentialConfigured bool `json:"credentialConfigured"`
	ProviderConfigured   bool `json:"providerConfigured"`
}

func ToPublic(model Definition) PublicModel {
	return PublicModel{ID: model.ID, VersionID: model.VersionID, Name: model.Name, Kind: model.Kind, AdapterKind: model.AdapterKind, ParameterSchema: model.ParameterSchema, AllowedRoles: append([]string(nil), model.AllowedRoles...)}
}

func ToAdmin(model Definition) AdminModel {
	return AdminModel{
		PublicModel:          ToPublic(model),
		Enabled:              model.Enabled,
		CredentialConfigured: strings.TrimSpace(model.CredentialRef) != "",
		ProviderConfigured:   model.ProviderConfigured(),
	}
}

func (model Definition) OwnerOnly() bool {
	return model.AdapterKind == AdapterGenericHTTP
}

func (model Definition) PubliclySelectable() bool {
	return model.Enabled && !model.OwnerOnly()
}

func (model Definition) ProviderConfigured() bool {
	if strings.TrimSpace(model.CredentialRef) == "" {
		return false
	}
	if model.AdapterKind != AdapterGenericHTTP {
		return true
	}
	return strings.TrimSpace(model.Endpoint) != "" && strings.TrimSpace(model.RequestTemplate) != "" && strings.TrimSpace(model.ResponseMapping) != ""
}

func (model Definition) AvailableTo(isOwner bool) bool {
	return model.Enabled && (!model.OwnerOnly() || isOwner)
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
	if model.Kind != KindText && model.Kind != KindImage && model.Kind != KindVideo {
		return fmt.Errorf("unsupported model kind %q", model.Kind)
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

var adapterKinds = map[string]Kind{
	AdapterTextCompletion:   KindText,
	AdapterJimengImage:      KindImage,
	AdapterViduImageToVideo: KindVideo,
	AdapterGenericHTTP:      "",
}
