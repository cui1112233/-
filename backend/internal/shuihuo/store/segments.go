package store

import (
	"context"
	"database/sql"
	"fmt"

	"qiantie/backend/internal/shuihuo/domain"
)

type Segments struct{ db *sql.DB }

func NewSegments(db *sql.DB) *Segments { return &Segments{db: db} }

func (s *Segments) Create(ctx context.Context, ownerID, projectID int64, segment domain.Segment) (domain.Segment, error) {
	result, err := s.db.ExecContext(ctx, `
	INSERT INTO shuihuo_segments(project_id, source_text, subtitle_text, order_index, confirmed, manually_edited, image_prompt, video_prompt, image_prompt_locked, video_prompt_locked)
	SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?
	FROM shuihuo_projects
	WHERE id = ? AND user_id = ?
	`, segment.SourceText, segment.SubtitleText, segment.OrderIndex, segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, projectID, ownerID)
	if err != nil {
		return domain.Segment{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Segment{}, err
	}
	segment.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Segment{}, err
	}
	segment.ProjectID = projectID
	return segment, nil
}

func (s *Segments) ReplaceConfirmed(ctx context.Context, ownerID, projectID int64, candidates []domain.Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_projects
SET segmentation_status = 'candidate'
WHERE id = ? AND user_id = ?
`, projectID, ownerID)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE s FROM shuihuo_segments s JOIN shuihuo_projects p ON p.id = s.project_id WHERE s.project_id = ? AND p.user_id = ?`, projectID, ownerID); err != nil {
		return err
	}
	for index, candidate := range candidates {
		if candidate.SourceText == "" {
			return fmt.Errorf("segment %d source text is required", index+1)
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO shuihuo_segments(project_id, source_text, subtitle_text, order_index, confirmed, manually_edited, image_prompt, video_prompt, image_prompt_locked, video_prompt_locked)
VALUES(?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?)
`, projectID, candidate.SourceText, candidate.SubtitleText, index+1, candidate.ManuallyEdited, candidate.ImagePrompt, candidate.VideoPrompt, candidate.ImagePromptLocked, candidate.VideoPromptLocked); err != nil {
			return err
		}
	}
	result, err = tx.ExecContext(ctx, `UPDATE shuihuo_projects SET segmentation_status = 'confirmed', segmentation_version = segmentation_version + 1 WHERE id = ? AND user_id = ?`, projectID, ownerID)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Segments) GetSegment(ctx context.Context, ownerID, segmentID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := s.db.QueryRowContext(ctx, `
	SELECT s.id, s.project_id, s.source_text, s.subtitle_text, s.order_index, s.confirmed, s.manually_edited,
       s.image_prompt, s.video_prompt, s.image_prompt_locked, s.video_prompt_locked
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.id = ? AND p.user_id = ?
`, segmentID, ownerID).Scan(
		&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited,
		&segment.ImagePrompt, &segment.VideoPrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked,
	)
	return segment, err
}

func (s *Segments) GetForWorker(ctx context.Context, projectID, segmentID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := s.db.QueryRowContext(ctx, `
SELECT id, project_id, source_text, subtitle_text, order_index, confirmed, manually_edited, image_prompt, video_prompt, image_prompt_locked, video_prompt_locked
FROM shuihuo_segments
WHERE id = ? AND project_id = ?
`, segmentID, projectID).Scan(&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited, &segment.ImagePrompt, &segment.VideoPrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked)
	return segment, err
}

func (s *Segments) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Segment, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT s.id, s.project_id, s.source_text, s.subtitle_text, s.order_index, s.confirmed, s.manually_edited,
       s.image_prompt, s.video_prompt, s.image_prompt_locked, s.video_prompt_locked
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.project_id = ? AND p.user_id = ?
ORDER BY s.order_index ASC, s.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	segments := make([]domain.Segment, 0)
	for rows.Next() {
		var segment domain.Segment
		if err := rows.Scan(&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited, &segment.ImagePrompt, &segment.VideoPrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func (s *Segments) Update(ctx context.Context, ownerID int64, segment domain.Segment) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
	SET s.source_text = ?, s.subtitle_text = ?, s.order_index = ?, s.confirmed = ?, s.manually_edited = ?,
    s.image_prompt = ?, s.video_prompt = ?, s.image_prompt_locked = ?, s.video_prompt_locked = ?
WHERE s.id = ? AND p.user_id = ?
	`, segment.SourceText, segment.SubtitleText, segment.OrderIndex, segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Segments) UpdatePrompts(ctx context.Context, ownerID, segmentID int64, imagePrompt, videoPrompt string, imageLocked, videoLocked bool) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
SET s.image_prompt = ?, s.video_prompt = ?, s.image_prompt_locked = ?, s.video_prompt_locked = ?
WHERE s.id = ? AND p.user_id = ?
`, imagePrompt, videoPrompt, imageLocked, videoLocked, segmentID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Segments) Delete(ctx context.Context, ownerID, segmentID int64) error {
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segments WHERE id = ?`, segmentID); err != nil {
		return err
	}
	if err := s.renumber(ctx, tx, projectID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Segments) Reorder(ctx context.Context, ownerID, projectID int64, ids []int64) error {
	if len(ids) == 0 {
		return fmt.Errorf("segment order is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM shuihuo_projects WHERE id = ? AND user_id = ?`, projectID, ownerID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	if err := s.reorder(ctx, tx, projectID, ids); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Segments) reorder(ctx context.Context, tx *sql.Tx, projectID int64, ids []int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM shuihuo_segments WHERE project_id = ?`, projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	existing := make(map[int64]struct{}, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		existing[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(existing) != len(ids) {
		return fmt.Errorf("segment order must include every project segment")
	}
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := existing[id]; !ok {
			return fmt.Errorf("segment does not belong to project")
		}
		if _, duplicate := seen[id]; duplicate {
			return fmt.Errorf("segment order contains duplicates")
		}
		seen[id] = struct{}{}
	}
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segments SET order_index = ? WHERE id = ?`, -(index + 1), id); err != nil {
			return err
		}
	}
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segments SET order_index = ? WHERE id = ?`, index+1, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Segments) renumber(ctx context.Context, tx *sql.Tx, projectID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM shuihuo_segments WHERE project_id = ? ORDER BY order_index, id`, projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(ids) > 0 {
		if err := s.reorder(ctx, tx, projectID, ids); err != nil {
			return err
		}
	}
	return nil
}
