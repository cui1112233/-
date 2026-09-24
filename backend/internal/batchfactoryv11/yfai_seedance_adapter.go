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

type YFAISeedanceAdapter struct {
	BaseURL     string
	APIKey      string
	Model       string
	Client      *http.Client
	ValidateURL func(string) (*url.URL, error)
}

var _ ProductionAdapter = (*YFAISeedanceAdapter)(nil)
var _ ProductionPoller = (*YFAISeedanceAdapter)(nil)

func (a *YFAISeedanceAdapter) endpoint(path string) (*url.URL, error) {
	raw := strings.TrimRight(strings.TrimSpace(a.BaseURL), "/") + path
	if a.ValidateURL != nil {
		return a.ValidateURL(raw)
	}
	u, err := validateProductionURL(raw)
	if err != nil {
		return nil, err
	}
	if strings.ToLower(u.Hostname()) != "yf.token6688.com" {
		return nil, fmt.Errorf("endpoint host must be yf.token6688.com")
	}
	return u, nil
}

func (a *YFAISeedanceAdapter) Validate() error {
	if strings.TrimSpace(a.APIKey) == "" {
		return fmt.Errorf("YFAI Seedance API key is required")
	}
	if strings.TrimSpace(a.Model) == "" {
		return fmt.Errorf("YFAI Seedance model is required")
	}
	_, err := a.endpoint("/v1/media/generate")
	return err
}

func (a *YFAISeedanceAdapter) Submit(ctx context.Context, model FrozenVideoModel, prompt FinalPrompt) (ProviderTaskRef, error) {
	if err := a.Validate(); err != nil {
		return ProviderTaskRef{}, err
	}
	if model.ID != a.Model {
		return ProviderTaskRef{}, fmt.Errorf("frozen video model does not match YFAI Seedance model")
	}
	duration := int(prompt.DurationSeconds)
	if duration < 4 {
		duration = 4
	}
	if duration > 15 {
		return ProviderTaskRef{}, fmt.Errorf("Seedance duration exceeds 15 seconds")
	}
	values := prompt.EffectiveSettings.Values
	images := append([]string(nil), prompt.ReferenceImageURLs...)
	params := map[string]any{"mode": "text-to-video", "duration": strconv.Itoa(duration), "resolution": EffectiveVideoResolution(values), "aspect_ratio": EffectiveVideoAspectRatio(values), "quality": "mini", "count": 1, "return_last_frame": false}
	if len(images) > 0 {
		params["mode"] = "reference"
		params["images"] = images
	}
	payload := map[string]any{"model": a.Model, "prompt": prompt.CompiledPrompt, "params": params}
	endpoint, _ := a.endpoint("/v1/media/generate")
	reply, err := a.do(ctx, http.MethodPost, endpoint.String(), payload)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	taskID := firstVideoValue(reply, "task_id", "taskId")
	if taskID == "" {
		return ProviderTaskRef{}, fmt.Errorf("YFAI Seedance did not create a task: %s", yadiProviderFailureReason(reply))
	}
	return ProviderTaskRef{ProviderTaskID: taskID, State: ProductionQueued, RequestedDurationSeconds: float64(duration)}, nil
}

func (a *YFAISeedanceAdapter) Poll(ctx context.Context, _ FrozenVideoModel, task ProviderTaskRef) (ProviderTaskRef, error) {
	endpoint, err := a.endpoint("/v1/tasks/" + url.PathEscape(task.ProviderTaskID))
	if err != nil {
		return ProviderTaskRef{}, err
	}
	reply, err := a.do(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return ProviderTaskRef{}, err
	}
	state := strings.ToLower(firstVideoValue(reply, "status", "state"))
	result := ProviderTaskRef{ProviderTaskID: task.ProviderTaskID, State: ProductionRunning}
	if state == "failed" || state == "error" || state == "cancelled" || state == "canceled" {
		result.State = ProductionFailed
		return result, nil
	}
	if state == "completed" || state == "succeeded" || state == "success" || state == "done" {
		media := firstVideoValue(reply, "output_url", "url", "result_url")
		if media == "" {
			return result, nil
		}
		result.State, result.MediaURL = ProductionSucceeded, media
	}
	return result, nil
}

func (a *YFAISeedanceAdapter) do(ctx context.Context, method, endpoint string, payload any) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.APIKey)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("YFAI Seedance request failed")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("YFAI Seedance returned HTTP %d", resp.StatusCode)
	}
	return data, nil
}
