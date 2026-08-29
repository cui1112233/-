package batchfactory

import (
	"regexp"
	"sort"
	"strings"
	"time"
)

type Settings map[string]any

var overrideKeys = map[string]struct{}{
	"aspectRatio":           {},
	"prefixMode":            {},
	"customPrefix":          {},
	"prefixEnabled":         {},
	"injectCharacterPrompt": {},
	"injectScenePrompt":     {},
	"injectPropPrompt":      {},
	"quality":               {},
	"qualityEnabled":        {},
	"restriction":           {},
	"restrictionEnabled":    {},
	"negative":              {},
	"negativeEnabled":       {},
	"subtitlePolicy":        {},
}

var booleanOverrideKeys = map[string]struct{}{
	"prefixEnabled":         {},
	"injectCharacterPrompt": {},
	"injectScenePrompt":     {},
	"injectPropPrompt":      {},
	"qualityEnabled":        {},
	"restrictionEnabled":    {},
	"negativeEnabled":       {},
}

var textOverrideKeys = map[string]struct{}{
	"customPrefix": {},
	"quality":      {},
	"restriction":  {},
	"negative":     {},
}

var scriptPromptPresets = map[string]struct{}{
	"standard-short-drama":             {},
	"commercial-dynamic-storyboard":    {},
	"spatial-continuity-storyboard":     {},
}

var assetPromptPresets = map[string]struct{}{
	"standard-asset-extraction": {},
}

var presetIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

func NormalizeSettings(input, previous Settings) Settings {
	merged := mergeSettings(previous, input)
	maxVideoDuration := boundedInteger(merged["maxVideoDuration"], 1, 60, 10)
	fixedSingleVideo := boolValue(merged["fixedSingleVideo"], false)

	scriptPromptPresetID := allowedText(
		merged["scriptPromptPresetId"],
		previousValue(previous, "scriptPromptPresetId"),
		scriptPromptPresets,
		"standard-short-drama",
	)
	assetPromptPresetID := allowedText(
		merged["assetPromptPresetId"],
		previousValue(previous, "assetPromptPresetId"),
		assetPromptPresets,
		"standard-asset-extraction",
	)

	result := Settings{
		"videoModelId":          positiveIntegerOrNil(merged["videoModelId"]),
		"videoModelVersionId":   positiveIntegerOrNil(merged["videoModelVersionId"]),
		"videoModelName":        textValue(merged["videoModelName"], 160),
		"maxVideoDuration":      maxVideoDuration,
		"fixedSingleVideo":      fixedSingleVideo,
		"exactDuration":         nil,
		"aspectRatio":           enumValue(merged["aspectRatio"], map[string]struct{}{"9:16": {}, "16:9": {}}, "9:16"),
		"prefixMode":            enumValue(merged["prefixMode"], map[string]struct{}{"auto": {}, "manual": {}}, "auto"),
		"customPrefix":          textValue(merged["customPrefix"], 50000),
		"prefixEnabled":         boolValue(merged["prefixEnabled"], true),
		"style":                 textValue(merged["style"], 1000),
		"synopsis":              textValue(merged["synopsis"], 50000),
		"scriptPromptPresetId":  scriptPromptPresetID,
		"assetPromptPresetId":   assetPromptPresetID,
		"injectCharacterPrompt": boolValue(merged["injectCharacterPrompt"], true),
		"injectScenePrompt":     boolValue(merged["injectScenePrompt"], true),
		"injectPropPrompt":      boolValue(merged["injectPropPrompt"], true),
		"quality":               textValue(merged["quality"], 50000),
		"qualityEnabled":        boolValue(merged["qualityEnabled"], true),
		"restriction":           textValue(merged["restriction"], 50000),
		"restrictionEnabled":    boolValue(merged["restrictionEnabled"], true),
		"negative":              textValue(merged["negative"], 50000),
		"negativeEnabled":       boolValue(merged["negativeEnabled"], true),
		"subtitlePolicy":        enumValue(merged["subtitlePolicy"], map[string]struct{}{"allow": {}, "forbid-auto-dialogue-subtitle": {}}, "forbid-auto-dialogue-subtitle"),
		"systemConfigRevision":  textValue(merged["systemConfigRevision"], 64),
		"systemConfigLabel":     textValue(merged["systemConfigLabel"], 120),
		"systemConfigSyncedAt":  isoValue(merged["systemConfigSyncedAt"]),
		"systemPresetVersions":  presetVersions(merged["systemPresetVersions"]),
	}
	if fixedSingleVideo {
		result["exactDuration"] = maxVideoDuration
	}
	return result
}

