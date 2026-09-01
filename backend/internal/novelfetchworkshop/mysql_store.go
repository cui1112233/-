package novelfetchworkshop

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type MySQLStore struct{ DB *sql.DB }

func NewMySQLStore(db *sql.DB) *MySQLStore { return &MySQLStore{DB: db} }

func (s *MySQLStore) GetDocument(ctx context.Context, owner, bookID string) (Document, error) {
	var raw []byte
	var updated time.Time
	err := s.DB.QueryRowContext(ctx, `SELECT document_json, updated_at FROM novel_fetch_workshop_documents WHERE owner_username=? AND book_id=?`, owner, bookID).Scan(&raw, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	if err != nil {
		return Document{}, err
	}
	var document Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return Document{}, fmt.Errorf("decode novel fetch document: %w", err)
	}
	document = normalizeDocument(document)
	document.BookID = bookID
	document.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return document, nil
}

func (s *MySQLStore) PutDocument(ctx context.Context, owner string, document Document) error {
	document = normalizeDocument(document)
	if document.BookID == "" {
		return errors.New("book id is required")
	}
	raw, err := json.Marshal(document)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO novel_fetch_workshop_documents(owner_username,book_id,document_json,created_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE document_json=VALUES(document_json), updated_at=CURRENT_TIMESTAMP(6)`, owner, document.BookID, raw)
	return err
}

func (s *MySQLStore) ListDocuments(ctx context.Context, owner string) ([]Document, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT book_id, document_json, updated_at FROM novel_fetch_workshop_documents WHERE owner_username=? ORDER BY updated_at DESC, book_id ASC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Document{}
	for rows.Next() {
		var bookID string
		var raw []byte
		var updated time.Time
		if err := rows.Scan(&bookID, &raw, &updated); err != nil {
			return nil, err
		}
		var document Document
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, fmt.Errorf("decode novel fetch document %s: %w", bookID, err)
		}
		document = normalizeDocument(document)
		document.BookID = bookID
		document.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
		result = append(result, document)
	}
	return result, rows.Err()
}

func (s *MySQLStore) DeleteDocuments(ctx context.Context, owner string, ids []string) (DeleteResult, error) {
	result := DeleteResult{Requested: len(ids), Results: make([]DeleteRecord, 0, len(ids))}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if id == "" {
			result.Results = append(result.Results, DeleteRecord{BookID: rawID, Deleted: false})
			continue
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM novel_fetch_workshop_documents WHERE owner_username=? AND book_id=?`, owner, id)
		if err != nil {
			return result, err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return result, err
		}
		deleted := rows > 0
		if deleted {
			result.Deleted++
		}
		result.Results = append(result.Results, DeleteRecord{BookID: id, Deleted: deleted})
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (s *MySQLStore) GetConfig(ctx context.Context, owner string) (map[string]any, error) {
	var raw []byte
	err := s.DB.QueryRowContext(ctx, `SELECT settings_json FROM novel_fetch_workshop_configs WHERE owner_username=?`, owner).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	var settings map[string]any
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil, fmt.Errorf("decode novel fetch config: %w", err)
	}
	if settings == nil {
		settings = map[string]any{}
	}
	return settings, nil
}

func (s *MySQLStore) PutConfig(ctx context.Context, owner string, settings map[string]any) error {
	if settings == nil {
		settings = map[string]any{}
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO novel_fetch_workshop_configs(owner_username,settings_json,created_at,updated_at) VALUES(?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE settings_json=VALUES(settings_json), updated_at=CURRENT_TIMESTAMP(6)`, owner, raw)
	return err
}
