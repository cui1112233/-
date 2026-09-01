package batchfactoryv11

import "strings"

// normalizeNovelFetchIntake keeps the first occurrence of each explicit source
// Book ID. Empty IDs are retained because they do not provide a stable
// deduplication identity.
func normalizeNovelFetchIntake(input NovelFetchIntakeInput) NovelFetchIntakeInput {
	out := NovelFetchIntakeInput{Metadata: input.Metadata, Books: make([]CreateBookInput, 0, len(input.Books))}
	seen := map[string]struct{}{}
	for _, book := range input.Books {
		book.ID = strings.TrimSpace(book.ID)
		if book.ID != "" {
			if _, exists := seen[book.ID]; exists {
				continue
			}
			seen[book.ID] = struct{}{}
		}
		out.Books = append(out.Books, book)
	}
	return out
}
