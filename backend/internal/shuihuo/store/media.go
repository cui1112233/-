package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

type Media struct{ db *sql.DB }

func NewMedia(db *sql.DB) *Media { return &Media{db: db} }

func (s *Media) Create(ctx context.Context, ownerID, projectID int64, media domain.Media) (domain.Media, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_media(project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary)
SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, media.SegmentID, media.TaskID, media.Kind, media.ObjectKey, media.Source, media.ManuallyEdited, media.Width, media.Height, media.DurationMS, media.IsPrimary, projectID, ownerID)
	if err != nil {
		return domain.Media{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Media{}, err
	}
	media.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Media{}, err
	}
	media.ProjectID = projectID
	return media, nil
}

func (s *Media) Get(ctx context.Context, ownerID, mediaID int64) (domain.Media, error) {
	var media domain.Media
	err := s.db.QueryRowContext(ctx, `
SELECT m.id, m.project_id, m.segment_id, m.task_id, m.kind, m.object_key, m.source, m.manually_edited, m.width, m.height, m.duration_ms, m.is_primary
FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.id = ? AND p.user_id = ?
`, mediaID, ownerID).Scan(&media.ID, &media.ProjectID, &media.SegmentID, &media.TaskID, &media.Kind, &media.ObjectKey, &media.Source, &media.ManuallyEdited, &media.Width, &media.Height, &media.DurationMS, &media.IsPrimary)
	return media, err
}

func scanMedia(rows *sql.Rows) ([]domain.Media, error) {
	media := make([]domain.Media, 0)
	for rows.Next() {
		var item domain.Media
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.SegmentID, &item.TaskID, &item.Kind, &item.ObjectKey, &item.Source, &item.ManuallyEdited, &item.Width, &item.Height, &item.DurationMS, &item.IsPrimary); err != nil {
			return nil, err
		}
		media = append(media, item)
	}
	return media, rows.Err()
}

func (s *Media) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Media, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT m.id, m.project_id, m.segment_id, m.task_id, m.kind, m.object_key, m.source, m.manually_edited, m.width, m.height, m.duration_ms, m.is_primary
FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.project_id = ? AND p.user_id = ?
ORDER BY m.created_at ASC, m.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMedia(rows)
}

func (s *Media) ListByProjects(ctx context.Context, ownerID int64, projectIDs []int64) ([]domain.Media, error) {
	if len(projectIDs) == 0 {
		return []domain.Media{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(projectIDs)), ",")
	args := make([]any, 0, len(projectIDs)+1)
	for _, projectID := range projectIDs {
		args = append(args, projectID)
	}
	args = append(args, ownerID)
	rows, err := s.db.QueryContext(ctx, `
SELECT m.id, m.project_id, m.segment_id, m.task_id, m.kind, m.object_key, m.source, m.manually_edited, m.width, m.height, m.duration_ms, m.is_primary
FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.project_id IN (`+placeholders+`) AND p.user_id = ?
ORDER BY m.project_id ASC, m.created_at ASC, m.id ASC
`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMedia(rows)
}

func (s *Media) Update(ctx context.Context, ownerID int64, media domain.Media) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
SET m.segment_id = ?, m.task_id = ?, m.kind = ?, m.object_key = ?, m.source = ?, m.manually_edited = ?, m.width = ?, m.height = ?, m.duration_ms = ?, m.is_primary = ?
WHERE m.id = ? AND p.user_id = ?
`, media.SegmentID, media.TaskID, media.Kind, media.ObjectKey, media.Source, media.ManuallyEdited, media.Width, media.Height, media.DurationMS, media.IsPrimary, media.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Media) Delete(ctx context.Context, ownerID, mediaID int64) error {
	result, err := s.db.ExecContext(ctx, `
DELETE m FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.id = ? AND p.user_id = ?
`, mediaID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Media) SetPrimary(ctx context.Context, ownerID, mediaID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var projectID int64
	var segmentID *int64
	var kind string
	if err := tx.QueryRowContext(ctx, `
SELECT m.project_id, m.segment_id, m.kind
FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.id = ? AND p.user_id = ?
`, mediaID, ownerID).Scan(&projectID, &segmentID, &kind); err != nil {
		return err
	}
	if segmentID == nil {
		return fmt.Errorf("only segment media can be primary")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_media SET is_primary = FALSE WHERE project_id = ? AND segment_id = ? AND kind = ?`, projectID, *segmentID, kind); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_media SET is_primary = TRUE WHERE id = ?`, mediaID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Media) PrimaryImage(ctx context.Context, projectID, segmentID int64) (domain.Media, error) {
	var media domain.Media
	err := s.db.QueryRowContext(ctx, `
SELECT id, project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary
FROM shuihuo_media
WHERE project_id = ? AND segment_id = ? AND kind = 'image' AND is_primary = TRUE
ORDER BY updated_at DESC, id DESC
LIMIT 1
`, projectID, segmentID).Scan(&media.ID, &media.ProjectID, &media.SegmentID, &media.TaskID, &media.Kind, &media.ObjectKey, &media.Source, &media.ManuallyEdited, &media.Width, &media.Height, &media.DurationMS, &media.IsPrimary)
	return media, err
}

func (s *Media) CreateGenerated(ctx context.Context, media domain.Media) (domain.Media, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_media(project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, media.ProjectID, media.SegmentID, media.TaskID, media.Kind, media.ObjectKey, media.Source, media.ManuallyEdited, media.Width, media.Height, media.DurationMS, media.IsPrimary)
	if err != nil {
		return domain.Media{}, err
	}
	media.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Media{}, err
	}
	return media, nil
}
