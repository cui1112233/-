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

	AdapterTextCompletion               = "text_completion"
	AdapterJimengImage                  = "jimeng_image"
	AdapterAccountOpenAICompatibleImage = "account_openai_compatible_image"
	AdapterViduImageToVideo             = "vidu_image_to_video"
	AdapterYDVideo                      = "yd_video"
	AdapterLocalExecutorVideo           = "local_executor_video"
	AdapterGenericHTTP                  = "generic_http"
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
		RequiresImageInput: model.RequiresVideoImage(), MaxVideoDuration: model.MaxVideoDuration(),
	}
}

func ToAdmin(model Definition) AdminModel {
	credentialRef := model.CredentialRef
	credentialConfigured := strings.TrimSpace(credentialRef) != ""
	if model.AdapterKind == AdapterYDVideo {
		// Historic YD rows may still contain a global reference. YD ignores it
		// and resolves the authenticated account's encrypted configuration.
		credentialRef = ""
		credentialConfigured = false
	}
	return AdminModel{
		PublicModel:          ToPublic(model),
		Enabled:              model.Enabled,
		Hidden:               model.Hidden,
		AdminNote:            model.AdminNote,
		CredentialRef:        credentialRef,
		Endpoint:             model.Endpoint,
		BaseDomain:           model.BaseDomain,
		BasePath:             model.BasePath,
		RequestTemplate:      model.RequestTemplate,
		ResponseMapping:      model.ResponseMapping,
		PollingTemplate:      model.PollingTemplate,
		RuntimePolicyJSON:    model.RuntimePolicyJSON,
		CredentialConfigured: credentialConfigured,
		ProviderConfigured:   model.ProviderConfigured(),
	}
}

func (model Definition) PubliclySelectable() bool {
	return model.Enabled && !model.Hidden
}

func (model Definition) ProviderConfigured() bool {
	if model.AdapterKind == AdapterJimengImage || model.AdapterKind == AdapterYDVideo || model.AdapterKind == AdapterLocalExecutorVideo {
		// Jimeng uses platform credentials and YD resolves an account-scoped
		// ciphertext. Neither provider has a model-row credential reference.
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

// SupportsTaskExecution reports whether the task worker has an installed
// adapter for this model. Legacy catalog rows can predate adapter validation.
func (model Definition) SupportsTaskExecution() bool {
	switch model.AdapterKind {
	case AdapterJimengImage, AdapterAccountOpenAICompatibleImage, AdapterViduImageToVideo, AdapterYDVideo, AdapterGenericHTTP, AdapterLocalExecutorVideo:
		return true
	default:
		return false
	}
}

// SupportsReferenceImages reports whether the server-side adapter can receive
// the exact set of asset images snapshotted for a storyboard image task.
// Generic models opt in only through an explicit typed template placeholder;
// the fixed provider adapters are prompt-only and must not silently discard
// reference images.
func (model Definition) SupportsReferenceImages() bool {
	if model.AdapterKind != AdapterGenericHTTP {
		return false
	}
	return strings.Contains(model.RequestTemplate, "{{reference_image_urls}}") ||
		strings.Contains(model.RequestTemplate, "{{reference_image_url}}")
}

// RequiresVideoImage identifies fixed image-to-video adapters. Generic video
// models may be configured as text-to-video and therefore receive an empty
// ImageURL when the storyboard segment has no generated image.
func (model Definition) RequiresVideoImage() bool {
	return model.Kind == KindVideo && IsAsyncVideoAdapter(model.AdapterKind)
}

func (model Definition) RequiresImageInput() bool { return model.RequiresVideoImage() }

// MaxVideoDuration is the server-declared per-video capability used by the
// batch factory to reject oversized or fabricated client settings.
func (model Definition) MaxVideoDuration() int {
	if model.Kind != KindVideo {
		return 0
	}
	for _, raw := range []string{model.ParameterSchema, model.RuntimePolicyJSON} {
		var payload map[string]any
		if json.Unmarshal([]byte(raw), &payload) != nil {
			continue
		}
		for _, key := range []string{"maxVideoDuration", "maxDuration"} {
			if value, ok := payload[key].(float64); ok && value >= 1 && value <= 60 && value == float64(int(value)) {
				return int(value)
			}
		}
		if properties, ok := payload["properties"].(map[string]any); ok {
			if duration, ok := properties["duration"].(map[string]any); ok {
				if value, ok := duration["maximum"].(float64); ok && value >= 1 && value <= 60 && value == float64(int(value)) {
					return int(value)
				}
				if values, ok := duration["enum"].([]any); ok {
					maximum := 0
					for _, candidate := range values {
						if value, ok := candidate.(float64); ok && value >= 1 && value <= 60 && value == float64(int(value)) && int(value) > maximum {
							maximum = int(value)
						}
					}
					if maximum > 0 {
						return maximum
					}
				}
			}
		}
	}
	return 0
}

func IsAsyncVideoAdapter(adapterKind string) bool {
	return adapterKind == AdapterViduImageToVideo || adapterKind == AdapterYDVideo
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
	if model.AdapterKind == AdapterYDVideo && strings.TrimSpace(model.CredentialRef) != "" {
		return fmt.Errorf("adapter %q uses account video credentials and cannot have a credential reference", AdapterYDVideo)
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
	AdapterTextCompletion:               KindText,
	AdapterJimengImage:                  KindImage,
	AdapterAccountOpenAICompatibleImage: KindImage,
	AdapterViduImageToVideo:             KindVideo,
	AdapterYDVideo:                      KindVideo,
	AdapterLocalExecutorVideo:           KindVideo,
	AdapterGenericHTTP:                  "",
}
