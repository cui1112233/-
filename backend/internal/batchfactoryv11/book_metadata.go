package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type ManualBookMetadataInput struct {
	BookID string `json:"bookId,omitempty"`
	Title  string `json:"title"`
	Text   string `json:"sourceText"`
}

type ManualBookMetadataResult struct {
	BookID string `json:"bookId,omitempty"`
	Title  string `json:"title"`
	Gender string `json:"gender,omitempty"`
	Type   string `json:"type,omitempty"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type manualBookMetadataResponse struct {
	Gender string `json:"gender"`
	Type   string `json:"type"`
}

var allowedManualGenders = map[string]bool{
	"男频": true,
	"女频": true,
	"通用": true,
	"未知": true,
}

func ManualMetadataRecognitionEnabled(metadata map[string]any) bool {
	value, ok := metadata["manualMetadataRecognitionEnabled"]
	if !ok {
		return false
	}
	if enabled, ok := value.(bool); ok {
		return enabled
	}
	if text, ok := value.(string); ok {
		enabled, _ := strconv.ParseBool(strings.TrimSpace(text))
		return enabled
	}
	return false
}

func ClassifyManualBookMetadata(ctx context.Context, classifier DirectorProvider, input ManualBookMetadataInput, enabled bool) (ManualBookMetadataResult, error) {
	result := ManualBookMetadataResult{BookID: strings.TrimSpace(input.BookID), Title: strings.TrimSpace(input.Title), Status: "未识别"}
	if result.Title == "" {
		return result, fmt.Errorf("%w: title is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Text) == "" {
		return result, fmt.Errorf("%w: source text is required", ErrInvalid)
	}
	if !enabled {
		return result, nil
	}
	if classifier == nil {
		result.Status, result.Reason = "识别失败", "元数据识别服务不可用"
		return result, nil
	}
	preview, _, _, err := ResolveContentWindow(input.Text, DefaultContentLineLimit)
	if err != nil {
		result.Status, result.Reason = "识别失败", err.Error()
		return result, nil
	}
	response, err := classifier.Complete(ctx, TextCompletionRequest{
		SystemPrompt: "你是小说元数据识别器。只输出 JSON，不要 Markdown。gender 只能是男频、女频、通用、未知；type 输出简短中文类型。",
		UserPrompt:   "标题：" + result.Title + "\n正文窗口：\n" + preview + "\n请输出 {\"gender\":\"\",\"type\":\"\"}。",
		Temperature:  0,
		MaxTokens:    128,
	})
	if err != nil {
		result.Status, result.Reason = "识别失败", "元数据识别请求失败"
		return result, nil
	}
	var decoded manualBookMetadataResponse
	if err := json.Unmarshal([]byte(stripJSONFence(response)), &decoded); err != nil {
		result.Status, result.Reason = "识别失败", "元数据识别返回不是合法 JSON"
		return result, nil
	}
	decoded.Gender, decoded.Type = strings.TrimSpace(decoded.Gender), strings.TrimSpace(decoded.Type)
	if !allowedManualGenders[decoded.Gender] || decoded.Type == "" || len([]rune(decoded.Type)) > 64 {
		result.Status, result.Reason = "识别失败", "性别或类型不在允许范围"
		return result, nil
	}
	result.Gender, result.Type, result.Status = decoded.Gender, decoded.Type, "已识别"
	return result, nil
}

func ApplyManualMetadata(ctx context.Context, input ManualIntakeInput, classifier DirectorProvider) (ManualIntakeInput, []ManualBookMetadataResult, error) {
	enabled := ManualMetadataRecognitionEnabled(input.Metadata)
	output := input
	output.Books = append([]CreateBookInput(nil), input.Books...)
	results := make([]ManualBookMetadataResult, 0, len(input.Books))
	for index, book := range output.Books {
		result, err := ClassifyManualBookMetadata(ctx, classifier, ManualBookMetadataInput{BookID: book.ID, Title: book.Title, Text: book.SourceText}, enabled)
		if err != nil {
			return ManualIntakeInput{}, nil, err
		}
		metadata := cloneStringMap(book.SourceMetadata)
		metadata["metadataRecognitionStatus"] = result.Status
		if result.Reason != "" {
			metadata["metadataRecognitionReason"] = result.Reason
		}
		if result.Gender != "" {
			metadata["gender"] = result.Gender
		}
		if result.Type != "" {
			metadata["type"] = result.Type
		}
		output.Books[index].SourceMetadata = metadata
		results = append(results, result)
	}
	return output, results, nil
}

func stripJSONFence(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "```json")
	value = strings.TrimPrefix(value, "```")
	value = strings.TrimSuffix(value, "```")
	return strings.TrimSpace(value)
}
