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
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/chat/completions"
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
	}
	return candidates, nil
}

type AssetCandidate struct {
	Category string `json:"category"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
}

func ParseAssetCandidates(raw string) ([]AssetCandidate, error) {
	var candidates []AssetCandidate
	if err := json.Unmarshal([]byte(raw), &candidates); err != nil {
		return nil, fmt.Errorf("asset candidates must be a JSON array: %w", err)
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
