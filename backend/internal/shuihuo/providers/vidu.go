package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/models"
)

const maxViduReplyBytes = 2 << 20

type ViduTaskState = AsyncVideoState

const (
	ViduTaskRunning   = AsyncVideoRunning
	ViduTaskSucceeded = AsyncVideoSucceeded
	ViduTaskFailed    = AsyncVideoFailed
)

type ViduTask = AsyncVideoTask

// Vidu uses a server-configured HTTPS API base. It does not accept user
// supplied endpoints, request templates, or headers.
type Vidu struct {
	client      *http.Client
	credentials models.CredentialResolver
	endpoints   func(string) string
}

func NewVidu(client *http.Client, credentials models.CredentialResolver, endpoints func(string) string) *Vidu {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &Vidu{client: client, credentials: credentials, endpoints: endpoints}
}

func (p *Vidu) Submit(ctx context.Context, model models.Definition, request models.Request) (models.Response, error) {
	if model.AdapterKind != models.AdapterViduImageToVideo || model.Kind != models.KindVideo {
		return models.Response{}, fmt.Errorf("model adapter is not vidu_image_to_video")
	}
	if strings.TrimSpace(request.Prompt) == "" || strings.TrimSpace(request.ImageURL) == "" {
		return models.Response{}, fmt.Errorf("Vidu image and prompt are required")
	}
	baseURL, token, err := p.configuration(model)
	if err != nil {
		return models.Response{}, err
	}
	payload, err := json.Marshal(map[string]any{
		"model":  model.Name,
		"images": []string{strings.TrimSpace(request.ImageURL)},
		"prompt": strings.TrimSpace(request.Prompt),
	})
	if err != nil {
		return models.Response{}, fmt.Errorf("encode Vidu request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, joinViduPath(baseURL, "img2video"), bytes.NewReader(payload))
	if err != nil {
		return models.Response{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Token "+token)
	response, err := p.client.Do(httpRequest)
	if err != nil {
		return models.Response{}, fmt.Errorf("call Vidu: %w", err)
	}
	defer response.Body.Close()
	body, err := readViduResponse(response)
	if err != nil {
		return models.Response{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return models.Response{}, fmt.Errorf("Vidu returned HTTP %d", response.StatusCode)
	}
	var accepted struct {
		TaskID string `json:"task_id"`
		ID     string `json:"id"`
	}
	if err := json.Unmarshal(body, &accepted); err != nil {
		return models.Response{}, fmt.Errorf("decode Vidu submit response: %w", err)
	}
	taskID := strings.TrimSpace(accepted.TaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(accepted.ID)
	}
	if taskID == "" {
		return models.Response{}, fmt.Errorf("Vidu submit response did not contain a task ID")
	}
	return models.Response{ProviderTaskID: taskID}, nil
}

func (p *Vidu) Poll(ctx context.Context, model models.Definition, providerTaskID string) (ViduTask, error) {
	if strings.TrimSpace(providerTaskID) == "" {
		return ViduTask{}, fmt.Errorf("Vidu provider task ID is required")
	}
	baseURL, token, err := p.configuration(model)
	if err != nil {
		return ViduTask{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, joinViduPath(baseURL, "tasks", url.PathEscape(providerTaskID)), nil)
	if err != nil {
		return ViduTask{}, err
	}
	httpRequest.Header.Set("Authorization", "Token "+token)
	response, err := p.client.Do(httpRequest)
	if err != nil {
		return ViduTask{}, fmt.Errorf("poll Vidu: %w", err)
	}
	defer response.Body.Close()
	body, err := readViduResponse(response)
	if err != nil {
		return ViduTask{}, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ViduTask{}, fmt.Errorf("Vidu returned HTTP %d", response.StatusCode)
	}
	return ParseViduTask(string(body))
}

func (p *Vidu) configuration(model models.Definition) (string, string, error) {
	if p.credentials == nil {
		return "", "", fmt.Errorf("Vidu credential resolver is required")
	}
	token, err := p.credentials(model.CredentialRef)
	if err != nil || strings.TrimSpace(token) == "" {
		return "", "", fmt.Errorf("Vidu credential is not configured")
	}
	if p.endpoints == nil {
		return "", "", fmt.Errorf("Vidu endpoint resolver is required")
	}
	endpoint := strings.TrimSpace(p.endpoints(model.CredentialRef))
	parsed, err := models.ValidateOutboundURL(endpoint)
	if err != nil {
		return "", "", fmt.Errorf("Vidu endpoint must be a public HTTPS URL: %w", err)
	}
	return strings.TrimRight(parsed.String(), "/"), token, nil
}

func readViduResponse(response *http.Response) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(response.Body, maxViduReplyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read Vidu response: %w", err)
	}
	if len(body) > maxViduReplyBytes {
		return nil, fmt.Errorf("Vidu response exceeds size limit")
	}
	return body, nil
}

func joinViduPath(base string, parts ...string) string {
	parsed, _ := url.Parse(base)
	all := append([]string{strings.TrimSuffix(parsed.Path, "/")}, parts...)
	parsed.Path = path.Join(all...)
	return parsed.String()
}

func ParseViduTask(raw string) (ViduTask, error) {
	var payload struct {
		TaskID    string `json:"task_id"`
		ID        string `json:"id"`
		State     string `json:"state"`
		Status    string `json:"status"`
		Message   string `json:"message"`
		Error     string `json:"error"`
		Creations []struct {
			URL string `json:"url"`
		} `json:"creations"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ViduTask{}, fmt.Errorf("decode Vidu task response: %w", err)
	}
	id := strings.TrimSpace(payload.TaskID)
	if id == "" {
		id = strings.TrimSpace(payload.ID)
	}
	if id == "" {
		return ViduTask{}, fmt.Errorf("Vidu task response did not contain a task ID")
	}
	state := strings.ToLower(strings.TrimSpace(payload.State))
	if state == "" {
		state = strings.ToLower(strings.TrimSpace(payload.Status))
	}
	result := ViduTask{ID: id, Message: strings.TrimSpace(payload.Message)}
	if result.Message == "" {
		result.Message = strings.TrimSpace(payload.Error)
	}
	switch state {
	case "success", "succeeded", "completed", "complete":
		result.State = ViduTaskSucceeded
		if len(payload.Creations) > 0 {
			result.ResultURL = strings.TrimSpace(payload.Creations[0].URL)
		}
		if result.ResultURL == "" {
			return ViduTask{}, fmt.Errorf("Vidu completed task did not contain a result URL")
		}
		if _, err := models.ValidateOutboundURL(result.ResultURL); err != nil {
			return ViduTask{}, fmt.Errorf("validate Vidu result URL: %w", err)
		}
	case "failed", "error", "cancelled", "canceled":
		result.State = ViduTaskFailed
		if result.Message == "" {
			result.Message = "Vidu 视频生成失败"
		}
	default:
		result.State = ViduTaskRunning
	}
	return result, nil
}
