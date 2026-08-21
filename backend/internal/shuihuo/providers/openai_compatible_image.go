package providers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/store"
)

const maxOpenAICompatibleImageResponseBytes = 96 << 20
const maxOpenAICompatibleInlineImageBytes = 64 << 20

type AccountImageConfigStore interface {
	Get(context.Context, int64) (store.ImageAPIConfig, error)
}

type OpenAICompatibleImage struct {
	client      *http.Client
	configs     AccountImageConfigStore
	validateURL func(string) (*url.URL, error)
}

func NewOpenAICompatibleImage(client *http.Client, configs AccountImageConfigStore) *OpenAICompatibleImage {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &OpenAICompatibleImage{client: client, configs: configs, validateURL: models.ValidateOutboundURL}
}

func (p *OpenAICompatibleImage) Submit(ctx context.Context, model models.Definition, request models.Request) (models.Response, error) {
	if model.Kind != models.KindImage || model.AdapterKind != models.AdapterAccountOpenAICompatibleImage {
		return models.Response{}, fmt.Errorf("model adapter is not account_openai_compatible_image")
	}
	if request.OwnerID < 1 {
		return models.Response{}, fmt.Errorf("account image owner is required")
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return models.Response{}, fmt.Errorf("image prompt is required")
	}
	if p.configs == nil {
		return models.Response{}, fmt.Errorf("account image configuration is unavailable")
	}
	config, err := p.configs.Get(ctx, request.OwnerID)
	if err != nil {
		return models.Response{}, fmt.Errorf("read account image configuration")
	}
	if !config.Configured() {
		return models.Response{}, fmt.Errorf("account OpenAI-compatible image configuration is incomplete")
	}
	endpoint, err := p.endpoint(config.BaseURL)
	if err != nil {
		return models.Response{}, fmt.Errorf("validate image model endpoint: %w", err)
	}
	requestPayload := map[string]any{
		"model":  config.Model,
		"prompt": strings.TrimSpace(request.Prompt),
	}
	if size := openAICompatibleImageSize(request.AspectRatio, request.Resolution); size != "" {
		requestPayload["size"] = size
	}
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return models.Response{}, fmt.Errorf("encode image model request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return models.Response{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+config.APIKeyCiphertext)
	response, err := p.client.Do(httpRequest)
	if err != nil {
		return models.Response{}, fmt.Errorf("call image model: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxOpenAICompatibleImageResponseBytes+1))
	if err != nil {
		return models.Response{}, fmt.Errorf("read image model response: %w", err)
	}
	if len(payload) > maxOpenAICompatibleImageResponseBytes {
		return models.Response{}, fmt.Errorf("image model response exceeds size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return models.Response{}, fmt.Errorf("image model returned HTTP %d", response.StatusCode)
	}
	var parsed struct {
		Data []struct {
			URL     string `json:"url"`
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return models.Response{}, fmt.Errorf("decode image model response: %w", err)
	}
	if len(parsed.Data) == 0 {
		return models.Response{}, fmt.Errorf("image model response did not contain an image URL")
	}
	resultURL := strings.TrimSpace(parsed.Data[0].URL)
	if resultURL == "" {
		image, contentType, err := decodeOpenAICompatibleInlineImage(parsed.Data[0].B64JSON)
		if err != nil {
			return models.Response{}, err
		}
		return models.Response{ResultData: image, ResultContentType: contentType}, nil
	}
	validateURL := p.validateURL
	if validateURL == nil {
		validateURL = models.ValidateOutboundURL
	}
	if _, err := validateURL(resultURL); err != nil {
		return models.Response{}, fmt.Errorf("validate image model result URL: %w", err)
	}
	return models.Response{ResultURL: resultURL}, nil
}

// The account image bridge follows the OpenAI image size vocabulary. Generic
// image models receive the user's literal aspectRatio/resolution through their
// configured request templates instead.
func openAICompatibleImageSize(aspectRatio, resolution string) string {
	if strings.TrimSpace(resolution) == "" {
		return ""
	}
	switch strings.TrimSpace(aspectRatio) {
	case "16:9", "4:3":
		return "1536x1024"
	case "9:16", "3:4":
		return "1024x1536"
	case "1:1":
		return "1024x1024"
	default:
		return ""
	}
}

func decodeOpenAICompatibleInlineImage(value string) ([]byte, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, "", fmt.Errorf("image model response did not contain an image URL or inline image")
	}
	if len(value) > base64.StdEncoding.EncodedLen(maxOpenAICompatibleInlineImageBytes) {
		return nil, "", fmt.Errorf("inline image exceeds size limit")
	}
	image, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		image, err = base64.RawStdEncoding.DecodeString(value)
	}
	if err != nil || len(image) == 0 || len(image) > maxOpenAICompatibleInlineImageBytes {
		return nil, "", fmt.Errorf("inline image is invalid or exceeds size limit")
	}
	contentType := http.DetectContentType(image)
	if !strings.HasPrefix(contentType, "image/") {
		return nil, "", fmt.Errorf("inline image response is not image data")
	}
	return image, contentType, nil
}

func (p *OpenAICompatibleImage) endpoint(baseURL string) (*url.URL, error) {
	raw := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if raw == "" {
		return nil, fmt.Errorf("image model endpoint is required")
	}
	if !strings.HasSuffix(strings.ToLower(raw), "/images/generations") {
		raw += "/images/generations"
	}
	validateURL := p.validateURL
	if validateURL == nil {
		validateURL = models.ValidateOutboundURL
	}
	return validateURL(raw)
}
