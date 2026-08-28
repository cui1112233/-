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

type GenericPollState string

const (
	GenericPollRunning   GenericPollState = "running"
	GenericPollSucceeded GenericPollState = "succeeded"
	GenericPollFailed    GenericPollState = "failed"
)

type GenericPollResult struct {
	State     GenericPollState
	ResultURL string
	Message   string
}

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
	if model.AdapterKind != AdapterGenericHTTP {
		return Response{}, fmt.Errorf("model adapter is not generic_http")
	}
	endpoint, err := a.validatedURL(model.Endpoint)
	if err != nil {
		return Response{}, fmt.Errorf("validate model endpoint: %w", err)
	}
	if strings.TrimSpace(model.RequestTemplate) == "" {
		return Response{}, fmt.Errorf("model request template is required")
	}
	credential, err := a.resolveCredential(model)
	if err != nil {
		return Response{}, err
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
	responseBody, err := a.doJSON(httpRequest)
	if err != nil {
		return Response{}, err
	}
	return parseModelResponse(responseBody, model.ResponseMapping)
}

// Poll uses a declarative server-side polling template. Example:
// {"method":"GET","url":"https://provider/tasks/{{provider_task_id}}","headers":{"Authorization":"Bearer {{credential}}"},
//  "statusPath":"data.status","resultUrlPath":"data.url","messagePath":"data.message",
//  "running":["queued","running"],"succeeded":["succeeded","completed"],"failed":["failed","cancelled"]}
func (a *GenericHTTPAdapter) Poll(ctx context.Context, model Definition, providerTaskID string) (GenericPollResult, error) {
	if model.AdapterKind != AdapterGenericHTTP {
		return GenericPollResult{}, fmt.Errorf("model adapter is not generic_http")
	}
	if strings.TrimSpace(providerTaskID) == "" {
		return GenericPollResult{}, fmt.Errorf("provider task id is required")
	}
	if strings.TrimSpace(model.PollingTemplate) == "" {
		return GenericPollResult{}, fmt.Errorf("polling template is required")
	}
	credential, err := a.resolveCredential(model)
	if err != nil {
		return GenericPollResult{}, err
	}
	var template struct {
		Method        string            `json:"method"`
		URL           string            `json:"url"`
		Headers       map[string]string `json:"headers"`
		Body          any               `json:"body"`
		StatusPath    string            `json:"statusPath"`
		ResultURLPath string            `json:"resultUrlPath"`
		MessagePath   string            `json:"messagePath"`
		Running       []string          `json:"running"`
		Succeeded     []string          `json:"succeeded"`
		Failed        []string          `json:"failed"`
	}
	if err := json.Unmarshal([]byte(model.PollingTemplate), &template); err != nil {
		return GenericPollResult{}, fmt.Errorf("decode polling template: %w", err)
	}
	if template.Method == "" {
		template.Method = http.MethodGet
	}
	if template.Method != http.MethodGet && template.Method != http.MethodPost {
		return GenericPollResult{}, fmt.Errorf("unsupported polling method %q", template.Method)
	}
	if strings.TrimSpace(template.URL) == "" {
		return GenericPollResult{}, fmt.Errorf("polling template url is required")
	}
	rawURL := renderPollingString(template.URL, providerTaskID, credential)
	pollURL, err := a.validatedURL(rawURL)
	if err != nil {
		return GenericPollResult{}, fmt.Errorf("validate polling url: %w", err)
	}
	var body io.Reader
	if template.Method == http.MethodPost && template.Body != nil {
		rendered, marshalErr := json.Marshal(renderPollingValue(template.Body, providerTaskID, credential))
		if marshalErr != nil {
			return GenericPollResult{}, fmt.Errorf("encode polling body: %w", marshalErr)
		}
		body = bytes.NewReader(rendered)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, template.Method, pollURL.String(), body)
	if err != nil {
		return GenericPollResult{}, err
	}
	if body != nil {
		httpRequest.Header.Set("Content-Type", "application/json")
	}
	for key, value := range template.Headers {
		httpRequest.Header.Set(key, renderPollingString(value, providerTaskID, credential))
	}
	responseBody, err := a.doJSON(httpRequest)
	if err != nil {
		return GenericPollResult{}, err
	}
	var payload any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return GenericPollResult{}, fmt.Errorf("decode polling response JSON: %w", err)
	}
	status := strings.ToLower(strings.TrimSpace(lookupScalarString(payload, template.StatusPath)))
	if status == "" {
		return GenericPollResult{}, fmt.Errorf("polling response did not contain configured status")
	}
	result := GenericPollResult{
		ResultURL: strings.TrimSpace(lookupScalarString(payload, template.ResultURLPath)),
		Message:   strings.TrimSpace(lookupScalarString(payload, template.MessagePath)),
	}
	if containsFold(template.Succeeded, status) {
		if result.ResultURL == "" {
			return GenericPollResult{}, fmt.Errorf("succeeded polling response did not contain result url")
		}
		result.State = GenericPollSucceeded
		return result, nil
	}
	if containsFold(template.Failed, status) {
		result.State = GenericPollFailed
		return result, nil
	}
	if len(template.Running) == 0 || containsFold(template.Running, status) {
		result.State = GenericPollRunning
		return result, nil
	}
	return GenericPollResult{}, fmt.Errorf("unrecognized polling status %q", status)
}

