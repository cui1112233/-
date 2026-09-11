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

const (
	AutoDLH3Model              = "minimax-h3-video"
	AutoDLH3NoImageWorkflow    = "minimax_h3_lightx2v_no_pic"
	AutoDLH3ReferenceWorkflow  = "minimax_h3_lightx2v_v5_15s"
	DefaultAutoDLH3CreateURL   = "https://autodl.art/api/v1/comfyui/comfyui_workflow/{workflow}"
	DefaultAutoDLH3TasksURL    = "https://autodl.art/api/v1/comfyui/comfyui_workflow/result/{id}"
	MaxAutoDLH3ReferenceImages = 9
)

// AutoDLH3VideoAdapter implements the two-step ComfyUI workflow API. The
// provider token stays server-side and is deliberately sent as the raw
// Authorization value, matching AutoDL.Art's API contract.
type AutoDLH3VideoAdapter struct {
	CreateURL   string
	TasksURL    string
	APIKey      string
	Model       string
	Client      *http.Client
	ValidateURL func(string) (*url.URL, error)
}

var _ ProductionAdapter = (*AutoDLH3VideoAdapter)(nil)
var _ ProductionPoller = (*AutoDLH3VideoAdapter)(nil)

func (a *AutoDLH3VideoAdapter) Validate() error {
	if _, err := a.validateTemplate(a.CreateURL, "{workflow}"); err != nil {
		return fmt.Errorf("AutoDL H3 create endpoint: %w", err)
	}
	if _, err := a.validateTemplate(a.TasksURL, "{id}"); err != nil {
		return fmt.Errorf("AutoDL H3 result endpoint: %w", err)
	}
	if strings.TrimSpace(a.APIKey) == "" {
		return fmt.Errorf("AutoDL H3 API key is required")
	}
	if strings.TrimSpace(a.Model) == "" {
		return fmt.Errorf("AutoDL H3 model is required")
	}
	return nil
}

func (a *AutoDLH3VideoAdapter) validatedURL(raw string) (*url.URL, error) {
	if a.ValidateURL != nil {
		return a.ValidateURL(raw)
	}
	return validateProductionURL(raw)
}

func (a *AutoDLH3VideoAdapter) validateTemplate(raw, placeholder string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("endpoint is required")
	}
	if !strings.Contains(raw, placeholder) {
		return nil, fmt.Errorf("endpoint must contain %s", placeholder)
	}
	testValue := strings.Replace(raw, placeholder, "placeholder", 1)
	u, err := a.validatedURL(testValue)
	if err != nil {
		return nil, err
	}
	if a.ValidateURL == nil && strings.ToLower(u.Hostname()) != "autodl.art" {
		return nil, fmt.Errorf("endpoint host must be autodl.art")
	}
	return u, nil
}

func (a *AutoDLH3VideoAdapter) Submit(ctx context.Context, model FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	if strings.TrimSpace(model.ID) == "" || model.ID != a.Model {
		return ProviderTaskRef{}, fmt.Errorf("frozen video model does not match AutoDL H3 model")
	}
	values := prompt.EffectiveSettings.Values
	duration := prompt.DurationSeconds
	if duration <= 0 {
		duration = rawInt(values, "duration", 0)
	}
	if duration <= 0 {
		duration = model.MaxDuration
	}
	if duration <= 0 {
		duration = 5
	}
	if model.MaxDuration > 0 && duration > model.MaxDuration {
		return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 duration exceeds model maximum")
	}
	resolution := rawString(values, "resolution", "480p竖")
	images := rawStrings(values, "imageUrls")
	if len(images) == 0 {
		images = rawStrings(values, "referenceImages")
	}
	if len(images) > MaxAutoDLH3ReferenceImages {
		return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 supports at most %d reference images", MaxAutoDLH3ReferenceImages)
	}
	for index, image := range images {
		image = strings.TrimSpace(image)
		if image == "" {
			return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 reference image %d is empty", index)
		}
		parsed, err := a.validatedURL(image)
		if err != nil {
			return ProviderTaskRef{}, fmt.Errorf("invalid AutoDL H3 reference image: %w", err)
		}
		images[index] = parsed.String()
	}
	workflow := AutoDLH3NoImageWorkflow
	if len(images) > 0 {
		workflow = AutoDLH3ReferenceWorkflow
	}
	payload := map[string]any{
		"prompt":     prompt.CompiledPrompt,
		"duration":   duration,
		"resolution": resolution,
	}
	for index, image := range images {
		payload[fmt.Sprintf("ref_image_%d", index)] = image
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	endpoint, err := a.validatedURL(strings.ReplaceAll(a.CreateURL, "{workflow}", workflow))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", strings.TrimSpace(a.APIKey))
	reply, err := a.doJSON(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	taskID := firstVideoValue(reply, "task_id", "taskId", "id")
	if taskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 response did not contain a task id")
	}
	return ProviderTaskRef{ProviderTaskID: taskID, State: autoDLH3State(firstVideoValue(reply, "status", "state"))}, nil
}

func (a *AutoDLH3VideoAdapter) Poll(ctx context.Context, _ FrozenVideoModel, task ProviderTaskRef) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	taskID := strings.TrimSpace(task.ProviderTaskID)
	if taskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 task id is required")
	}
	endpoint, err := a.validatedURL(strings.ReplaceAll(a.TasksURL, "{id}", url.PathEscape(taskID)))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", strings.TrimSpace(a.APIKey))
	reply, err := a.doJSON(request)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	state := autoDLH3State(firstVideoValue(reply, "status", "state"))
	result := ProviderTaskRef{ProviderTaskID: taskID, State: state}
	if state == ProductionSucceeded {
		mediaURL := autoDLH3MediaURL(reply)
		if mediaURL == "" {
			return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 completed response did not contain a media URL")
		}
		if _, err := a.validatedURL(mediaURL); err != nil {
			return ProviderTaskRef{}, fmt.Errorf("AutoDL H3 returned unsafe media URL: %w", err)
		}
		result.MediaURL = mediaURL
	}
	return result, nil
}

func autoDLH3State(value string) ProductionState {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "SUCCESS", "SUCCEEDED", "COMPLETED", "DONE":
		return ProductionSucceeded
	case "FAILED", "ERROR", "CANCELLED", "CANCELED":
		return ProductionFailed
	case "QUEUED", "SUBMITTED", "PENDING":
		return ProductionQueued
	default:
		return ProductionRunning
	}
}

func autoDLH3MediaURL(raw []byte) string {
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		return ""
	}
	for _, object := range videoObjects(payload) {
		if results, ok := object["results"].([]any); ok {
			for _, result := range results {
				if value, ok := result.(string); ok && strings.TrimSpace(value) != "" {
					return strings.TrimSpace(value)
				}
				if resultObject, ok := result.(map[string]any); ok {
					for _, key := range []string{"url", "video_url", "videoUrl", "media_url", "mediaUrl"} {
						if value, ok := resultObject[key].(string); ok && strings.TrimSpace(value) != "" {
							return strings.TrimSpace(value)
						}
					}
				}
			}
		}
	}
	return firstVideoValue(raw, "url", "video_url", "videoUrl", "media_url", "mediaUrl")
}

func (a *AutoDLH3VideoAdapter) doJSON(request *http.Request) ([]byte, error) {
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("AutoDL H3 provider request failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read AutoDL H3 provider response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("AutoDL H3 provider returned HTTP %d", response.StatusCode)
	}
	return body, nil
}
