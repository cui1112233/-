package store

import (
	"context"
	"database/sql"
	"errors"

	"qiantie/backend/internal/shuihuo/domain"
)

type Media struct{ db *sql.DB }

func NewMedia(db *sql.DB) *Media { return &Media{db: db} }

func (s *Media) Create(ctx context.Context, ownerID, projectID int64, media domain.Media) (domain.Media, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Media{}, err
	}
	defer tx.Rollback()
	if err := clearPrimaryImage(ctx, tx, media); err != nil {
		return domain.Media{}, err
	}
	result, err := tx.ExecContext(ctx, `
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
	if err := tx.Commit(); err != nil {
		return domain.Media{}, err
	}
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

func (s *Media) AttachSegment(ctx context.Context, ownerID, mediaID, segmentID int64) (domain.Media, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Media{}, err
	}
	defer tx.Rollback()

	var media domain.Media
	err = tx.QueryRowContext(ctx, `
SELECT m.id, m.project_id, m.segment_id, m.task_id, m.kind, m.object_key, m.source, m.manually_edited, m.width, m.height, m.duration_ms, m.is_primary
FROM shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.id = ? AND p.user_id = ?
`, mediaID, ownerID).Scan(&media.ID, &media.ProjectID, &media.SegmentID, &media.TaskID, &media.Kind, &media.ObjectKey, &media.Source, &media.ManuallyEdited, &media.Width, &media.Height, &media.DurationMS, &media.IsPrimary)
	if err != nil {
		return domain.Media{}, err
	}
	var verifiedSegmentID int64
	if err := tx.QueryRowContext(ctx, `
SELECT s.id
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.id = ? AND s.project_id = ? AND p.user_id = ?
FOR UPDATE
`, segmentID, media.ProjectID, ownerID).Scan(&verifiedSegmentID); err != nil {
		return domain.Media{}, err
	}
	wasPrimaryImage := media.Kind == "image" && media.IsPrimary
	if wasPrimaryImage {
		if err := clearPrimaryImage(ctx, tx, domain.Media{ProjectID: media.ProjectID, SegmentID: &segmentID, Kind: media.Kind, IsPrimary: true}); err != nil {
			return domain.Media{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_media m
JOIN shuihuo_projects p ON p.id = m.project_id
SET m.segment_id = ?, m.is_primary = CASE WHEN ? THEN TRUE ELSE m.is_primary END
WHERE m.id = ? AND p.user_id = ?
`, segmentID, wasPrimaryImage, mediaID, ownerID)
	if err != nil {
		return domain.Media{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Media{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Media{}, err
	}
	media.SegmentID = &segmentID
	media.IsPrimary = wasPrimaryImage || media.IsPrimary
	return media, nil
}

func (s *Media) SetPrimary(ctx context.Context, ownerID, mediaID int64) (domain.Media, error) {
	media, err := s.Get(ctx, ownerID, mediaID)
	if err != nil {
		return domain.Media{}, err
	}
	if media.Kind != "image" || media.SegmentID == nil {
		return domain.Media{}, errors.New("primary image requires an attached image")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Media{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_media SET is_primary = FALSE WHERE project_id = ? AND segment_id = ? AND kind = 'image'`, media.ProjectID, *media.SegmentID); err != nil {
		return domain.Media{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_media SET is_primary = TRUE WHERE id = ?`, mediaID); err != nil {
		return domain.Media{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Media{}, err
	}
	media.IsPrimary = true
	return media, nil
}

// PrimaryImage is used by the worker just before it submits a video task. The
// query deliberately does not take an owner ID because worker tasks are
// already scoped by their persisted project and are not browser requests.
func (s *Media) PrimaryImage(ctx context.Context, projectID, segmentID int64) (domain.Media, error) {
	var media domain.Media
	err := s.db.QueryRowContext(ctx, `
SELECT id, project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary
FROM shuihuo_media
WHERE project_id = ? AND segment_id = ? AND kind = 'image' AND is_primary = TRUE
ORDER BY updated_at DESC, id DESC
LIMIT 1
`, projectID, segmentID).Scan(
		&media.ID, &media.ProjectID, &media.SegmentID, &media.TaskID, &media.Kind,
		&media.ObjectKey, &media.Source, &media.ManuallyEdited, &media.Width,
		&media.Height, &media.DurationMS, &media.IsPrimary,
	)
	return media, err
}

// CreateGenerated persists a worker-owned media result. It does not accept a
// browser owner ID because the worker operates from a task that has already
// passed project and account validation.
func (s *Media) CreateGenerated(ctx context.Context, media domain.Media) (domain.Media, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Media{}, err
	}
	defer tx.Rollback()
	if err := clearPrimaryImage(ctx, tx, media); err != nil {
		return domain.Media{}, err
	}
	result, err := tx.ExecContext(ctx, `
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
	if err := tx.Commit(); err != nil {
		return domain.Media{}, err
	}
	return media, nil
}

// clearPrimaryImage runs in the same transaction as an insert so an image
// worker cannot leave more than one selected reference image for a segment.
func clearPrimaryImage(ctx context.Context, tx *sql.Tx, media domain.Media) error {
	if media.Kind != "image" || !media.IsPrimary || media.SegmentID == nil {
		return nil
	}
	// Locking the segment also serializes concurrent first-image completions,
	// where there is no existing media row for the scoped UPDATE to lock yet.
	var segmentID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM shuihuo_segments WHERE id = ? AND project_id = ? FOR UPDATE`, *media.SegmentID, media.ProjectID).Scan(&segmentID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE shuihuo_media SET is_primary = FALSE WHERE project_id = ? AND segment_id = ? AND kind = 'image'`, media.ProjectID, *media.SegmentID)
	return err
}

func (s *Media) Delete(ctx context.Context, ownerID, mediaID int64) (domain.Media, error) {
	media, err := s.Get(ctx, ownerID, mediaID)
	if err != nil {
		return domain.Media{}, err
	}
	result, err := s.db.ExecContext(ctx, `DELETE m FROM shuihuo_media m JOIN shuihuo_projects p ON p.id=m.project_id WHERE m.id=? AND p.user_id=?`, mediaID, ownerID)
	if err != nil {
		return domain.Media{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Media{}, err
	}
	return media, nil
}
