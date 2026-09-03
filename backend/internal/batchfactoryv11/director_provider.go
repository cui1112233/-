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

type DirectorProvider interface {
	Complete(context.Context, TextCompletionRequest) (string, error)
}

type OpenAICompatibleProvider struct {
	Endpoint string
	APIKey   string
	Model    string
	Client   *http.Client
}

func (p *OpenAICompatibleProvider) Validate() error {
	u, err := url.Parse(strings.TrimSpace(p.Endpoint))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return fmt.Errorf("director provider endpoint must be an absolute https URL")
	}
	if strings.TrimSpace(p.APIKey) == "" || strings.TrimSpace(p.Model) == "" {
		return fmt.Errorf("director provider API key and model are required")
	}
	return nil
}

func (p *OpenAICompatibleProvider) Complete(ctx context.Context, input TextCompletionRequest) (string, error) {
	if err := p.Validate(); err != nil {
		return "", err
	}
	payload := map[string]any{
		"model": p.Model,
		"messages": []map[string]string{
			{"role": "system", "content": input.SystemPrompt},
			{"role": "user", "content": input.UserPrompt},
		},
		"temperature": input.Temperature,
		"max_tokens": input.MaxTokens,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.Endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("director provider returned HTTP %d", resp.StatusCode)
	}
	var decoded struct {
		Choices []struct {
			Message struct { Content string `json:"content"` } `json:"message"`
			Text string `json:"text"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil || len(decoded.Choices) == 0 {
		return "", fmt.Errorf("director provider returned an invalid response")
	}
	content := strings.TrimSpace(decoded.Choices[0].Message.Content)
	if content == "" {
		content = strings.TrimSpace(decoded.Choices[0].Text)
	}
	if content == "" {
		return "", fmt.Errorf("director provider returned empty content")
	}
	return content, nil
}

