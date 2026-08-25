package models

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxModelResponseBytes = 8 << 20

type CredentialResolver func(reference string) (string, error)

type GenericHTTPAdapter struct {
	client      *http.Client
	credentials CredentialResolver
	validateURL func(string) (*url.URL, error)
}

func NewGenericHTTPAdapter(client *http.Client, credentials CredentialResolver) *GenericHTTPAdapter {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &GenericHTTPAdapter{client: client, credentials: credentials, validateURL: ValidateOutboundURL}
}

func (a *GenericHTTPAdapter) Submit(ctx context.Context, model Definition, request Request) (Response, error) {
	if model.AdapterKind != "generic_http" {
		return Response{}, fmt.Errorf("model adapter is not generic_http")
	}
	validateURL := a.validateURL
	if validateURL == nil {
		validateURL = ValidateOutboundURL
	}
	endpoint, err := validateURL(model.Endpoint)
	if err != nil {
		return Response{}, fmt.Errorf("validate model endpoint: %w", err)
	}
	if strings.TrimSpace(model.RequestTemplate) == "" {
		return Response{}, fmt.Errorf("model request template is required")
	}
	credential := ""
	if strings.TrimSpace(model.CredentialRef) != "" {
		if a.credentials == nil {
			return Response{}, fmt.Errorf("credential resolver is required")
		}
		credential, err = a.credentials(model.CredentialRef)
		if err != nil {
			return Response{}, fmt.Errorf("resolve model credential: %w", err)
		}
	}
	var template struct {
		Method  string            `json:"method"`
		Headers map[string]string `json:"headers"`
		Body    any               `json:"body"`
	}
	if err := json.Unmarshal([]byte(model.RequestTemplate), &template); err != nil {
		return Response{}, fmt.Errorf("decode request template: %w", err)
	}
	if template.Method == "" {
		template.Method = http.MethodPost
	}
	if template.Method != http.MethodPost && template.Method != http.MethodPut {
		return Response{}, fmt.Errorf("unsupported model request method %q", template.Method)
	}
	body, err := json.Marshal(renderTemplateValue(template.Body, request, credential))
	if err != nil {
		return Response{}, fmt.Errorf("encode model request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, template.Method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return Response{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	for key, value := range template.Headers {
		httpRequest.Header.Set(key, renderTemplateString(value, request, credential))
	}
	httpResponse, err := a.client.Do(httpRequest)
	if err != nil {
		return Response{}, fmt.Errorf("call model: %w", err)
	}
	defer httpResponse.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxModelResponseBytes+1))
	if err != nil {
		return Response{}, fmt.Errorf("read model response: %w", err)
	}
	if len(responseBody) > maxModelResponseBytes {
		return Response{}, fmt.Errorf("model response exceeds size limit")
	}
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return Response{}, fmt.Errorf("model returned HTTP %d: %s", httpResponse.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return parseModelResponse(responseBody, model.ResponseMapping)
}

func renderTemplateValue(value any, request Request, credential string) any {
	switch typed := value.(type) {
	case string:
		if typed == "{{duration}}" && strings.TrimSpace(request.Duration) != "" {
			if duration, err := strconv.Atoi(strings.TrimSpace(request.Duration)); err == nil {
				return duration
			}
		}
		return renderTemplateString(typed, request, credential)
	case []any:
		items := make([]any, len(typed))
		for index, item := range typed {
			items[index] = renderTemplateValue(item, request, credential)
		}
		return items
	case map[string]any:
		items := make(map[string]any, len(typed))
		for key, item := range typed {
			items[key] = renderTemplateValue(item, request, credential)
		}
		return items
	default:
		return value
	}
}

func renderTemplateString(value string, request Request, credential string) string {
	return strings.NewReplacer(
		"{{prompt}}", request.Prompt,
		"{{image_url}}", request.ImageURL,
		"{{duration}}", request.Duration,
		"{{aspect_ratio}}", request.AspectRatio,
		"{{resolution}}", request.Resolution,
		"{{callback_url}}", request.CallbackURL,
		"{{credential}}", credential,
	).Replace(value)
}

func parseModelResponse(body []byte, rawMapping string) (Response, error) {
	var mapping struct {
		ResultURL      string `json:"resultUrl"`
		ProviderTaskID string `json:"providerTaskId"`
	}
	if err := json.Unmarshal([]byte(rawMapping), &mapping); err != nil {
		return Response{}, fmt.Errorf("decode response mapping: %w", err)
	}
	if mapping.ResultURL == "" && mapping.ProviderTaskID == "" {
		return Response{}, fmt.Errorf("response mapping requires resultUrl or providerTaskId")
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return Response{}, fmt.Errorf("decode model response JSON: %w", err)
	}
	result := Response{ResultURL: lookupString(payload, mapping.ResultURL), ProviderTaskID: lookupString(payload, mapping.ProviderTaskID)}
	if result.ResultURL == "" && result.ProviderTaskID == "" {
		return Response{}, fmt.Errorf("model response did not contain configured result")
	}
	return result, nil
}

func lookupString(value any, path string) string {
	if path == "" {
		return ""
	}
	current := value
	for _, key := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current, ok = object[key]
		if !ok {
			return ""
		}
	}
	text, _ := current.(string)
	return strings.TrimSpace(text)
}
