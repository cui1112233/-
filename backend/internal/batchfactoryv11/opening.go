package batchfactoryv11

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// OpeningVariant is one AI-generated alternative opening prompt for VIDEO01.
// Index 0 is reserved for the original director prompt and is never stored here.
type OpeningVariant struct {
	Index         int    `json:"index"`
	Label         string `json:"label"`
	Prompt        string `json:"prompt"`
	Status        string `json:"status"`
	DurationSec   int    `json:"durationSec,omitempty"`
	FailureReason string `json:"failureReason,omitempty"`
}

// Models occasionally preserve the requested section numbers while drifting
// from the exact decoration (for example "### VARIANT 1", "**变体 2：**",
// or "=== 换开头 3 ==="). Treat those as the same machine marker so a
// harmless Markdown-format change does not discard an otherwise valid slot.
// Horizontal whitespace is intentional: the match must never consume the
// following prompt line.
var openingVariantSectionPattern = regexp.MustCompile(`(?mi)^[\t ]*(?:#{1,6}[\t ]*)?(?:\*{1,2}|_{1,2})?(?:={2,}[\t ]*)?(?:VARIANT|变体|换开头)[\t ]*(\d+)[\t ]*(?:[:：])?[\t ]*(?:={2,})?(?:\*{1,2}|_{1,2})?[\t ]*`)

func openingVariantLabel(index int) string {
	return fmt.Sprintf("分镜一 | 换开头%d", index)
}

// parseOpeningVariants splits the meta-prompt reply into one OpeningVariant per
// ===VARIANT N=== section. The original VIDEO01 duration is authoritative:
// changing only the opening picture must not ask the model to infer timing
// again. A model-supplied duration is accepted as optional metadata and is
// rejected only when it is explicitly outside the configured limit.
// Every requested slot is returned so the UI can mark genuinely missing or
// empty variants without blocking on harmless output-format drift.
func parseOpeningVariants(raw string, maxVideoDuration, originalDuration, variantCount int) []OpeningVariant {
	out := make([]OpeningVariant, 0, variantCount)
	for index := 1; index <= variantCount; index++ {
		out = append(out, OpeningVariant{Index: index, Label: openingVariantLabel(index), Status: "failed", FailureReason: "模型未输出该变体分段"})
	}
	text := strings.TrimSpace(raw)
	if text == "" || variantCount <= 0 {
		return out
	}
	markers := openingVariantSectionPattern.FindAllStringSubmatchIndex(text, -1)
	for i, marker := range markers {
		number, _ := strconv.Atoi(text[marker[2]:marker[3]])
		if number < 1 || number > variantCount {
			continue
		}
		end := len(text)
		if i+1 < len(markers) {
			end = markers[i+1][0]
		}
		body := strings.TrimSpace(text[marker[1]:end])
		lines := strings.Split(body, "\n")
		promptLines := make([]string, 0, len(lines))
		explicitDuration := 0
		for _, line := range lines {
			durationMatch := sdDurationPattern.FindStringSubmatch(strings.TrimSpace(line))
			if durationMatch == nil || explicitDuration > 0 {
				promptLines = append(promptLines, line)
				continue
			}
			parsed, err := strconv.Atoi(durationMatch[1])
			if err != nil || parsed < 1 || parsed > maxVideoDuration {
				out[number-1].FailureReason = fmt.Sprintf("时长必须在 1-%d 秒之间", maxVideoDuration)
				explicitDuration = -1
				break
			}
			explicitDuration = parsed
		}
		if explicitDuration < 0 {
			continue
		}
		prompt := strings.TrimSpace(strings.Join(promptLines, "\n"))
		if prompt == "" {
			out[number-1].FailureReason = "变体正文为空"
			continue
		}
		if originalDuration < 1 || originalDuration > maxVideoDuration {
			out[number-1].FailureReason = "原分镜时长无效"
			continue
		}
		out[number-1] = OpeningVariant{Index: number, Label: openingVariantLabel(number), Prompt: prompt, Status: "success", DurationSec: originalDuration}
	}
	return out
}

func openingVariantFor(video Video, index int) (OpeningVariant, bool) {
	raw, ok := video.SettingsState.Patch["openingVariants"]
	if !ok {
		return OpeningVariant{}, false
	}
	var variants []OpeningVariant
	if json.Unmarshal(raw, &variants) != nil {
		return OpeningVariant{}, false
	}
	for _, variant := range variants {
		if variant.Index == index && variant.Status == "success" && strings.TrimSpace(variant.Prompt) != "" {
			return variant, true
		}
	}
	return OpeningVariant{}, false
}

func successfulOpeningVariants(video Video) []OpeningVariant {
	variants := openingVariants(video)
	out := []OpeningVariant{}
	for _, variant := range variants {
		if variant.Status == "success" && strings.TrimSpace(variant.Prompt) != "" {
			out = append(out, variant)
		}
	}
	return out
}

func openingVariants(video Video) []OpeningVariant {
	raw, ok := video.SettingsState.Patch["openingVariants"]
	if !ok {
		return nil
	}
	var variants []OpeningVariant
	if json.Unmarshal(raw, &variants) != nil {
		return nil
	}
	return variants
}
