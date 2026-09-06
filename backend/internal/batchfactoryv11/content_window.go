package batchfactoryv11

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	DefaultContentLineLimit = 5
	MaxContentLineLimit     = 10000
)

// ResolveContentWindow returns the first logical source lines. Logical lines
// are defined by source newlines, not browser wrapping. Empty lines are
// ignored so an editor-inserted blank line cannot consume the user's quota.
func ResolveContentWindow(text string, limit int) (preview string, usedLines int, totalLines int, err error) {
	if limit == 0 {
		limit = DefaultContentLineLimit
	}
	if limit < 1 || limit > MaxContentLineLimit {
		return "", 0, 0, fmt.Errorf("%w: contentLineLimit must be within 1-%d", ErrInvalid, MaxContentLineLimit)
	}
	lines := logicalContentLines(text)
	totalLines = len(lines)
	usedLines = minInt(limit, totalLines)
	if usedLines == 0 {
		return "", 0, totalLines, nil
	}
	return strings.Join(lines[:usedLines], "\n"), usedLines, totalLines, nil
}

// EffectiveContentLineLimit applies the batch default and then the per-book
// sparse override. The system default remains five lines for old batches.
func EffectiveContentLineLimit(batchPatch, bookPatch SettingsPatch) (int, error) {
	value := DefaultContentLineLimit
	for _, patch := range []SettingsPatch{batchPatch, bookPatch} {
		raw, ok := patch["contentLineLimit"]
		if !ok {
			continue
		}
		var candidate int
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return 0, fmt.Errorf("%w: contentLineLimit must be an integer", ErrInvalid)
		}
		if candidate < 1 || candidate > MaxContentLineLimit {
			return 0, fmt.Errorf("%w: contentLineLimit must be within 1-%d", ErrInvalid, MaxContentLineLimit)
		}
		value = candidate
	}
	return value, nil
}

func decorateBookContent(book *Book, batchPatch SettingsPatch) error {
	if book == nil {
		return fmt.Errorf("%w: book is required", ErrInvalid)
	}
	limit, err := EffectiveContentLineLimit(batchPatch, book.SettingsState.Patch)
	if err != nil {
		return err
	}
	preview, used, total, err := ResolveContentWindow(book.SourceText, limit)
	if err != nil {
		return err
	}
	book.ContentPreview = preview
	book.ContentLineLimit = limit
	book.ContentLineCount = total
	book.Gender = firstMetadataValue(book.SourceMetadata, "gender", "sex", "channel")
	book.Type = firstMetadataValue(book.SourceMetadata, "type", "style", "category", "genre")
	sourceType := firstMetadataValue(book.SourceMetadata, "sourceType", "source_type", "source")
	switch sourceType {
	case "novel-fetch", "novel_fetch":
		book.SourceLabel = "小说获取"
	case "manual", "direct-import", "direct_import":
		book.SourceLabel = "直接导入"
	default:
		book.SourceLabel = strings.TrimSpace(sourceType)
	}
	if book.SourceLabel == "" {
		book.SourceLabel = "未知来源"
	}
	if book.Status == "" {
		book.Status = "待编剧"
	}
	_ = used
	return nil
}

func decorateBookWorkflowStatus(book *Book) {
	if book == nil {
		return
	}
	if book.DirectorRevision != nil && len(book.Videos) > 0 {
		book.Status = "已编剧"
		return
	}
	book.Status = "待编剧"
}

func firstMetadataValue(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := metadata[key]; ok {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
			if value != nil {
				text := strings.TrimSpace(fmt.Sprint(value))
				if text != "" && text != "<nil>" {
					return text
				}
			}
		}
	}
	return ""
}

func logicalContentLines(text string) []string {
	normalized := strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(normalized, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		result = append(result, line)
	}
	return result
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
