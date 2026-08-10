package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type HistoryEntry struct {
	ID         int64     `json:"-"`
	ExternalID string    `json:"id"`
	Mode       string    `json:"mode"`
	Format     string    `json:"format"`
	FormatName string    `json:"formatName"`
	Duration   string    `json:"duration"`
	Preview    string    `json:"preview"`
	Output     string    `json:"output,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Histories struct {
	db *sql.DB
}

func NewHistories(db *sql.DB) *Histories {
	return &Histories{db: db}
}

func (s *Histories) List(ctx context.Context, userID int64, limit int) ([]HistoryEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, external_id, mode, format, format_name, duration, preview, created_at
FROM generation_histories
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT ?
`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []HistoryEntry
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.ExternalID, &e.Mode, &e.Format, &e.FormatName, &e.Duration, &e.Preview, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Histories) Save(ctx context.Context, userID int64, e HistoryEntry) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO generation_histories(user_id, external_id, mode, format, format_name, duration, preview, output, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  mode = VALUES(mode),
  format = VALUES(format),
  format_name = VALUES(format_name),
  duration = VALUES(duration),
  preview = VALUES(preview),
  output = VALUES(output)
`, userID, e.ExternalID, e.Mode, e.Format, e.FormatName, e.Duration, e.Preview, e.Output, e.CreatedAt)
	return err
}

func (s *Histories) Get(ctx context.Context, userID int64, externalID string) (HistoryEntry, error) {
	var e HistoryEntry
	err := s.db.QueryRowContext(ctx, `
SELECT id, external_id, mode, format, format_name, duration, preview, output, created_at
FROM generation_histories
WHERE user_id = ? AND external_id = ?
`, userID, externalID).Scan(&e.ID, &e.ExternalID, &e.Mode, &e.Format, &e.FormatName, &e.Duration, &e.Preview, &e.Output, &e.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return HistoryEntry{}, sql.ErrNoRows
	}
	return e, err
}

func (s *Histories) Delete(ctx context.Context, userID int64, externalID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM generation_histories WHERE user_id = ? AND external_id = ?", userID, externalID)
	return err
}

func (s *Histories) Clear(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM generation_histories WHERE user_id = ?", userID)
	return err
}
