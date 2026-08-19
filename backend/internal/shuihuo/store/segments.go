package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

var ErrMappedSegmentStructureChange = errors.New("mapped storyboard source text and order are immutable")

type Segments struct{ db *sql.DB }

func NewSegments(db *sql.DB) *Segments { return &Segments{db: db} }

func (s *Segments) Create(ctx context.Context, ownerID, projectID int64, segment domain.Segment) (domain.Segment, error) {
	return NewSourceUnits(s.db).CreateManualSegment(ctx, ownerID, projectID, segment)
}

func (s *Segments) ReplaceConfirmed(ctx context.Context, ownerID, projectID int64, candidates []domain.Segment) error {
	return NewSourceUnits(s.db).ReplaceConfirmedFromCandidates(ctx, ownerID, projectID, candidates)
}

func (s *Segments) GetSegment(ctx context.Context, ownerID, segmentID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := s.db.QueryRowContext(ctx, `
	SELECT s.id, s.project_id, s.source_text, s.subtitle_text, s.speaker, s.order_index, s.confirmed, s.manually_edited,
       s.image_prompt, s.video_prompt, s.negative_prompt, s.image_prompt_locked, s.video_prompt_locked, s.negative_prompt_locked
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.id = ? AND p.user_id = ?
`, segmentID, ownerID).Scan(
		&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited,
		&segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked,
	)
	return segment, err
}

func (s *Segments) GetForWorker(ctx context.Context, projectID, segmentID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := s.db.QueryRowContext(ctx, `
SELECT id, project_id, source_text, subtitle_text, speaker, order_index, confirmed, manually_edited, image_prompt, video_prompt, negative_prompt, image_prompt_locked, video_prompt_locked, negative_prompt_locked
FROM shuihuo_segments
WHERE id = ? AND project_id = ?
`, segmentID, projectID).Scan(&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited, &segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked)
	return segment, err
}

func (s *Segments) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Segment, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT s.id, s.project_id, s.source_text, s.subtitle_text, s.speaker, s.order_index, s.confirmed, s.manually_edited,
       s.image_prompt, s.video_prompt, s.negative_prompt, s.image_prompt_locked, s.video_prompt_locked, s.negative_prompt_locked
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
		if err := rows.Scan(&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited, &segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func (s *Segments) Update(ctx context.Context, ownerID int64, segment domain.Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	projectID, err := lockOwnedProjectForSegment(ctx, tx, ownerID, segment.ID)
	if err != nil {
		return err
	}
	current, err := segmentForProject(ctx, tx, segment.ID, projectID)
	if err != nil {
		return err
	}
	var mappingCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM shuihuo_segment_source_units WHERE segment_id = ?`, segment.ID).Scan(&mappingCount); err != nil {
		return err
	}
	structuralChange := segment.SourceText != current.SourceText || segment.OrderIndex != current.OrderIndex
	if structuralChange {
		if err := requireNoActiveTasks(ctx, sourceUnitTxAdapter{tx: tx}, projectID); err != nil {
			return err
		}
	}
	if mappingCount > 0 && structuralChange {
		return ErrMappedSegmentStructureChange
	}
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_segments
SET source_text = ?, subtitle_text = ?, speaker = ?, order_index = ?, confirmed = ?, manually_edited = ?,
    image_prompt = ?, video_prompt = ?, negative_prompt = ?, image_prompt_locked = ?, video_prompt_locked = ?, negative_prompt_locked = ?
WHERE id = ? AND project_id = ?
`, segment.SourceText, segment.SubtitleText, normalizeSpeaker(segment.Speaker), segment.OrderIndex, segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked, segment.ID, projectID)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Segments) UpdatePrompts(ctx context.Context, ownerID, segmentID int64, imagePrompt, videoPrompt, negativePrompt string, imageLocked, videoLocked, negativeLocked bool) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
SET s.image_prompt = ?, s.video_prompt = ?, s.negative_prompt = ?, s.image_prompt_locked = ?, s.video_prompt_locked = ?, s.negative_prompt_locked = ?
WHERE s.id = ? AND p.user_id = ?
`, imagePrompt, videoPrompt, negativePrompt, imageLocked, videoLocked, negativeLocked, segmentID, ownerID)
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
	projectID, err := lockOwnedProjectForSegment(ctx, tx, ownerID, segmentID)
	if err != nil {
		return err
	}
	if err := requireNoActiveTasks(ctx, sourceUnitTxAdapter{tx: tx}, projectID); err != nil {
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
	if err := lockOwnedProjectByID(ctx, tx, ownerID, projectID); err != nil {
		return err
	}
	if err := requireNoActiveTasks(ctx, sourceUnitTxAdapter{tx: tx}, projectID); err != nil {
		return err
	}
	if err := s.reorder(ctx, tx, projectID, ids); err != nil {
		return err
	}
	return tx.Commit()
}

func lockOwnedProjectByID(ctx context.Context, tx *sql.Tx, ownerID, projectID int64) error {
	var id int64
	return tx.QueryRowContext(ctx, `SELECT id FROM shuihuo_projects WHERE id = ? AND user_id = ? FOR UPDATE`, projectID, ownerID).Scan(&id)
}

func lockOwnedProjectForSegment(ctx context.Context, tx *sql.Tx, ownerID, segmentID int64) (int64, error) {
	var projectID int64
	err := tx.QueryRowContext(ctx, `
SELECT p.id
FROM shuihuo_projects p
JOIN shuihuo_segments s ON s.project_id = p.id
WHERE s.id = ? AND p.user_id = ?
FOR UPDATE`, segmentID, ownerID).Scan(&projectID)
	return projectID, err
}

func segmentForProject(ctx context.Context, tx *sql.Tx, segmentID, projectID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := tx.QueryRowContext(ctx, `
SELECT id, project_id, source_text, subtitle_text, speaker, order_index, confirmed, manually_edited,
       image_prompt, video_prompt, negative_prompt, image_prompt_locked, video_prompt_locked, negative_prompt_locked
FROM shuihuo_segments
WHERE id = ? AND project_id = ?`, segmentID, projectID).Scan(
		&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited,
		&segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked,
	)
	return segment, err
}

func normalizeSpeaker(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "旁白"
	}
	return value
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
