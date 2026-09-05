package batchfactoryv11

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// normalizeNovelFetchIntake keeps the first occurrence of each explicit source
// Book ID. Empty IDs are retained because they do not provide a stable
// deduplication identity.
func normalizeNovelFetchBook(book CreateBookInput) CreateBookInput {
	book.ID = strings.TrimSpace(book.ID)
	book.BookID = strings.TrimSpace(book.BookID)
	if book.BookID == "" {
		book.BookID = book.ID
	}
	if book.ID == "" {
		book.ID = book.BookID
	}
	book.SourceTaskID = strings.TrimSpace(book.SourceTaskID)
	book.Platform = strings.TrimSpace(book.Platform)
	book.TxtFileName = strings.TrimSpace(book.TxtFileName)
	if book.TxtText == "" {
		book.TxtText = book.SourceText
	}
	if book.TxtFileName == "" && book.BookID != "" {
		book.TxtFileName = book.BookID + ".txt"
	}
	return book
}

func sourceBookID(book CreateBookInput) string {
	book = normalizeNovelFetchBook(book)
	return book.BookID
}

func normalizeNovelFetchIntake(input NovelFetchIntakeInput) NovelFetchIntakeInput {
	out := NovelFetchIntakeInput{Metadata: input.Metadata, Books: make([]CreateBookInput, 0, len(input.Books))}
	seen := map[string]struct{}{}
	for _, book := range input.Books {
		book = normalizeNovelFetchBook(book)
		key := sourceBookID(book)
		if key != "" {
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
		}
		out.Books = append(out.Books, book)
	}
	return out
}

func manualSourceDigest(title, originalText string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(title) + "\x00" + strings.TrimSpace(originalText)))
	return hex.EncodeToString(digest[:8])
}

func cloneStringMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	output := make(map[string]any, len(input)+1)
	for key, value := range input {
		output[key] = value
	}
	return output
}

func normalizeManualIntake(input ManualIntakeInput) (ManualIntakeInput, error) {
	metadata := cloneStringMap(input.Metadata)
	metadata["sourceType"] = "manual"
	output := ManualIntakeInput{Metadata: metadata, Books: make([]CreateBookInput, 0, len(input.Books))}
	seen := map[string]struct{}{}
	for index, raw := range input.Books {
		book := raw
		book.Title = strings.TrimSpace(book.Title)
		book.SourceText = strings.TrimSpace(book.SourceText)
		book.TxtText = strings.TrimSpace(book.TxtText)
		book.TxtFileName = strings.TrimSpace(book.TxtFileName)
		if book.SourceText == "" {
			book.SourceText = book.TxtText
		}
		if book.TxtText == "" {
			book.TxtText = book.SourceText
		}
		if book.Title == "" {
			book.Title = fmt.Sprintf("手动导入 %02d", index+1)
		}
		if book.SourceText == "" {
			return ManualIntakeInput{}, ErrInvalid
		}
		bookMetadata := cloneStringMap(book.SourceMetadata)
		bookMetadata["sourceType"] = "manual"
		originalText, _ := bookMetadata["originalText"].(string)
		originalText = strings.TrimSpace(originalText)
		if originalText == "" {
			originalText = book.SourceText
		}
		bookMetadata["originalText"] = originalText
		stableID := "manual-" + manualSourceDigest(book.Title, originalText)
		book.ID, book.BookID = stableID, stableID
		if book.TxtFileName == "" {
			book.TxtFileName = stableID + ".txt"
		}
		book.SourceTaskID, book.Platform = "", ""
		book.SourceMetadata = bookMetadata
		if _, exists := seen[stableID]; exists {
			continue
		}
		seen[stableID] = struct{}{}
		output.Books = append(output.Books, book)
	}
	if len(output.Books) == 0 {
		return ManualIntakeInput{}, ErrInvalid
	}
	return output, nil
}
