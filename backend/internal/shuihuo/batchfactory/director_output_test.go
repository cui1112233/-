package batchfactory

import (
	"encoding/json"
	"strings"
	"testing"
)

func validDirectorJSON() string {
	return `{
  "characters": [{"name":"林晚","prompt":"18岁中国女性，黑色长发。"}],
  "scenes": [{"name":"林家客厅","prompt":"现代中式客厅。"}],
  "props": [{"name":"玻璃杯","prompt":"透明厚底玻璃杯。"}],
  "storyboard": [
    {
      "id": 1,
      "scene_id": 1,
      "duration_sec": 9,
      "characters": ["林晚"],
      "props": ["玻璃杯"],
      "scene": "林家客厅",
      "prefix_key": "modern_conflict",
      "shots": [
        {"start_sec":0,"end_sec":3,"shot_type":"中景","camera":"缓慢推轨","description":"林晚进入客厅"},
        {"start_sec":3,"end_sec":9,"shot_type":"特写","camera":"固定","description":"她握紧玻璃杯"}
      ],
      "video_desc": "林晚进入客厅并握紧玻璃杯。"
    }
  ]
}`
}

func twoDirectorVideosJSON(t *testing.T) string {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal([]byte(validDirectorJSON()), &root); err != nil {
		t.Fatalf("unmarshal validDirectorJSON: %v", err)
	}
	storyboard, ok := root["storyboard"].([]any)
	if !ok || len(storyboard) != 1 {
		t.Fatalf("unexpected storyboard fixture: %#v", root["storyboard"])
	}
	root["storyboard"] = append(storyboard, map[string]any{})
	encoded, err := json.Marshal(root)
	if err != nil {
		t.Fatalf("marshal two-video fixture: %v", err)
	}
	return string(encoded)
}

func TestDirectorParseFencedJSON(t *testing.T) {
	raw, err := ParseDirectorJSON("```json\n" + validDirectorJSON() + "\n```")
	if err != nil {
		t.Fatalf("ParseDirectorJSON returned error: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("parsed JSON is invalid: %v", err)
	}
	if _, ok := decoded["storyboard"]; !ok {
		t.Fatalf("storyboard missing from parsed JSON")
	}
}

func TestDirectorNormalizeValidOutput(t *testing.T) {
	result, err := NormalizeDirectorOutput(json.RawMessage(validDirectorJSON()), DirectorSettings{
		MaxVideoDuration: 15,
		AspectRatio:      "9:16",
		AllowedPrefixKeys: []string{
			"modern_conflict",
		},
	})
	if err != nil {
		t.Fatalf("NormalizeDirectorOutput returned error: %v", err)
	}
	if len(result.Characters) != 1 || result.Characters[0].Name != "林晚" {
		t.Fatalf("unexpected characters: %#v", result.Characters)
	}
	if len(result.Storyboard) != 1 || result.Storyboard[0].DurationSec != 9 {
		t.Fatalf("unexpected storyboard: %#v", result.Storyboard)
	}
	if !result.SourceCoverage.SourceComplete || result.SourceCoverage.HasRemainingSource {
		t.Fatalf("unexpected default source coverage: %#v", result.SourceCoverage)
	}
}

func TestDirectorFixedSingleVideoRules(t *testing.T) {
	_, err := NormalizeDirectorOutput(json.RawMessage(twoDirectorVideosJSON(t)), DirectorSettings{
		MaxVideoDuration:  15,
		FixedSingleVideo:  true,
		ExactDuration:     15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "只能输出一个视频单元") {
		t.Fatalf("expected fixed-single count error, got %v", err)
	}

	_, err = NormalizeDirectorOutput(json.RawMessage(validDirectorJSON()), DirectorSettings{
		MaxVideoDuration:  15,
		FixedSingleVideo:  true,
		ExactDuration:     15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "严格输出 15 秒") {
		t.Fatalf("expected exact duration error, got %v", err)
	}
}

func TestDirectorRejectsFractionalDuration(t *testing.T) {
	fractional := strings.Replace(validDirectorJSON(), `"duration_sec": 9`, `"duration_sec": 9.5`, 1)
	_, err := NormalizeDirectorOutput(json.RawMessage(fractional), DirectorSettings{
		MaxVideoDuration:  15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "必须是整数") {
		t.Fatalf("expected integer error, got %v", err)
	}
}

func TestDirectorRejectsDiscontinuousShots(t *testing.T) {
	broken := strings.Replace(validDirectorJSON(), `"start_sec":3,"end_sec":9`, `"start_sec":4,"end_sec":9`, 1)
	_, err := NormalizeDirectorOutput(json.RawMessage(broken), DirectorSettings{
		MaxVideoDuration:  15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "必须连续") {
		t.Fatalf("expected continuity error, got %v", err)
	}
}

func TestDirectorRejectsUnknownReferencesAndPrefix(t *testing.T) {
	unknownCharacter := strings.Replace(validDirectorJSON(), `"characters": ["林晚"]`, `"characters": ["陌生人"]`, 1)
	_, err := NormalizeDirectorOutput(json.RawMessage(unknownCharacter), DirectorSettings{
		MaxVideoDuration:  15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "未知人物") {
		t.Fatalf("expected unknown character error, got %v", err)
	}

	unknownPrefix := strings.Replace(validDirectorJSON(), `"prefix_key": "modern_conflict"`, `"prefix_key": "unknown"`, 1)
	_, err = NormalizeDirectorOutput(json.RawMessage(unknownPrefix), DirectorSettings{
		MaxVideoDuration:  15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err == nil || !strings.Contains(err.Error(), "未知前缀类型") {
		t.Fatalf("expected unknown prefix error, got %v", err)
	}
}

func TestDirectorFixedSingleDefaultSourceCoverage(t *testing.T) {
	fixed := strings.Replace(validDirectorJSON(), `"duration_sec": 9`, `"duration_sec": 15`, 1)
	fixed = strings.Replace(fixed, `"end_sec":9`, `"end_sec":15`, 1)
	result, err := NormalizeDirectorOutput(json.RawMessage(fixed), DirectorSettings{
		MaxVideoDuration:  15,
		FixedSingleVideo:  true,
		ExactDuration:     15,
		AspectRatio:       "9:16",
		AllowedPrefixKeys: []string{"modern_conflict"},
	})
	if err != nil {
		t.Fatalf("NormalizeDirectorOutput returned error: %v", err)
	}
	if result.SourceCoverage.SourceComplete || !result.SourceCoverage.HasRemainingSource {
		t.Fatalf("unexpected fixed-single source coverage: %#v", result.SourceCoverage)
	}
}
