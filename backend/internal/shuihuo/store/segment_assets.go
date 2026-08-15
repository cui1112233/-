package store

import (
	"context"
	"database/sql"
	"fmt"
)

type SegmentAssets struct{ db *sql.DB }

func NewSegmentAssets(db *sql.DB) *SegmentAssets { return &SegmentAssets{db: db} }

func (s *SegmentAssets) ListAssetIDs(ctx context.Context, ownerID, segmentID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT sa.asset_id
FROM shuihuo_segment_assets sa
JOIN shuihuo_segments s ON s.id = sa.segment_id
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE sa.segment_id = ? AND p.user_id = ?
ORDER BY sa.asset_id
`, segmentID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *SegmentAssets) Replace(ctx context.Context, ownerID, segmentID int64, assetIDs []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var projectID int64
	if err := tx.QueryRowContext(ctx, `
SELECT s.project_id
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.id = ? AND p.user_id = ?
`, segmentID, ownerID).Scan(&projectID); err != nil {
		return err
	}
	seen := make(map[int64]struct{}, len(assetIDs))
	for _, assetID := range assetIDs {
		if assetID < 1 {
			return fmt.Errorf("invalid asset id")
		}
		if _, duplicate := seen[assetID]; duplicate {
			return fmt.Errorf("duplicate asset id")
		}
		seen[assetID] = struct{}{}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM shuihuo_assets WHERE id = ? AND project_id = ?`, assetID, projectID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("asset does not belong to project")
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segment_assets WHERE segment_id = ?`, segmentID); err != nil {
		return err
	}
	for _, assetID := range assetIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_segment_assets(segment_id, asset_id) VALUES(?, ?)`, segmentID, assetID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
