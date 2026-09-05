package batchfactoryv11

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

type DirectorSettings struct {
	MaxVideoDuration  int      `json:"maxVideoDuration"`
	FixedSingleVideo  bool     `json:"fixedSingleVideo"`
	ExactDuration     int      `json:"exactDuration"`
	AspectRatio       string   `json:"aspectRatio"`
	AllowedPrefixKeys []string `json:"allowedPrefixKeys"`
}

type NamedPrompt struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type DirectorShot struct {
	StartSec    int    `json:"start_sec"`
	EndSec      int    `json:"end_sec"`
	ShotType    string `json:"shot_type"`
	Camera      string `json:"camera"`
	Description string `json:"description"`
}

type DirectorVideo struct {
	ID          any            `json:"id"`
	SceneID     any            `json:"scene_id"`
	DurationSec int            `json:"duration_sec"`
	Characters  []string       `json:"characters"`
	Props       []string       `json:"props"`
	Scene       string         `json:"scene"`
	PrefixKey   string         `json:"prefix_key"`
	Shots       []DirectorShot `json:"shots"`
	VideoDesc   string         `json:"video_desc"`
}

type SourceCoverage struct {
	SourceComplete     bool   `json:"source_complete"`
	SourceEndMarker    string `json:"source_end_marker"`
	HasRemainingSource bool   `json:"has_remaining_source"`
}

type DirectorResult struct {
	Characters     []NamedPrompt   `json:"characters"`
	Scenes         []NamedPrompt   `json:"scenes"`
	Props          []NamedPrompt   `json:"props"`
	Storyboard     []DirectorVideo `json:"storyboard"`
	SourceCoverage SourceCoverage  `json:"source_coverage"`
}

var fencedDirectorJSON = regexp.MustCompile("(?is)```(?:json)?\\s*([\\s\\S]*?)```")

func ParseDirectorJSON(value string) (json.RawMessage, error) {
	text := strings.TrimSpace(value)
	if text == "" {
		return nil, fmt.Errorf("导演模型返回为空")
	}
	candidate := text
	if match := fencedDirectorJSON.FindStringSubmatch(text); len(match) > 1 {
		candidate = strings.TrimSpace(match[1])
	}
	if json.Valid([]byte(candidate)) {
		return json.RawMessage(candidate), nil
	}
	start := strings.Index(candidate, "{")
	end := strings.LastIndex(candidate, "}")
	if start >= 0 && end > start {
		fragment := candidate[start : end+1]
		if json.Valid([]byte(fragment)) {
			return json.RawMessage(fragment), nil
		}
	}
	return nil, fmt.Errorf("导演模型没有返回合法 JSON")
}

func cleanDirectorText(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func decodeDirectorObject(raw json.RawMessage) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("导演模型没有返回合法 JSON")
	}
	if value == nil {
		return nil, fmt.Errorf("导演模型没有返回合法 JSON")
	}
	return value, nil
}

func directorInteger(value any, field string) (int, error) {
	var number float64
	switch typed := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseFloat(string(typed), 64)
		if err != nil {
			return 0, fmt.Errorf("%s 必须是整数", field)
		}
		number = parsed
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		return typed, nil
	case int64:
		return int(typed), nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0, fmt.Errorf("%s 必须是整数", field)
		}
		number = parsed
	default:
		return 0, fmt.Errorf("%s 必须是整数", field)
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number {
		return 0, fmt.Errorf("%s 必须是整数", field)
	}
	return int(number), nil
}

func directorArray(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	return []any{}
}

func directorMap(value any) (map[string]any, bool) {
	entry, ok := value.(map[string]any)
	return entry, ok
}

func firstDirectorText(entry map[string]any, fields ...string) string {
	for _, field := range fields {
		if text := cleanDirectorText(entry[field]); text != "" {
			return text
		}
	}
	return ""
}

func normalizeDirectorNamedPrompts(value any, label string) ([]NamedPrompt, error) {
	items := directorArray(value)
	seen := map[string]struct{}{}
	out := make([]NamedPrompt, 0, len(items))
	for index, item := range items {
		entry, ok := directorMap(item)
		if !ok {
			return nil, fmt.Errorf("%s[%d] 格式无效", label, index)
		}
		name := firstDirectorText(entry, "name", "名称", "角色名称", "场景名称")
		prompt := firstDirectorText(entry, "prompt", "提示词", "description", "描述")
		if name == "" {
			return nil, fmt.Errorf("%s[%d] 缺少名称", label, index)
		}
		if prompt == "" {
			return nil, fmt.Errorf("%s[%d] 缺少提示词", label, index)
		}
		if _, exists := seen[name]; exists {
			return nil, fmt.Errorf("%s存在重复名称：%s", label, name)
		}
		seen[name] = struct{}{}
		out = append(out, NamedPrompt{Name: name, Prompt: prompt})
	}
	return out, nil
}

