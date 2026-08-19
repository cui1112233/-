package providers

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

	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/segmentation"
)

const maxTextCompletionResponseBytes = 2 << 20

// TextCompletion is a narrow server-side adapter. The browser never supplies
// its endpoint, credentials, or prompt preset.
type TextCompletion struct {
	client      *http.Client
	credentials models.CredentialResolver
	validateURL func(string) (*url.URL, error)
}

func NewTextCompletion(client *http.Client, credentials models.CredentialResolver) *TextCompletion {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &TextCompletion{client: client, credentials: credentials, validateURL: models.ValidateOutboundURL}
}

func (p *TextCompletion) Complete(ctx context.Context, model models.Definition, renderedPrompt string) (string, error) {
	if model.AdapterKind != models.AdapterTextCompletion {
		return "", fmt.Errorf("model adapter is not text_completion")
	}
	if strings.TrimSpace(renderedPrompt) == "" {
		return "", fmt.Errorf("rendered prompt is required")
	}
	validateURL := p.validateURL
	if validateURL == nil {
		validateURL = models.ValidateOutboundURL
	}
	endpoint, err := validateURL(model.Endpoint)
	if err != nil {
		return "", fmt.Errorf("validate text model endpoint: %w", err)
	}
	if p.credentials == nil {
		return "", fmt.Errorf("credential resolver is required")
	}
	credential, err := p.credentials(model.CredentialRef)
	if err != nil || strings.TrimSpace(credential) == "" {
		return "", fmt.Errorf("resolve text model credential")
	}
	upstreamModel, err := textUpstreamModel(model)
	if err != nil {
		return "", err
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/")
	if !strings.HasSuffix(strings.ToLower(endpoint.Path), "/chat/completions") {
		endpoint.Path += "/chat/completions"
	}
	endpoint.RawPath = ""
	body, err := json.Marshal(map[string]any{
		"model":       upstreamModel,
		"messages":    []map[string]string{{"role": "user", "content": renderedPrompt}},
		"temperature": 0.2,
	})
	if err != nil {
		return "", fmt.Errorf("encode text model request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+credential)
	response, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("call text model: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxTextCompletionResponseBytes+1))
	if err != nil {
		return "", fmt.Errorf("read text model response: %w", err)
	}
	if len(payload) > maxTextCompletionResponseBytes {
		return "", fmt.Errorf("text model response exceeds size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("text model returned HTTP %d", response.StatusCode)
	}
	return ExtractTextCompletion(payload)
}

func textUpstreamModel(model models.Definition) (string, error) {
	upstream := strings.TrimSpace(model.Name)
	if known, ok := map[string]string{"GPT-4o 文本模型": "gpt-4o"}[upstream]; ok {
		upstream = known
	}
	if strings.TrimSpace(model.ParameterSchema) != "" {
		var schema struct {
			UpstreamModel string `json:"upstreamModel"`
		}
		if err := json.Unmarshal([]byte(model.ParameterSchema), &schema); err != nil {
			return "", fmt.Errorf("decode text model parameter schema: %w", err)
		}
		if strings.TrimSpace(schema.UpstreamModel) != "" {
			upstream = strings.TrimSpace(schema.UpstreamModel)
		}
	}
	if upstream == "" {
		return "", fmt.Errorf("text model upstream name is required")
	}
	return upstream, nil
}

func ExtractTextCompletion(payload []byte) (string, error) {
	text := strings.TrimSpace(string(payload))
	if strings.HasPrefix(text, "[") {
		return text, nil
	}
	var envelope struct {
		Text    string `json:"text"`
		Output  string `json:"output"`
		Content string `json:"content"`
		Choices []struct {
			Text    string `json:"text"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", fmt.Errorf("decode text model response: %w", err)
	}
	for _, value := range []string{envelope.Text, envelope.Output, envelope.Content} {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), nil
		}
	}
	if len(envelope.Choices) > 0 {
		if value := strings.TrimSpace(envelope.Choices[0].Message.Content); value != "" {
			return value, nil
		}
		if value := strings.TrimSpace(envelope.Choices[0].Text); value != "" {
			return value, nil
		}
	}
	return "", fmt.Errorf("text model response did not contain text")
}

func ParseSegmentCandidates(raw string) ([]segmentation.CandidateSegment, error) {
	var candidates []segmentation.CandidateSegment
	if err := json.Unmarshal([]byte(raw), &candidates); err != nil {
		return nil, fmt.Errorf("segment candidates must be a JSON array: %w", err)
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("segment candidates cannot be empty")
	}
	for index := range candidates {
		candidates[index].Text = strings.TrimSpace(candidates[index].Text)
		if candidates[index].Text == "" {
			return nil, fmt.Errorf("segment candidate %d text is required", index+1)
		}
		candidates[index].Speaker = strings.TrimSpace(candidates[index].Speaker)
		if candidates[index].Speaker == "" {
			candidates[index].Speaker = "旁白"
		}
	}
	return candidates, nil
}

type AssetCandidate struct {
	Category string `json:"category"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
}

type AssetPlan struct {
	Assets   []AssetPlanAsset   `json:"assets"`
	Bindings []AssetPlanBinding `json:"bindings"`
}

type AssetPlanAsset struct {
	Key string `json:"key"`
	AssetCandidate
}

type AssetPlanBinding struct {
	SegmentID int64    `json:"segmentId"`
	SceneMode string   `json:"sceneMode"`
	AssetKeys []string `json:"assetKeys"`
}

func ParseAssetPlan(raw string) (AssetPlan, error) {
	var plan AssetPlan
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &plan); err != nil {
		return AssetPlan{}, fmt.Errorf("asset plan must be a JSON object: %w", err)
	}
	assetsRaw, err := json.Marshal(plan.Assets)
	if err != nil {
		return AssetPlan{}, err
	}
	assets, err := ParseAssetCandidates(string(assetsRaw))
	if err != nil {
		return AssetPlan{}, err
	}
	keys := make(map[string]struct{}, len(plan.Assets))
	for index := range plan.Assets {
		key := strings.TrimSpace(plan.Assets[index].Key)
		if key == "" {
			return AssetPlan{}, fmt.Errorf("asset plan asset %d key is required", index+1)
		}
		if _, exists := keys[key]; exists {
			return AssetPlan{}, fmt.Errorf("asset plan asset key %q is duplicated", key)
		}
		keys[key] = struct{}{}
		plan.Assets[index].Key = key
		plan.Assets[index].AssetCandidate = assets[index]
	}
	seenSegments := make(map[int64]struct{}, len(plan.Bindings))
	for index := range plan.Bindings {
		binding := &plan.Bindings[index]
		if binding.SegmentID < 1 {
			return AssetPlan{}, fmt.Errorf("asset plan binding %d segmentId is required", index+1)
		}
		if _, exists := seenSegments[binding.SegmentID]; exists {
			return AssetPlan{}, fmt.Errorf("asset plan binding segment %d is duplicated", binding.SegmentID)
		}
		seenSegments[binding.SegmentID] = struct{}{}
		binding.SceneMode = strings.ToLower(strings.TrimSpace(binding.SceneMode))
		if binding.SceneMode != "" && binding.SceneMode != "start" && binding.SceneMode != "continue" && binding.SceneMode != "switch" {
			return AssetPlan{}, fmt.Errorf("asset plan binding %d sceneMode is invalid", index+1)
		}
		seenKeys := make(map[string]struct{}, len(binding.AssetKeys))
		for keyIndex, rawKey := range binding.AssetKeys {
			key := strings.TrimSpace(rawKey)
			if _, exists := keys[key]; !exists {
				return AssetPlan{}, fmt.Errorf("asset plan binding %d references unknown asset key %q", index+1, key)
			}
			if _, exists := seenKeys[key]; exists {
				return AssetPlan{}, fmt.Errorf("asset plan binding %d repeats asset key %q", index+1, key)
			}
			seenKeys[key] = struct{}{}
			binding.AssetKeys[keyIndex] = key
		}
	}
	return plan, nil
}

func ParseAssetCandidates(raw string) ([]AssetCandidate, error) {
	var candidates []AssetCandidate
	payload := []byte(strings.TrimSpace(raw))
	if err := json.Unmarshal(payload, &candidates); err != nil {
		converted, convertErr := parseFeishuAssetObject(payload)
		if convertErr != nil {
			return nil, fmt.Errorf("asset candidates must be a JSON array: %w", err)
		}
		candidates = converted
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("asset candidates cannot be empty")
	}
	for index := range candidates {
		candidates[index].Category = strings.ToLower(strings.TrimSpace(candidates[index].Category))
		candidates[index].Name = strings.TrimSpace(candidates[index].Name)
		candidates[index].Prompt = strings.TrimSpace(candidates[index].Prompt)
		if candidates[index].Name == "" || candidates[index].Prompt == "" {
			return nil, fmt.Errorf("asset candidate %d name and prompt are required", index+1)
		}
		switch candidates[index].Category {
		case "character", "scene", "prop":
		default:
			return nil, fmt.Errorf("asset candidate %d category is invalid", index+1)
		}
	}
	return candidates, nil
}

func parseFeishuAssetObject(payload []byte) ([]AssetCandidate, error) {
	var document struct {
		Characters []struct {
			Name   string `json:"角色名称"`
			Prompt string `json:"外观描述"`
		} `json:"人物设定"`
		Scenes []struct {
			Name        string `json:"场景名称"`
			Summary     string `json:"氛围概述"`
			Description string `json:"场景描述"`
		} `json:"场景设定"`
		Props []struct {
			Name        string `json:"道具名称"`
			Summary     string `json:"道具说明"`
			Description string `json:"道具描述"`
		} `json:"道具设定"`
	}
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, err
	}
	candidates := make([]AssetCandidate, 0, len(document.Characters)+len(document.Scenes)+len(document.Props))
	for _, item := range document.Characters {
		candidates = append(candidates, AssetCandidate{Category: "character", Name: item.Name, Prompt: item.Prompt})
	}
	for _, item := range document.Scenes {
		prompt := strings.TrimSpace(item.Description)
		if prompt == "" {
			prompt = item.Summary
		}
		candidates = append(candidates, AssetCandidate{Category: "scene", Name: item.Name, Prompt: prompt})
	}
	for _, item := range document.Props {
		prompt := strings.TrimSpace(item.Description)
		if prompt == "" {
			prompt = item.Summary
		}
		candidates = append(candidates, AssetCandidate{Category: "prop", Name: item.Name, Prompt: prompt})
	}
	return candidates, nil
}
