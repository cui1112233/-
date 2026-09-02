package batchfactoryv11

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

const defaultYadiFirstFrameURL = "https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png"

type YadiVideoAdapter struct {
	CreateURL  string
	TasksURL   string
	ResultURL  string
	APIKey     string
	Model      string
	Client     *http.Client
	ValidateURL func(string) (*url.URL, error)
}

var _ ProductionAdapter = (*YadiVideoAdapter)(nil)
var _ ProductionPoller = (*YadiVideoAdapter)(nil)

func (a *YadiVideoAdapter) Validate() error {
	if _, err := a.validatedURL(strings.TrimSpace(a.CreateURL)); err != nil {
		return fmt.Errorf("personal video create endpoint: %w", err)
	}
	if _, err := a.validatedURL(strings.TrimSpace(a.TasksURL)); err != nil {
		return fmt.Errorf("personal video tasks endpoint: %w", err)
	}
	if _, err := a.validatedURL(strings.TrimSpace(a.ResultURL)); err != nil {
		return fmt.Errorf("personal video result endpoint: %w", err)
	}
	if strings.TrimSpace(a.APIKey) == "" {
		return fmt.Errorf("personal video API key is required")
	}
	if strings.TrimSpace(a.Model) == "" {
		return fmt.Errorf("personal video model is required")
	}
	return nil
}

func (a *YadiVideoAdapter) validatedURL(raw string) (*url.URL, error) {
	if a.ValidateURL != nil {
		return a.ValidateURL(raw)
	}
	return validateProductionURL(raw)
}

func (a *YadiVideoAdapter) Submit(ctx context.Context, model FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	if strings.TrimSpace(model.ID) == "" || model.ID != a.Model {
		return ProviderTaskRef{}, fmt.Errorf("frozen video model does not match personal video model")
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
		return ProviderTaskRef{}, fmt.Errorf("video duration is required")
	}
	aspectRatio := rawString(values, "aspectRatio", "9:16")
	resolution := rawString(values, "resolution", "720p")
	imageURLs := []string{defaultYadiFirstFrameURL}
	if raw := values["imageUrls"]; len(raw) > 0 {
		var extra []string
		if json.Unmarshal(raw, &extra) == nil {
			if len(extra) > 3 {
				return ProviderTaskRef{}, fmt.Errorf("personal video supports at most 3 reference images")
			}
			for _, item := range extra {
				item = strings.TrimSpace(item)
				if item == "" {
					return ProviderTaskRef{}, fmt.Errorf("personal video reference image URL is empty")
				}
				parsed, err := a.validatedURL(item)
				if err != nil {
					return ProviderTaskRef{}, fmt.Errorf("invalid personal video reference image URL: %w", err)
				}
				imageURLs = append(imageURLs, parsed.String())
			}
		}
	}
	payload := map[string]any{
		"model":        a.Model,
		"prompt":       prompt.CompiledPrompt,
		"image_urls":   imageURLs,
		"duration":     strconv.Itoa(duration),
		"aspect_ratio": aspectRatio,
		"resolution":   resolution,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	endpoint, err := a.validatedURL(a.CreateURL)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.APIKey)
	reply, err := a.doJSON(req)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	taskID := firstVideoValue(reply, "task_id", "taskId", "id", "providerTaskId", "provider_task_id")
	if taskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("personal video response did not contain a task id")
	}
	return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionQueued}, nil
}

func (a *YadiVideoAdapter) Poll(ctx context.Context, _ FrozenVideoModel, task ProviderTaskRef) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	taskID := strings.TrimSpace(task.ProviderTaskID)
	if taskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("personal video task id is required")
	}
	tasksBase, err := a.validatedURL(strings.TrimRight(a.TasksURL, "/") + "/" + url.PathEscape(taskID))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tasksBase.String(), nil)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	req.Header.Set("Authorization", "Bearer "+a.APIKey)
	reply, err := a.doJSON(req)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	state := strings.ToUpper(firstVideoValue(reply, "status", "state"))
	switch state {
	case "QUEUED", "SUBMITTED", "RUNNING", "PENDING", "PROCESSING", "GENERATING":
		return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionRunning}, nil
	case "FAILED", "ERROR", "CANCELLED", "CANCELED":
		return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionFailed}, nil
	case "SUCCESS", "SUCCEEDED", "COMPLETED", "DONE":
		resultURL := strings.ReplaceAll(a.ResultURL, "{id}", url.PathEscape(taskID))
		resultEndpoint, err := a.validatedURL(resultURL)
		if err != nil {
			return ProviderTaskRef{}, err
		}
		resultReq, err := http.NewRequestWithContext(ctx, http.MethodGet, resultEndpoint.String(), nil)
		if err != nil {
			return ProviderTaskRef{}, err
		}
		resultReq.Header.Set("Authorization", "Bearer "+a.APIKey)
		resultReply, err := a.doJSON(resultReq)
		if err != nil {
			return ProviderTaskRef{}, err
		}
		mediaURL := firstVideoValue(resultReply, "url", "video_url", "videoUrl", "mediaUrl", "media_url")
		if _, err := a.validatedURL(mediaURL); err != nil {
			return ProviderTaskRef{}, fmt.Errorf("personal video returned unsafe media URL: %w", err)
		}
		return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionSucceeded, MediaURL: mediaURL}, nil
	default:
		return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionRunning}, nil
	}
}

func (a *YadiVideoAdapter) doJSON(req *http.Request) ([]byte, error) {
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("personal video provider request failed")
	}
	defer resp.Body.Close()
	body := make([]byte, 0, 4096)
	buf := make([]byte, 32<<10)
	for len(body) < 8<<20 {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			body = append(body, buf[:n]...)
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, fmt.Errorf("read personal video provider response")
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("personal video provider returned HTTP %d", resp.StatusCode)
	}
	return body, nil
}
