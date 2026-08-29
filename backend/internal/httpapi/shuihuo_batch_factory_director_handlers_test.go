package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"qiantie/backend/internal/store"
)

const batchFactoryDirectorRowsJSON = `[
  {"id":"batch-hook-adaptation","module":"batch-factory","name":"爆款开头","version":1,"status":"published","body":"HOOK V1","publishedAt":"2026-08-01T00:00:00Z"},
  {"id":"batch-original-director","module":"batch-factory","name":"原文导演","version":1,"status":"published","body":"DIRECTOR V1","publishedAt":"2026-08-01T00:00:00Z"},
  {"id":"batch-viral-director","module":"batch-factory","name":"爆款导演","version":1,"status":"published","body":"VIRAL DIRECTOR V1","publishedAt":"2026-08-01T00:00:00Z"},
  {"id":"standard-short-drama","module":"batch-factory","name":"短剧剧本","version":1,"status":"published","body":"SCRIPT V1","publishedAt":"2026-08-01T00:00:00Z"},
  {"id":"standard-asset-extraction","module":"batch-factory","name":"资产提取","version":1,"status":"published","body":"ASSET V1","publishedAt":"2026-08-01T00:00:00Z"}
]`

func TestBatchFactoryDirectorContractBuildsAuthenticatedGoPrompt(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/director/contract"
	body := `{
      "mode":"original",
      "sourceText":"林晚推门而入。",
      "scriptPromptPresetId":"standard-short-drama",
      "assetPromptPresetId":"standard-asset-extraction",
      "maxVideoDuration":15,
      "aspectRatio":"9:16",
      "presets":` + batchFactoryDirectorRowsJSON + `
    }`
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("director contract = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		SystemPrompt string `json:"systemPrompt"`
		UserPrompt   string `json:"userPrompt"`
		MaxTokens    int    `json:"maxTokens"`
		Normalization struct {
			MaxVideoDuration int `json:"maxVideoDuration"`
		} `json:"normalization"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode director contract: %v", err)
	}
	if !strings.Contains(payload.SystemPrompt, "DIRECTOR V1") || !strings.Contains(payload.SystemPrompt, "SCRIPT V1") || payload.MaxTokens != 18000 {
		t.Fatalf("unexpected director contract: %#v", payload)
	}
	if payload.Normalization.MaxVideoDuration != 15 || !strings.Contains(payload.UserPrompt, "林晚推门而入") {
		t.Fatalf("unexpected director contract payload: %#v", payload)
	}
}

func TestBatchFactoryHookContractBuildsAuthenticatedGoPrompt(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/hook/contract"
	body := `{"sourceText":"小说正文","presets":` + batchFactoryDirectorRowsJSON + `}`
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("hook contract = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		SystemPrompt string  `json:"systemPrompt"`
		Temperature  float64 `json:"temperature"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode hook contract: %v", err)
	}
	if payload.SystemPrompt != "HOOK V1" || payload.Temperature != 0.75 {
		t.Fatalf("unexpected hook contract: %#v", payload)
	}
}

func TestBatchFactoryDirectorNormalizeCanonicalizesModelOutput(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	path := "/api/shuihuo-production/batch-factory/director/normalize"
	body := `{
      "output": {
        "characters":[{"name":"林晚","prompt":"人物"}],
        "scenes":[{"name":"客厅","prompt":"场景"}],
        "props":[],
        "storyboard":[{
          "duration_sec":9,
          "characters":["林晚"],
          "props":[],
          "scene":"客厅",
          "prefix_key":"general_anime",
          "shots":[{"start_sec":0,"end_sec":9,"description":"林晚进入客厅"}],
          "video_desc":"林晚进入客厅"
        }]
      },
      "settings":{"maxVideoDuration":15,"aspectRatio":"9:16","allowedPrefixKeys":["general_anime"]}
    }`
	response := batchFactoryConfigRequest(t, api, http.MethodPost, path, body)
	if response.Code != http.StatusOK {
		t.Fatalf("director normalize = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Result struct {
			Storyboard []struct {
				DurationSec int `json:"duration_sec"`
			} `json:"storyboard"`
		} `json:"result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode director normalize: %v", err)
	}
	if len(payload.Result.Storyboard) != 1 || payload.Result.Storyboard[0].DurationSec != 9 {
		t.Fatalf("unexpected normalized result: %#v", payload.Result)
	}
}
