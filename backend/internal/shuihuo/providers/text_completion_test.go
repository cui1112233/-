package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
)

func TestTextCompletionRejectsNonJSONArray(t *testing.T) {
	_, err := ParseSegmentCandidates(`{"subtitle":"not array"}`)
	if err == nil {
		t.Fatal("accepted non-array response")
	}
}

func TestTextCompletionParsesNonEmptyCandidateArray(t *testing.T) {
	candidates, err := ParseSegmentCandidates(`[{"text":"第一段"},{"text":"第二段"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 || candidates[0].Text != "第一段" || candidates[1].Text != "第二段" {
		t.Fatalf("candidates = %#v", candidates)
	}
}

func TestTextCompletionParsesAndNormalizesCandidateSpeaker(t *testing.T) {
	candidates, err := ParseSegmentCandidates(`[{"text":"都成年了，谁还装乖宝宝？","speaker":" 我 "},{"text":"窗外下起了雨"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if candidates[0].Speaker != "我" {
		t.Fatalf("first candidate speaker = %q, want 我", candidates[0].Speaker)
	}
	if candidates[1].Speaker != "旁白" {
		t.Fatalf("second candidate speaker = %q, want 旁白", candidates[1].Speaker)
	}
}

func TestParseAssetCandidatesAcceptsFeishuExtractorObject(t *testing.T) {
	candidates, err := ParseAssetCandidates(`{
		"人物设定": [
			{"角色名称": "林鸢", "外观描述": "全景，正面拍摄，女，青年，白衬衫。"}
		],
		"场景设定": [
			{"场景名称": "教室走廊", "场景描述": "室内半开放走廊，白天阳光明亮。"}
		],
		"道具设定": [
			{"道具名称": "粉色情书", "道具描述": "粉色哑光纸质信封。"}
		]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 3 {
		t.Fatalf("candidates length = %d", len(candidates))
	}
	if candidates[0].Category != "character" || candidates[0].Name != "林鸢" || candidates[0].Prompt == "" {
		t.Fatalf("character candidate = %#v", candidates[0])
	}
	if candidates[1].Category != "scene" || candidates[1].Name != "教室走廊" || candidates[1].Prompt == "" {
		t.Fatalf("scene candidate = %#v", candidates[1])
	}
	if candidates[2].Category != "prop" || candidates[2].Name != "粉色情书" || candidates[2].Prompt == "" {
		t.Fatalf("prop candidate = %#v", candidates[2])
	}
}

func TestParseAssetPlanAcceptsAssetsAndStoryboardBindings(t *testing.T) {
	plan, err := ParseAssetPlan(`{"assets":[{"key":"character_xiaohong","category":"character","name":"小红","prompt":"短发少女"},{"key":"scene_classroom","category":"scene","name":"教室","prompt":"明亮教室"}],"bindings":[{"segmentId":11,"sceneMode":"start","assetKeys":["character_xiaohong","scene_classroom"]},{"segmentId":12,"sceneMode":"continue","assetKeys":[]}]}`)
	if err != nil {
		t.Fatalf("ParseAssetPlan() error = %v", err)
	}
	if len(plan.Assets) != 2 || len(plan.Bindings) != 2 || plan.Bindings[0].AssetKeys[1] != "scene_classroom" {
		t.Fatalf("ParseAssetPlan() = %#v", plan)
	}
	if plan.Bindings[0].SceneMode != "start" || plan.Bindings[1].SceneMode != "continue" {
		t.Fatalf("scene continuity modes = %#v", plan.Bindings)
	}
}

func TestTextCompletionOpenAIChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Fatal("missing authorization")
		}
		var body struct {
			Model       string  `json:"model"`
			Temperature float64 `json:"temperature"`
			Messages    []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" || body.Temperature != 0.2 || len(body.Messages) != 1 || body.Messages[0].Role != "user" || body.Messages[0].Content != "生成候选" {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL + "/v1/", CredentialRef: "TEXT", Name: "gpt-4o"}
	result, err := provider.Complete(context.Background(), model, "生成候选")
	if err != nil {
		t.Fatal(err)
	}
	if result != "[]" {
		t.Fatalf("result = %q", result)
	}
}

func TestTextCompletionDoesNotDuplicateExplicitChatCompletionsPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL + "/v1/chat/completions", CredentialRef: "TEXT", Name: "gpt-4o"}
	if _, err := provider.Complete(context.Background(), model, "生成候选"); err != nil {
		t.Fatal(err)
	}
}

func TestTextCompletionUsesKnownDisplayNameAsUpstreamModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" {
			t.Fatalf("model = %q", body.Model)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "GPT-4o 文本模型"}
	if _, err := provider.Complete(context.Background(), model, "生成候选"); err != nil {
		t.Fatal(err)
	}
}

func TestTextCompletionUsesConfiguredUpstreamModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-4o" {
			t.Fatalf("model = %q", body.Model)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[]"}}]}`))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "显示名称", ParameterSchema: `{"upstreamModel":"gpt-4o"}`}
	if _, err := provider.Complete(context.Background(), model, "生成候选"); err != nil {
		t.Fatal(err)
	}
}

func TestTextCompletionDoesNotExposeCredentialOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("credential rejected"))
	}))
	defer server.Close()

	provider := NewTextCompletion(server.Client(), func(ref string) (string, error) { return "test-secret", nil })
	provider.validateURL = func(raw string) (*url.URL, error) { return url.Parse(raw) }
	model := models.Definition{AdapterKind: models.AdapterTextCompletion, Endpoint: server.URL, CredentialRef: "TEXT", Name: "gpt-4o"}
	_, err := provider.Complete(context.Background(), model, "生成候选")
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "test-secret") {
		t.Fatalf("error = %v", err)
	}
}