func normalizeDirectorRefs(value any) []string {
	values := []any{}
	switch typed := value.(type) {
	case []any:
		values = typed
	case string:
		normalized := strings.ReplaceAll(typed, "，", ",")
		for _, part := range strings.Split(normalized, ",") {
			values = append(values, part)
		}
	default:
		if value != nil {
			values = append(values, value)
		}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, item := range values {
		name := cleanDirectorText(item)
		if entry, ok := directorMap(item); ok {
			name = cleanDirectorText(entry["name"])
		}
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

func directorNameSet(values []NamedPrompt) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		out[value.Name] = struct{}{}
	}
	return out
}

func normalizeDirectorShots(value any, durationSec, videoIndex int) ([]DirectorShot, error) {
	items := directorArray(value)
	if len(items) == 0 {
		return nil, fmt.Errorf("storyboard[%d] 至少需要一个镜头", videoIndex)
	}
	cursor := 0
	out := make([]DirectorShot, 0, len(items))
	for shotIndex, item := range items {
		entry, ok := directorMap(item)
		if !ok {
			return nil, fmt.Errorf("storyboard[%d].shots[%d] 格式无效", videoIndex, shotIndex)
		}
		startValue := entry["start_sec"]
		if startValue == nil {
			startValue = entry["startSec"]
		}
		endValue := entry["end_sec"]
		if endValue == nil {
			endValue = entry["endSec"]
		}
		startSec, err := directorInteger(startValue, fmt.Sprintf("storyboard[%d].shots[%d].start_sec", videoIndex, shotIndex))
		if err != nil {
			return nil, err
		}
		endSec, err := directorInteger(endValue, fmt.Sprintf("storyboard[%d].shots[%d].end_sec", videoIndex, shotIndex))
		if err != nil {
			return nil, err
		}
		if startSec != cursor {
			return nil, fmt.Errorf("storyboard[%d] 镜头时间轴必须连续，期望从 %d 秒开始", videoIndex, cursor)
		}
		if endSec <= startSec {
			return nil, fmt.Errorf("storyboard[%d].shots[%d] 结束时间必须大于开始时间", videoIndex, shotIndex)
		}
		// OpenAI-compatible providers sometimes use their own stable aliases
		// for the same shot fields (for example lens_type/action). Normalize
		// those aliases at the V11 boundary so a provider schema variation does
		// not discard an otherwise executable Director result.
		description := firstDirectorText(entry, "description", "desc", "画面", "prompt", "action", "lens", "content")
		if description == "" {
			return nil, fmt.Errorf("storyboard[%d].shots[%d] 缺少画面描述", videoIndex, shotIndex)
		}
		cursor = endSec
		out = append(out, DirectorShot{
			StartSec:    startSec,
			EndSec:      endSec,
			ShotType:    firstDirectorText(entry, "shot_type", "shotType", "景别", "lens_type"),
			Camera:      firstDirectorText(entry, "camera", "运镜"),
			Description: description,
		})
	}
	if out[len(out)-1].EndSec != durationSec {
		return nil, fmt.Errorf("storyboard[%d] 最后一个镜头必须结束在 %d 秒", videoIndex, durationSec)
	}
	return out, nil
}

func NormalizeDirectorOutput(raw json.RawMessage, settings DirectorSettings) (DirectorResult, error) {
	if settings.MaxVideoDuration < 1 || settings.MaxVideoDuration > 60 {
		return DirectorResult{}, fmt.Errorf("maxVideoDuration 超出允许范围")
	}
	if settings.FixedSingleVideo && (settings.ExactDuration < 1 || settings.ExactDuration > settings.MaxVideoDuration) {
		return DirectorResult{}, fmt.Errorf("exactDuration 必须位于模型最大时长范围内")
	}
	aspectRatio := strings.TrimSpace(settings.AspectRatio)
	if aspectRatio == "" {
		aspectRatio = "9:16"
	}
	if aspectRatio != "9:16" && aspectRatio != "16:9" {
		return DirectorResult{}, fmt.Errorf("aspectRatio 仅支持 9:16 或 16:9")
	}

	root, err := decodeDirectorObject(raw)
	if err != nil {
		return DirectorResult{}, err
	}
	characters, err := normalizeDirectorNamedPrompts(root["characters"], "characters")
	if err != nil {
		return DirectorResult{}, err
	}
	scenes, err := normalizeDirectorNamedPrompts(root["scenes"], "scenes")
	if err != nil {
		return DirectorResult{}, err
	}
	props, err := normalizeDirectorNamedPrompts(root["props"], "props")
	if err != nil {
		return DirectorResult{}, err
	}
	characterNames := directorNameSet(characters)
	sceneNames := directorNameSet(scenes)
	propNames := directorNameSet(props)
	allowedPrefixes := map[string]struct{}{}
	for _, key := range settings.AllowedPrefixKeys {
		allowedPrefixes[key] = struct{}{}
	}

	sourceVideos := directorArray(root["storyboard"])
	if len(sourceVideos) == 0 {
		return DirectorResult{}, fmt.Errorf("storyboard 不能为空")
	}
	if settings.FixedSingleVideo && len(sourceVideos) != 1 {
		return DirectorResult{}, fmt.Errorf("固定单镜头模式只能输出一个视频单元")
	}

	storyboard := make([]DirectorVideo, 0, len(sourceVideos))
	for videoIndex, item := range sourceVideos {
		video, ok := directorMap(item)
		if !ok {
			return DirectorResult{}, fmt.Errorf("storyboard[%d] 格式无效", videoIndex)
		}
		durationValue := video["duration_sec"]
		if durationValue == nil {
			durationValue = video["durationSec"]
		}
		durationSec, err := directorInteger(durationValue, fmt.Sprintf("storyboard[%d].duration_sec", videoIndex))
		if err != nil {
			return DirectorResult{}, err
		}
		if durationSec < 1 || durationSec > settings.MaxVideoDuration {
			return DirectorResult{}, fmt.Errorf("storyboard[%d] 时长必须在 1-%d 秒之间", videoIndex, settings.MaxVideoDuration)
		}
		if settings.FixedSingleVideo && durationSec != settings.ExactDuration {
			return DirectorResult{}, fmt.Errorf("固定单镜头模式必须严格输出 %d 秒", settings.ExactDuration)
		}

		characterRefs := normalizeDirectorRefs(video["characters"])
		propRefs := normalizeDirectorRefs(video["props"])
		scene := cleanDirectorText(video["scene"])
		if sceneEntry, ok := directorMap(video["scene"]); ok {
			scene = cleanDirectorText(sceneEntry["name"])
		}
		for _, name := range characterRefs {
			if _, exists := characterNames[name]; !exists {
				return DirectorResult{}, fmt.Errorf("storyboard[%d] 引用了未知人物：%s", videoIndex, name)
			}
		}
		for _, name := range propRefs {
			if _, exists := propNames[name]; !exists {
				return DirectorResult{}, fmt.Errorf("storyboard[%d] 引用了未知道具：%s", videoIndex, name)
			}
		}
		if scene != "" {
			if _, exists := sceneNames[scene]; !exists {
				return DirectorResult{}, fmt.Errorf("storyboard[%d] 引用了未知场景：%s", videoIndex, scene)
			}
		}

		prefixKey := firstDirectorText(video, "prefix_key", "prefixKey")
		if len(allowedPrefixes) > 0 && prefixKey != "" {
			if _, exists := allowedPrefixes[prefixKey]; !exists {
				return DirectorResult{}, fmt.Errorf("storyboard[%d] 使用了未知前缀类型：%s", videoIndex, prefixKey)
			}
		}
		videoDesc := firstDirectorText(video, "video_desc", "videoDesc")
		if videoDesc == "" {
			return DirectorResult{}, fmt.Errorf("storyboard[%d] 缺少 video_desc", videoIndex)
		}
		shots, err := normalizeDirectorShots(video["shots"], durationSec, videoIndex)
		if err != nil {
			return DirectorResult{}, err
		}

		id := video["id"]
		if id == nil {
			id = videoIndex + 1
		}
		sceneID := video["scene_id"]
		if sceneID == nil {
			sceneID = video["sceneId"]
		}
		if sceneID == nil {
			sceneID = videoIndex + 1
		}
		storyboard = append(storyboard, DirectorVideo{
			ID:          id,
			SceneID:     sceneID,
			DurationSec: durationSec,
			Characters:  characterRefs,
			Props:       propRefs,
			Scene:       scene,
			PrefixKey:   prefixKey,
			Shots:       shots,
			VideoDesc:   videoDesc,
		})
	}

	coverage := SourceCoverage{
		SourceComplete:     !settings.FixedSingleVideo,
		SourceEndMarker:    "",
		HasRemainingSource: settings.FixedSingleVideo,
	}
	if rawCoverage, ok := directorMap(root["source_coverage"]); ok {
		coverage = SourceCoverage{
			SourceComplete:     rawCoverage["source_complete"] == true,
			SourceEndMarker:    cleanDirectorText(rawCoverage["source_end_marker"]),
			HasRemainingSource: rawCoverage["has_remaining_source"] == true,
		}
	}

	return DirectorResult{
		Characters:     characters,
		Scenes:         scenes,
		Props:          props,
		Storyboard:     storyboard,
		SourceCoverage: coverage,
	}, nil
}