func (a *GenericHTTPAdapter) resolveCredential(model Definition) (string, error) {
	if strings.TrimSpace(model.CredentialRef) == "" {
		return "", nil
	}
	if a.credentials == nil {
		return "", fmt.Errorf("credential resolver is required")
	}
	credential, err := a.credentials(model.CredentialRef)
	if err != nil {
		return "", fmt.Errorf("resolve model credential: %w", err)
	}
	return credential, nil
}

func (a *GenericHTTPAdapter) validatedURL(raw string) (*url.URL, error) {
	validateURL := a.validateURL
	if validateURL == nil {
		validateURL = ValidateOutboundURL
	}
	return validateURL(raw)
}

func (a *GenericHTTPAdapter) doJSON(request *http.Request) ([]byte, error) {
	httpResponse, err := a.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call model: %w", err)
	}
	defer httpResponse.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxModelResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read model response: %w", err)
	}
	if len(responseBody) > maxModelResponseBytes {
		return nil, fmt.Errorf("model response exceeds size limit")
	}
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return nil, fmt.Errorf("model returned HTTP %d: %s", httpResponse.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return responseBody, nil
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

func renderPollingValue(value any, taskID, credential string) any {
	switch typed := value.(type) {
	case string:
		return renderPollingString(typed, taskID, credential)
	case []any:
		items := make([]any, len(typed))
		for index, item := range typed {
			items[index] = renderPollingValue(item, taskID, credential)
		}
		return items
	case map[string]any:
		items := make(map[string]any, len(typed))
		for key, item := range typed {
			items[key] = renderPollingValue(item, taskID, credential)
		}
		return items
	default:
		return value
	}
}

func renderPollingString(value, taskID, credential string) string {
	return strings.NewReplacer("{{provider_task_id}}", taskID, "{{credential}}", credential).Replace(value)
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), target) {
			return true
		}
	}
	return false
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
	result := Response{ResultURL: lookupScalarString(payload, mapping.ResultURL), ProviderTaskID: lookupScalarString(payload, mapping.ProviderTaskID)}
	if result.ResultURL == "" && result.ProviderTaskID == "" {
		return Response{}, fmt.Errorf("model response did not contain configured result")
	}
	return result, nil
}

func lookupScalarString(value any, path string) string {
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
	switch typed := current.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	case bool:
		return strconv.FormatBool(typed)
	default:
		return ""
	}
}
