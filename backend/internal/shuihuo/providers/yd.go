package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/models"
)

const (
	ydModelName       = "yd2.0-mini"
	ydCreateEndpoint  = "https://ydapi.yadiai.cn/openapi/v1/video/create"
	ydStatusEndpoint  = "https://ydapi.yadiai.cn/openapi/v1/video/tasks"
	ydEmptyImageURL   = "https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png"
	maxYDReplyBytes   = 2 << 20
	maxYDMessageBytes = 1024
)

// YD is the fixed YD asynchronous image-to-video adapter. Endpoint and
// request shape are intentionally not configurable through the model row.
type YD struct {
	client      *http.Client
	credentials models.CredentialResolver
	resolver    models.IPResolver
}

func NewYD(client *http.Client, credentials models.CredentialResolver) *YD {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &YD{client: client, credentials: credentials, resolver: net.DefaultResolver}
}

func (p *YD) Submit(ctx context.Context, model models.Definition, request models.Request) (models.Response, error) {
	if model.Kind != models.KindVideo || model.AdapterKind != models.AdapterYDVideo {
		return models.Response{}, fmt.Errorf("model adapter is not yd_video")
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return models.Response{}, fmt.Errorf("YD prompt is required")
	}
	sceneURL := strings.TrimSpace(request.ImageURL)
	if sceneURL == "" {
		return models.Response{}, fmt.Errorf("YD scene image is required")
	}
	aspectRatio := strings.TrimSpace(request.AspectRatio)
	if aspectRatio != "9:16" && aspectRatio != "16:9" {
		return models.Response{}, fmt.Errorf("YD aspect ratio must be 9:16 or 16:9")
	}
	if len(request.ReferenceImageURLs) > 3 {
		return models.Response{}, fmt.Errorf("YD accepts at most 3 reference images")
	}
	if err := p.validateURL(ctx, "YD endpoint", ydCreateEndpoint); err != nil {
		return models.Response{}, err
	}
	if err := p.validateURL(ctx, "YD empty image URL", ydEmptyImageURL); err != nil {
		return models.Response{}, err
	}
	if err := p.validateURL(ctx, "YD scene image URL", sceneURL); err != nil {
		return models.Response{}, err
	}
	images := make([]string, 0, len(request.ReferenceImageURLs)+2)
	images = append(images, ydEmptyImageURL)
	for index, rawURL := range request.ReferenceImageURLs {
		imageURL := strings.TrimSpace(rawURL)
		if err := p.validateURL(ctx, fmt.Sprintf("YD reference image URL %d", index+1), imageURL); err != nil {
			return models.Response{}, err
		}
		images = append(images, imageURL)
	}
	images = append(images, sceneURL)
	token, err := p.credential(model)
	if err != nil {
		return models.Response{}, err
	}
	payload, err := json.Marshal(struct {
		Model       string   `json:"model"`
		Prompt      string   `json:"prompt"`
		ImageURLs   []string `json:"image_urls"`
		Duration    string   `json:"duration"`
		AspectRatio string   `json:"aspect_ratio"`
		Resolution  string   `json:"resolution"`
	}{Model: ydModelName, Prompt: prompt, ImageURLs: images, Duration: "1", AspectRatio: aspectRatio, Resolution: "720p"})
	if err != nil {
		return models.Response{}, fmt.Errorf("encode YD request")
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, ydCreateEndpoint, bytes.NewReader(payload))
	if err != nil {
		return models.Response{}, fmt.Errorf("create YD request")
	}
	setYDAuth(httpRequest, token)
	response, err := p.client.Do(httpRequest)
	if err != nil {
		return models.Response{}, fmt.Errorf("call YD: %w", err)
	}
	defer response.Body.Close()
	body, err := readYDResponse(response)
	if err != nil {
		return models.Response{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return models.Response{}, fmt.Errorf("YD returned HTTP %d", response.StatusCode)
	}
	taskID, err := decodeYDTaskID(body)
	if err != nil {
		return models.Response{}, err
	}
	return models.Response{ProviderTaskID: taskID}, nil
}

func (p *YD) Poll(ctx context.Context, model models.Definition, providerTaskID string) (AsyncVideoTask, error) {
	if model.Kind != models.KindVideo || model.AdapterKind != models.AdapterYDVideo {
		return AsyncVideoTask{}, fmt.Errorf("model adapter is not yd_video")
	}
	providerTaskID = strings.TrimSpace(providerTaskID)
	if providerTaskID == "" {
		return AsyncVideoTask{}, fmt.Errorf("YD provider task ID is required")
	}
	if err := p.validateURL(ctx, "YD status endpoint", ydStatusEndpoint); err != nil {
		return AsyncVideoTask{}, err
	}
	token, err := p.credential(model)
	if err != nil {
		return AsyncVideoTask{}, err
	}
	statusURL := ydStatusEndpoint + "/" + url.PathEscape(providerTaskID)
	if err := p.validateURL(ctx, "YD status URL", statusURL); err != nil {
		return AsyncVideoTask{}, err
	}
	statusBody, err := p.get(ctx, statusURL, token)
	if err != nil {
		return AsyncVideoTask{}, err
	}
	var status struct {
		Status       string `json:"status"`
		State        string `json:"state"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := json.Unmarshal(statusBody, &status); err != nil {
		return AsyncVideoTask{}, fmt.Errorf("decode YD status response")
	}
	state := strings.ToUpper(strings.TrimSpace(status.Status))
	if state == "" {
		state = strings.ToUpper(strings.TrimSpace(status.State))
	}
	switch state {
	case "QUEUED", "SUBMITTED", "RUNNING":
		return AsyncVideoTask{ID: providerTaskID, State: AsyncVideoRunning}, nil
	case "FAILED":
		return AsyncVideoTask{ID: providerTaskID, State: AsyncVideoFailed, Message: safeYDMessage(status.ErrorMessage, token)}, nil
	case "SUCCESS":
		resultEndpoint := ydStatusEndpoint + "/" + url.PathEscape(providerTaskID) + "/result"
		if err := p.validateURL(ctx, "YD result endpoint", resultEndpoint); err != nil {
			return AsyncVideoTask{}, err
		}
		resultBody, err := p.get(ctx, resultEndpoint, token)
		if err != nil {
			return AsyncVideoTask{}, err
		}
		resultURL, err := p.decodeResultURL(ctx, resultBody)
		if err != nil {
			return AsyncVideoTask{}, err
		}
		return AsyncVideoTask{ID: providerTaskID, State: AsyncVideoSucceeded, ResultURL: resultURL}, nil
	default:
		return AsyncVideoTask{}, fmt.Errorf("YD returned unknown task status")
	}
}

func (p *YD) get(ctx context.Context, endpoint, token string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create YD request")
	}
	setYDAuth(request, token)
	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call YD: %w", err)
	}
	defer response.Body.Close()
	body, err := readYDResponse(response)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("YD returned HTTP %d", response.StatusCode)
	}
	return body, nil
}

func (p *YD) credential(model models.Definition) (string, error) {
	if p.credentials == nil {
		return "", fmt.Errorf("YD credential resolver is required")
	}
	token, err := p.credentials(model.CredentialRef)
	if err != nil || strings.TrimSpace(token) == "" {
		return "", fmt.Errorf("YD credential is not configured")
	}
	return strings.TrimSpace(token), nil
}

func setYDAuth(request *http.Request, token string) {
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
}

func (p *YD) validateURL(ctx context.Context, label, raw string) error {
	resolver := p.resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	if _, err := models.ValidateOutboundURLWithResolver(ctx, raw, resolver); err != nil {
		return fmt.Errorf("validate %s: %w", label, err)
	}
	return nil
}

func readYDResponse(response *http.Response) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(response.Body, maxYDReplyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read YD response")
	}
	if len(body) > maxYDReplyBytes {
		return nil, fmt.Errorf("YD response exceeds size limit")
	}
	return body, nil
}

func decodeYDTaskID(body []byte) (string, error) {
	var payload struct {
		TaskIDSnake string `json:"task_id"`
		TaskID      string `json:"taskId"`
		ID          string `json:"id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("decode YD submit response")
	}
	for _, candidate := range []string{payload.TaskID, payload.TaskIDSnake, payload.ID} {
		if taskID := strings.TrimSpace(candidate); taskID != "" {
			return taskID, nil
		}
	}
	return "", fmt.Errorf("YD submit response did not contain a task ID")
}

func (p *YD) decodeResultURL(ctx context.Context, body []byte) (string, error) {
	var payload struct {
		URLs    []string `json:"urls"`
		Outputs []struct {
			URL string `json:"url"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("decode YD result response")
	}
	candidates := make([]string, 0, len(payload.URLs)+len(payload.Outputs))
	candidates = append(candidates, payload.URLs...)
	for _, output := range payload.Outputs {
		candidates = append(candidates, output.URL)
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if err := p.validateURL(ctx, "YD result URL", candidate); err == nil {
			return candidate, nil
		} else if ctx.Err() != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("YD result response did not contain a valid HTTPS URL")
}

func safeYDMessage(message, token string) string {
	message = strings.TrimSpace(message)
	if token != "" {
		message = strings.ReplaceAll(message, token, "[redacted]")
	}
	if len(message) > maxYDMessageBytes {
		message = message[:maxYDMessageBytes]
	}
	return message
}
