package batchfactoryv11

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type HTTPVideoAdapter struct {
	Endpoint     string
	PollEndpoint string
	APIKey       string
	Model        string
	Client       *http.Client
	ValidateURL  func(string) (*url.URL, error)
}

var _ ProductionAdapter = (*HTTPVideoAdapter)(nil)
var _ ProductionPoller = (*HTTPVideoAdapter)(nil)

type ProductionPoller interface {
	Poll(context.Context, FrozenVideoModel, ProviderTaskRef) (ProviderTaskRef, error)
}

func (a *HTTPVideoAdapter) Validate() error {
	if _, err := a.validatedURL(strings.TrimSpace(a.Endpoint)); err != nil {
		return fmt.Errorf("video provider endpoint: %w", err)
	}
	if strings.TrimSpace(a.APIKey) == "" {
		return fmt.Errorf("video provider API key is required")
	}
	if strings.TrimSpace(a.Model) == "" {
		return fmt.Errorf("video provider model is required")
	}
	if strings.TrimSpace(a.PollEndpoint) != "" {
		if _, err := a.validatedURL(strings.TrimSpace(a.PollEndpoint)); err != nil {
			return fmt.Errorf("video provider poll endpoint: %w", err)
		}
	}
	return nil
}

func validateProductionURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return nil, fmt.Errorf("must be an absolute HTTPS URL without userinfo")
	}
	return u, nil
}

func (a *HTTPVideoAdapter) validatedURL(raw string) (*url.URL, error) {
	if a.ValidateURL != nil {
		return a.ValidateURL(raw)
	}
	return validateProductionURL(raw)
}

func (a *HTTPVideoAdapter) Submit(ctx context.Context, model FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	endpoint, err := a.validatedURL(a.Endpoint)
	if err != nil {
		return ProviderTaskRef{}, fmt.Errorf("validate video endpoint: %w", err)
	}
	if strings.TrimSpace(model.ID) == "" || model.ID != a.Model {
		return ProviderTaskRef{}, fmt.Errorf("frozen video model does not match configured provider model")
	}
	values := prompt.EffectiveSettings.Values
	duration := prompt.DurationSeconds
	if duration <= 0 {
		duration = rawInt(values, "duration", 0)
	}
	if duration <= 0 {
		duration = model.MaxDuration
	}
	payload := map[string]any{
		"model":       a.Model,
		"prompt":      prompt.CompiledPrompt,
		"duration":    duration,
		"aspectRatio": rawString(values, "aspectRatio", "9:16"),
	}
	if resolution := rawString(values, "resolution", ""); resolution != "" {
		payload["resolution"] = resolution
	}
	if len(prompt.ReferenceImages) > 0 {
		referenceImages := make([]string, 0, len(prompt.ReferenceImages))
		for _, image := range prompt.ReferenceImages {
			image = strings.TrimSpace(image)
			if image == "" {
				return ProviderTaskRef{}, fmt.Errorf("video provider reference image URL is empty")
			}
			parsed, err := a.validatedURL(image)
			if err != nil {
				return ProviderTaskRef{}, fmt.Errorf("invalid video provider reference image URL: %w", err)
			}
			referenceImages = append(referenceImages, parsed.String())
		}
		payload["referenceImages"] = referenceImages
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+a.APIKey)
	response, err := a.doJSON(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	providerTaskID := firstVideoValue(response, "providerTaskId", "provider_task_id", "taskId", "task_id", "id")
	mediaURL := firstVideoValue(response, "mediaUrl", "media_url", "videoUrl", "video_url", "url")
	if mediaURL != "" {
		if _, err := a.validatedURL(mediaURL); err != nil {
			return ProviderTaskRef{}, fmt.Errorf("provider returned unsafe media URL: %w", err)
		}
		return ProviderTaskRef{ProviderTaskID: providerTaskID, State: ProductionSucceeded, MediaURL: mediaURL}, nil
	}
	if providerTaskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("video provider response did not contain a task id or media URL")
	}
	return ProviderTaskRef{ProviderTaskID: providerTaskID, State: ProductionQueued}, nil
}

func (a *HTTPVideoAdapter) Poll(ctx context.Context, _ FrozenVideoModel, task ProviderTaskRef) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	if strings.TrimSpace(task.ProviderTaskID) == "" {
		return ProviderTaskRef{}, fmt.Errorf("provider task id is required")
	}
	pollTemplate := strings.TrimSpace(a.PollEndpoint)
	if pollTemplate == "" {
		return ProviderTaskRef{}, fmt.Errorf("video provider poll endpoint is required")
	}
	rawEndpoint := strings.ReplaceAll(pollTemplate, "{id}", url.PathEscape(task.ProviderTaskID))
	endpoint, err := a.validatedURL(rawEndpoint)
	if err != nil {
		return ProviderTaskRef{}, fmt.Errorf("validate video poll endpoint: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Authorization", "Bearer "+a.APIKey)
	response, err := a.doJSON(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	status := strings.ToLower(firstVideoValue(response, "status", "state"))
	mediaURL := firstVideoValue(response, "mediaUrl", "media_url", "videoUrl", "video_url", "url")
	result := ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, MediaURL: mediaURL}
	switch status {
	case "succeeded", "success", "completed", "done":
		if mediaURL == "" {
			return ProviderTaskRef{}, fmt.Errorf("completed video response did not contain media URL")
		}
		if _, err := a.validatedURL(mediaURL); err != nil {
			return ProviderTaskRef{}, fmt.Errorf("provider returned unsafe media URL: %w", err)
		}
		result.State = ProductionSucceeded
	case "failed", "error", "cancelled", "canceled":
		result.State = ProductionFailed
	default:
		result.State = ProductionRunning
	}
	return result, nil
}

func (a *HTTPVideoAdapter) doJSON(request *http.Request) ([]byte, error) {
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("video provider request failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read video provider response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("video provider returned HTTP %d", response.StatusCode)
	}
	return body, nil
}

func firstVideoValue(raw []byte, keys ...string) string {
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	for _, object := range videoObjects(payload) {
		for _, key := range keys {
			if value, ok := object[key]; ok {
				switch typed := value.(type) {
				case string:
					if strings.TrimSpace(typed) != "" { return strings.TrimSpace(typed) }
				case float64:
					return fmt.Sprintf("%.0f", typed)
				}
			}
		}
	}
	return ""
}

func videoObjects(value any) []map[string]any {
	objects := []map[string]any{}
	if object, ok := value.(map[string]any); ok {
		objects = append(objects, object)
		for _, key := range []string{"data", "result", "task", "video"} {
			if nested, ok := object[key]; ok {
				objects = append(objects, videoObjects(nested)...)
			}
		}
	}
	return objects
}
