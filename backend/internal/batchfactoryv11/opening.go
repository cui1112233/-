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
	Index       int    `json:"index"`
	Label       string `json:"label"`
	Prompt      string `json:"prompt"`
	Status      string `json:"status"`
	DurationSec int    `json:"durationSec,omitempty"`
}

var openingVariantSectionPattern = regexp.MustCompile(`(?m)^===VARIANT\s*(\d+)\s*===\s*$`)

func openingVariantLabel(index int) string {
	return fmt.Sprintf("分镜一 | 换开头%d", index)
}

// parseOpeningVariants splits the meta-prompt reply into one OpeningVariant per
// ===VARIANT N=== section. Every requested slot is returned: sections the model
// never produced (or produced with an invalid duration/body) come back as
// status "failed" with an empty prompt so the UI can mark them.
func parseOpeningVariants(raw string, maxVideoDuration, variantCount int) []OpeningVariant {
	out := make([]OpeningVariant, 0, variantCount)
	for index := 1; index <= variantCount; index++ {
		out = append(out, OpeningVariant{Index: index, Label: openingVariantLabel(index), Status: "failed"})
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
		lines := strings.SplitN(body, "\n", 2)
		durationMatch := sdDurationPattern.FindStringSubmatch(strings.TrimSpace(lines[0]))
		prompt := ""
		if len(lines) > 1 {
			prompt = strings.TrimSpace(lines[1])
		}
		if durationMatch == nil || prompt == "" {
			continue
		}
		duration, err := strconv.Atoi(durationMatch[1])
		if err != nil || duration < 1 || duration > maxVideoDuration {
			continue
		}
		out[number-1] = OpeningVariant{Index: number, Label: openingVariantLabel(number), Prompt: prompt, Status: "success", DurationSec: duration}
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
	raw, ok := video.SettingsState.Patch["openingVariants"]
	if !ok {
		return nil
	}
	var variants []OpeningVariant
	if json.Unmarshal(raw, &variants) != nil {
		return nil
	}
	out := []OpeningVariant{}
	for _, variant := range variants {
		if variant.Status == "success" && strings.TrimSpace(variant.Prompt) != "" {
			out = append(out, variant)
		}
	}
	return out
}
