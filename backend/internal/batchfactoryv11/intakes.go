package batchfactoryv11

import "strings"

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
