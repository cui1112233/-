package store

import (
	"context"
	"database/sql"

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
