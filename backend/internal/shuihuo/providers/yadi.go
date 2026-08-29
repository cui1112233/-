package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/models"
)

const maxYadiReplyBytes = 4 << 20

type YadiCredentialStore interface {
	Get(context.Context, int64, string) (string, error)
}

type Yadi struct {
	client      *http.Client
	credentials YadiCredentialStore
	validateURL func(string) (*url.URL, error)
}

func NewYadi(client *http.Client, credentials YadiCredentialStore) *Yadi {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &Yadi{client: client, credentials: credentials, validateURL: models.ValidateOutboundURL}
}

func (p *Yadi) Submit(ctx context.Context, model models.Definition, request models.Request) (models.Response, error) {
	if model.AdapterKind != models.AdapterYadiVideo || model.Kind != models.KindVideo {
		return models.Response{}, fmt.Errorf("model adapter is not yadi_video")
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return models.Response{}, errors.New("Yadi prompt is required")
	}
	endpoint, credential, err := p.configuration(ctx, model)
	if err != nil {
		return models.Response{}, err
	}
	upstreamModel, resolution, err := yadiPublicParameters(model)
	if err != nil {
		return models.Response{}, err
	}
	duration := strings.TrimSpace(request.Duration)
	if duration == "" {
		duration = "10"
	}
	aspectRatio := strings.TrimSpace(request.AspectRatio)
	if aspectRatio == "" {
		aspectRatio = "9:16"
	}
	imageURLs := []string{}
	if strings.TrimSpace(request.ImageURL) != "" {
		imageURLs = append(imageURLs, strings.TrimSpace(request.ImageURL))
	}
	payload, err := json.Marshal(map[string]any{
		"model":        upstreamModel,
		"prompt":       strings.TrimSpace(request.Prompt),
		"duration":     duration,
		"resolution":   resolution,
		"aspect_ratio": aspectRatio,
		"image_urls":   imageURLs,
		"video_urls":   []string{},
		"audio_urls":   []string{},
	})
	if err != nil {
		return models.Response{}, fmt.Errorf("encode Yadi request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return models.Response{}, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+credential)
	httpRequest.Header.Set("Content-Type", "application/json")
	body, err := p.do(httpRequest)
	if err != nil {
		return models.Response{}, err
	}
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return models.Response{}, fmt.Errorf("decode Yadi create response: %w", err)
	}
	taskID := firstScalarPath(decoded,
		"taskId", "task_id", "data.taskId", "data.task_id", "result.taskId", "result.task_id", "id", "data.id",
	)
	if taskID == "" {
		return models.Response{}, errors.New("Yadi create response did not contain taskId")
	}
	return models.Response{ProviderTaskID: taskID}, nil
}

// Poll returns the same normalized task shape used by the existing async video
// poller. Yadi's documented result endpoint is derived from the configured
// create endpoint so the host remains centrally controlled by the model row.
func (p *Yadi) Poll(ctx context.Context, model models.Definition, providerTaskID string) (ViduTask, error) {
	if model.AdapterKind != models.AdapterYadiVideo || model.Kind != models.KindVideo {
		return ViduTask{}, fmt.Errorf("model adapter is not yadi_video")
	}
	providerTaskID = strings.TrimSpace(providerTaskID)
	if providerTaskID == "" {
		return ViduTask{}, errors.New("Yadi provider task ID is required")
	}
	endpoint, credential, err := p.configuration(ctx, model)
	if err != nil {
		return ViduTask{}, err
	}
	pollURL := *endpoint
	pollURL.Path = path.Join(path.Dir(endpoint.Path), "tasks", url.PathEscape(providerTaskID), "result")
	pollURL.RawPath = ""
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, pollURL.String(), nil)
	if err != nil {
		return ViduTask{}, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+credential)
	body, err := p.do(httpRequest)
	if err != nil {
		return ViduTask{}, err
	}
	return ParseYadiTask(providerTaskID, body)
}

func (p *Yadi) configuration(ctx context.Context, model models.Definition) (*url.URL, string, error) {
	validator := p.validateURL
	if validator == nil {
		validator = models.ValidateOutboundURL
	}
	endpoint, err := validator(model.Endpoint)
	if err != nil {
		return nil, "", fmt.Errorf("Yadi endpoint must be a public HTTPS URL: %w", err)
	}
	if !strings.EqualFold(endpoint.Hostname(), "ydapi.yadiai.cn") {
		return nil, "", errors.New("Yadi endpoint must use ydapi.yadiai.cn")
	}
	userID, ok := models.UserIDFromContext(ctx)
	if !ok {
		return nil, "", errors.New("Yadi task owner is unavailable")
	}
	if p.credentials == nil {
		return nil, "", errors.New("Yadi user credential store is unavailable")
	}
	credential, err := p.credentials.Get(ctx, userID, model.CredentialRef)
	if err != nil || strings.TrimSpace(credential) == "" {
		return nil, "", errors.New("请先在个人中心配置 Yadi 视频生成 API Key")
	}
	return endpoint, strings.TrimSpace(credential), nil
}

