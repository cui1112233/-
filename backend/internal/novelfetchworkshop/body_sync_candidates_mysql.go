package novelfetchworkshop

import (
	"context"
	"strings"
	"time"
)

func (s *MySQLStore) ListBodySyncCandidates(ctx context.Context, owner string, limit int) ([]BodySyncCandidate, error) {
	owner = strings.TrimSpace(owner)
	limit = normalizeBodySyncCandidateLimit(limit)

	rows, err := s.DB.QueryContext(ctx, `SELECT book_id, version_id, revision, content_hash, char_count, state, updated_at
FROM novel_fetch_workshop_bodies
WHERE owner_username=? AND state='ready'
ORDER BY updated_at ASC, book_id ASC, version_id ASC
LIMIT ?`, owner, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]BodySyncCandidate, 0, limit)
	for rows.Next() {
		var item BodySyncCandidate
		var updated time.Time
		if err := rows.Scan(&item.BookID, &item.VersionID, &item.Revision, &item.ContentHash, &item.CharCount, &item.State, &updated); err != nil {
			return nil, err
		}
		item.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