func NormalizeSparseOverride(input, previous Settings, inheritKeys []string) Settings {
	next := cloneSettings(previous)
	restored := make(map[string]struct{}, len(inheritKeys))
	for _, key := range inheritKeys {
		if _, ok := overrideKeys[key]; !ok {
			continue
		}
		delete(next, key)
		restored[key] = struct{}{}
	}
	if input == nil {
		return next
	}

	for key, raw := range input {
		if _, allowed := overrideKeys[key]; !allowed {
			continue
		}
		if _, restoring := restored[key]; restoring {
			continue
		}
		if _, ok := booleanOverrideKeys[key]; ok {
			if value, valid := raw.(bool); valid {
				next[key] = value
			}
			continue
		}
		if _, ok := textOverrideKeys[key]; ok {
			if value, valid := raw.(string); valid {
				next[key] = textValue(value, 50000)
			}
			continue
		}
		switch key {
		case "aspectRatio":
			if value, ok := raw.(string); ok && (value == "9:16" || value == "16:9") {
				next[key] = value
			}
		case "prefixMode":
			if value, ok := raw.(string); ok {
				switch value {
				case "inherit":
					delete(next, key)
				case "auto", "manual":
					next[key] = value
				}
			}
		case "subtitlePolicy":
			if value, ok := raw.(string); ok && (value == "allow" || value == "forbid-auto-dialogue-subtitle") {
				next[key] = value
			}
		}
	}
	return next
}

func mergeSettings(previous, input Settings) Settings {
	merged := cloneSettings(previous)
	for key, value := range input {
		merged[key] = value
	}
	return merged
}

func cloneSettings(value Settings) Settings {
	result := Settings{}
	for key, item := range value {
		result[key] = item
	}
	return result
}

func previousValue(previous Settings, key string) any {
	if previous == nil {
		return nil
	}
	return previous[key]
}

func textValue(value any, max int) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	text = strings.TrimSpace(text)
	if max > 0 && len([]rune(text)) > max {
		return string([]rune(text)[:max])
	}
	return text
}

func boolValue(value any, fallback bool) bool {
	if boolean, ok := value.(bool); ok {
		return boolean
	}
	return fallback
}

func enumValue(value any, allowed map[string]struct{}, fallback string) string {
	text, ok := value.(string)
	if !ok {
		return fallback
	}
	if _, ok := allowed[text]; ok {
		return text
	}
	return fallback
}

func allowedText(value, previous any, allowed map[string]struct{}, fallback string) string {
	if text, ok := value.(string); ok {
		if _, accepted := allowed[text]; accepted {
			return text
		}
	}
	if text, ok := previous.(string); ok {
		if _, accepted := allowed[text]; accepted {
			return text
		}
	}
	return fallback
}

func positiveIntegerOrNil(value any) any {
	if integer, ok := numericInteger(value); ok && integer > 0 {
		return integer
	}
	return nil
}

func boundedInteger(value any, min, max, fallback int) int {
	integer, ok := numericInteger(value)
	if !ok || integer < min || integer > max {
		return fallback
	}
	return integer
}

func numericInteger(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int8:
		return int(number), true
	case int16:
		return int(number), true
	case int32:
		return int(number), true
	case int64:
		return int(number), int64(int(number)) == number
	case uint:
		return int(number), uint(int(number)) == number
	case uint8:
		return int(number), true
	case uint16:
		return int(number), true
	case uint32:
		converted := int(number)
		return converted, uint32(converted) == number
	case uint64:
		converted := int(number)
		return converted, uint64(converted) == number
	case float32:
		converted := int(number)
		return converted, float32(converted) == number
	case float64:
		converted := int(number)
		return converted, float64(converted) == number
	default:
		return 0, false
	}
}

func isoValue(value any) string {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(text))
	if err != nil {
		return ""
	}
	return parsed.UTC().Format("2006-01-02T15:04:05.000Z")
}

func presetVersions(value any) map[string]int {
	result := map[string]int{}
	var raw map[string]any
	switch typed := value.(type) {
	case map[string]any:
		raw = typed
	case map[string]int:
		raw = make(map[string]any, len(typed))
		for key, version := range typed {
			raw[key] = version
		}
	default:
		return result
	}
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if len(result) >= 200 || !presetIDPattern.MatchString(key) {
			continue
		}
		version, ok := numericInteger(raw[key])
		if !ok || version < 1 {
			continue
		}
		result[key] = version
	}
	return result
}