func (p *Yadi) do(request *http.Request) ([]byte, error) {
	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call Yadi: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxYadiReplyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read Yadi response: %w", err)
	}
	if len(body) > maxYadiReplyBytes {
		return nil, errors.New("Yadi response exceeds size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Yadi returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func yadiPublicParameters(model models.Definition) (string, string, error) {
	var parameters struct {
		UpstreamModel     string `json:"upstreamModel"`
		DefaultResolution string `json:"defaultResolution"`
	}
	if strings.TrimSpace(model.ParameterSchema) != "" {
		if err := json.Unmarshal([]byte(model.ParameterSchema), &parameters); err != nil {
			return "", "", fmt.Errorf("decode Yadi model parameters: %w", err)
		}
	}
	parameters.UpstreamModel = strings.TrimSpace(parameters.UpstreamModel)
	if parameters.UpstreamModel == "" {
		return "", "", errors.New("Yadi upstream model is not configured")
	}
	parameters.DefaultResolution = strings.TrimSpace(parameters.DefaultResolution)
	if parameters.DefaultResolution == "" {
		parameters.DefaultResolution = "720p"
	}
	return parameters.UpstreamModel, parameters.DefaultResolution, nil
}

func ParseYadiTask(providerTaskID string, raw []byte) (ViduTask, error) {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ViduTask{}, fmt.Errorf("decode Yadi task response: %w", err)
	}
	status := strings.ToLower(firstScalarPath(payload,
		"status", "state", "data.status", "data.state", "result.status", "result.state", "task.status", "task.state",
	))
	result := ViduTask{ID: providerTaskID}
	result.Message = firstScalarPath(payload,
		"message", "error", "error.message", "data.message", "data.error", "result.message", "result.error",
	)
	switch status {
	case "success", "succeeded", "completed", "complete", "done", "finished":
		result.State = ViduTaskSucceeded
		result.ResultURL = firstURLValue(payload)
		if result.ResultURL == "" {
			return ViduTask{}, errors.New("Yadi completed task did not contain a video URL")
		}
		if _, err := models.ValidateOutboundURL(result.ResultURL); err != nil {
			return ViduTask{}, fmt.Errorf("validate Yadi result URL: %w", err)
		}
	case "failed", "failure", "error", "cancelled", "canceled", "rejected":
		result.State = ViduTaskFailed
		if result.Message == "" {
			result.Message = "Yadi 视频生成失败"
		}
	case "", "pending", "queued", "created", "processing", "running", "in_progress", "submitted":
		result.State = ViduTaskRunning
	default:
		// Unknown non-final values are treated as running so a provider adding a
		// new intermediate state does not destroy a paid generation task.
		result.State = ViduTaskRunning
	}
	return result, nil
}

func firstScalarPath(payload any, paths ...string) string {
	for _, candidate := range paths {
		if value := scalarAtPath(payload, candidate); value != "" {
			return value
		}
	}
	return ""
}

func scalarAtPath(payload any, dotted string) string {
	current := payload
	for _, token := range strings.Split(dotted, ".") {
		switch typed := current.(type) {
		case map[string]any:
			value, ok := typed[token]
			if !ok {
				return ""
			}
			current = value
		case []any:
			index, err := strconv.Atoi(token)
			if err != nil || index < 0 || index >= len(typed) {
				return ""
			}
			current = typed[index]
		default:
			return ""
		}
	}
	switch typed := current.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func firstURLValue(payload any) string {
	preferred := []string{
		"videoUrl", "video_url", "resultUrl", "result_url", "url",
		"data.videoUrl", "data.video_url", "data.resultUrl", "data.result_url", "data.url",
		"result.videoUrl", "result.video_url", "result.resultUrl", "result.result_url", "result.url",
		"data.result.videoUrl", "data.result.video_url", "data.result.url",
		"videos.0.url", "data.videos.0.url", "result.videos.0.url", "data.result.videos.0.url",
	}
	if value := firstScalarPath(payload, preferred...); strings.HasPrefix(value, "https://") {
		return value
	}
	return recursiveURL(payload)
}

func recursiveURL(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"videoUrl", "video_url", "resultUrl", "result_url", "url"} {
			if raw, ok := typed[key].(string); ok && strings.HasPrefix(strings.TrimSpace(raw), "https://") {
				return strings.TrimSpace(raw)
			}
		}
		for _, child := range typed {
			if result := recursiveURL(child); result != "" {
				return result
			}
		}
	case []any:
		for _, child := range typed {
			if result := recursiveURL(child); result != "" {
				return result
			}
		}
	}
	return ""
}
