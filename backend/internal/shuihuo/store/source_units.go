package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

var (
	ErrCannotMergeFirstStoryboard       = errors.New("first storyboard cannot merge upward")
	ErrCannotSplitSingleSource          = errors.New("storyboard has only one source unit")
	ErrStoryboardMutationHasActiveTasks = errors.New("storyboard mutation has active tasks")
)

// SourceUnits owns the durable source-text mapping used by reversible storyboard
// edits. Segment.SourceText is intentionally kept as a derived compatibility cache.
type SourceUnits struct{ db sourceUnitDB }

func NewSourceUnits(db *sql.DB) *SourceUnits {
	return &SourceUnits{db: sourceUnitDBAdapter{db: db}}
}

func newSourceUnitsWithDB(db sourceUnitDB) *SourceUnits { return &SourceUnits{db: db} }

type sourceUnitRow interface{ Scan(...any) error }

type sourceUnitRows interface {
	Close() error
	Err() error
	Next() bool
	Scan(...any) error
}

type sourceUnitQueryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (sourceUnitRows, error)
	QueryRowContext(context.Context, string, ...any) sourceUnitRow
}

type sourceUnitTx interface {
	sourceUnitQueryer
	Commit() error
	Rollback() error
}

type sourceUnitDB interface {
	sourceUnitQueryer
	BeginTx(context.Context, *sql.TxOptions) (sourceUnitTx, error)
}

type sourceUnitDBAdapter struct{ db *sql.DB }

func (d sourceUnitDBAdapter) BeginTx(ctx context.Context, options *sql.TxOptions) (sourceUnitTx, error) {
	tx, err := d.db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return sourceUnitTxAdapter{tx: tx}, nil
}
func (d sourceUnitDBAdapter) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.db.ExecContext(ctx, query, args...)
}
func (d sourceUnitDBAdapter) QueryContext(ctx context.Context, query string, args ...any) (sourceUnitRows, error) {
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return sourceUnitRowsAdapter{rows: rows}, nil
}
func (d sourceUnitDBAdapter) QueryRowContext(ctx context.Context, query string, args ...any) sourceUnitRow {
	return d.db.QueryRowContext(ctx, query, args...)
}

type sourceUnitTxAdapter struct{ tx *sql.Tx }

func (t sourceUnitTxAdapter) Commit() error   { return t.tx.Commit() }
func (t sourceUnitTxAdapter) Rollback() error { return t.tx.Rollback() }
func (t sourceUnitTxAdapter) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, query, args...)
}
func (t sourceUnitTxAdapter) QueryContext(ctx context.Context, query string, args ...any) (sourceUnitRows, error) {
	rows, err := t.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return sourceUnitRowsAdapter{rows: rows}, nil
}
func (t sourceUnitTxAdapter) QueryRowContext(ctx context.Context, query string, args ...any) sourceUnitRow {
	return t.tx.QueryRowContext(ctx, query, args...)
}

type sourceUnitRowsAdapter struct{ rows *sql.Rows }

func (r sourceUnitRowsAdapter) Close() error           { return r.rows.Close() }
func (r sourceUnitRowsAdapter) Err() error             { return r.rows.Err() }
func (r sourceUnitRowsAdapter) Next() bool             { return r.rows.Next() }
func (r sourceUnitRowsAdapter) Scan(dest ...any) error { return r.rows.Scan(dest...) }

func (s *SourceUnits) ReplaceConfirmedFromCandidates(ctx context.Context, ownerID, projectID int64, candidates []domain.Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockOwnedProject(ctx, tx, ownerID, projectID); err != nil {
		return err
	}
	if err := requireNoActiveTasks(ctx, tx, projectID); err != nil {
		return err
	}
	currentVersion, err := projectSegmentationVersion(ctx, tx, projectID)
	if err != nil {
		return err
	}
	nextVersion := currentVersion + 1
	for index, candidate := range candidates {
		if strings.TrimSpace(candidate.SourceText) == "" {
			return fmt.Errorf("segment %d source text is required", index+1)
		}
	}
	if err := archiveSourceMappings(ctx, tx, projectID, currentVersion); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segments WHERE project_id = ?`, projectID); err != nil {
		return err
	}
	for index, candidate := range candidates {
		unitID, err := insertSourceUnit(ctx, tx, projectID, candidate.SourceText, "confirmed_candidate", nextVersion, index+1)
		if err != nil {
			return err
		}
		segmentID, err := insertSegment(ctx, tx, projectID, candidate, index+1, true)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_segment_source_units(segment_id, source_unit_id, position_index) VALUES(?, ?, 1)`, segmentID, unitID); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE shuihuo_projects SET segmentation_status = 'confirmed', segmentation_version = segmentation_version + 1 WHERE id = ? AND user_id = ?`, projectID, ownerID)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SourceUnits) CreateManualSegment(ctx context.Context, ownerID, projectID int64, segment domain.Segment) (domain.Segment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Segment{}, err
	}
	defer tx.Rollback()
	if err := lockOwnedProject(ctx, tx, ownerID, projectID); err != nil {
		return domain.Segment{}, err
	}
	if err := requireNoActiveTasks(ctx, tx, projectID); err != nil {
		return domain.Segment{}, err
	}
	segmentationVersion, err := projectSegmentationVersion(ctx, tx, projectID)
	if err != nil {
		return domain.Segment{}, err
	}
	if strings.TrimSpace(segment.SourceText) == "" {
		return domain.Segment{}, errors.New("source text is required")
	}
	var sourceOrder int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(source_order), 0) + 1 FROM shuihuo_source_units WHERE project_id = ? AND segmentation_version = ? FOR UPDATE`, projectID, segmentationVersion).Scan(&sourceOrder); err != nil {
		return domain.Segment{}, err
	}
	unitID, err := insertSourceUnit(ctx, tx, projectID, segment.SourceText, "manual", segmentationVersion, sourceOrder)
	if err != nil {
		return domain.Segment{}, err
	}
	if segment.OrderIndex < 1 {
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(order_index), 0) + 1 FROM shuihuo_segments WHERE project_id = ?`, projectID).Scan(&segment.OrderIndex); err != nil {
			return domain.Segment{}, err
		}
	}
	segmentID, err := insertSegment(ctx, tx, projectID, segment, segment.OrderIndex, segment.Confirmed)
	if err != nil {
		return domain.Segment{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_segment_source_units(segment_id, source_unit_id, position_index) VALUES(?, ?, 1)`, segmentID, unitID); err != nil {
		return domain.Segment{}, err
	}
	segment.ID, segment.ProjectID = segmentID, projectID
	if err := tx.Commit(); err != nil {
		return domain.Segment{}, err
	}
	return segment, nil
}

func (s *SourceUnits) MergeIntoPrevious(ctx context.Context, ownerID, segmentID int64) (domain.Segment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Segment{}, err
	}
	defer tx.Rollback()
	projectID, err := lockOwnedProjectForStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return domain.Segment{}, err
	}
	if err := requireNoActiveTasks(ctx, tx, projectID); err != nil {
		return domain.Segment{}, err
	}
	current, err := ownedStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return domain.Segment{}, err
	}
	previous, err := previousStoryboard(ctx, tx, current.ProjectID, current.OrderIndex)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Segment{}, ErrCannotMergeFirstStoryboard
	}
	if err != nil {
		return domain.Segment{}, err
	}
	previousMappings, err := storyboardMappings(ctx, tx, previous.ID)
	if err != nil {
		return domain.Segment{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segment_source_units SET position_index = -position_index WHERE segment_id = ?`, current.ID); err != nil {
		return domain.Segment{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = -position_index + ? WHERE segment_id = ?`, previous.ID, len(previousMappings), current.ID); err != nil {
		return domain.Segment{}, err
	}
	text, err := storyboardSourceText(ctx, tx, previous.ID)
	if err != nil {
		return domain.Segment{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segments SET source_text = ? WHERE id = ?`, text, previous.ID); err != nil {
		return domain.Segment{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segments WHERE id = ?`, current.ID); err != nil {
		return domain.Segment{}, err
	}
	if err := renumberStoryboards(ctx, tx, projectID); err != nil {
		return domain.Segment{}, err
	}
	previous.SourceText = text
	if err := tx.Commit(); err != nil {
		return domain.Segment{}, err
	}
	return previous, nil
}

func (s *SourceUnits) Split(ctx context.Context, ownerID, segmentID int64) ([]domain.Segment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	projectID, err := lockOwnedProjectForStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return nil, err
	}
	if err := requireNoActiveTasks(ctx, tx, projectID); err != nil {
		return nil, err
	}
	segment, err := ownedStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return nil, err
	}
	mappings, err := storyboardMappings(ctx, tx, segment.ID)
	if err != nil {
		return nil, err
	}
	if len(mappings) < 2 {
		return nil, ErrCannotSplitSingleSource
	}
	if err := shiftStoryboardsAfter(ctx, tx, projectID, segment.OrderIndex, len(mappings)-1); err != nil {
		return nil, err
	}
	first := mappings[0]
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segment_source_units SET position_index = 1 WHERE segment_id = ? AND source_unit_id = ?`, segment.ID, first.UnitID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segments SET source_text = ? WHERE id = ?`, first.Text, segment.ID); err != nil {
		return nil, err
	}
	segment.SourceText = first.Text
	restored := []domain.Segment{segment}
	for index, mapping := range mappings[1:] {
		clone := segment
		clone.ID = 0
		clone.SourceText = mapping.Text
		clone.OrderIndex = segment.OrderIndex + index + 1
		newID, err := insertSegment(ctx, tx, projectID, clone, clone.OrderIndex, clone.Confirmed)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = 1 WHERE segment_id = ? AND source_unit_id = ?`, newID, segment.ID, mapping.UnitID); err != nil {
			return nil, err
		}
		clone.ID, clone.ProjectID = newID, projectID
		restored = append(restored, clone)
	}
	if err := renumberStoryboards(ctx, tx, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return restored, nil
}

func (s *SourceUnits) InsertAfter(ctx context.Context, ownerID, segmentID int64, sourceText, subtitleText string) (domain.Segment, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Segment{}, err
	}
	defer tx.Rollback()
	projectID, err := lockOwnedProjectForStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return domain.Segment{}, err
	}
	if err := requireNoActiveTasks(ctx, tx, projectID); err != nil {
		return domain.Segment{}, err
	}
	segment, err := ownedStoryboard(ctx, tx, ownerID, segmentID)
	if err != nil {
		return domain.Segment{}, err
	}
	if strings.TrimSpace(sourceText) == "" {
		return domain.Segment{}, errors.New("source text is required")
	}
	segmentationVersion, err := projectSegmentationVersion(ctx, tx, projectID)
	if err != nil {
		return domain.Segment{}, err
	}
	var precedingSourceOrder int
	if err := tx.QueryRowContext(ctx, `
SELECT COALESCE(MAX(u.source_order), 0)
FROM shuihuo_segment_source_units m
JOIN shuihuo_source_units u ON u.id = m.source_unit_id
WHERE m.segment_id = ?`, segment.ID).Scan(&precedingSourceOrder); err != nil {
		return domain.Segment{}, err
	}
	if err := shiftSourceUnitsAfter(ctx, tx, projectID, segmentationVersion, precedingSourceOrder); err != nil {
		return domain.Segment{}, err
	}
	unitID, err := insertSourceUnit(ctx, tx, projectID, sourceText, "manual", segmentationVersion, precedingSourceOrder+1)
	if err != nil {
		return domain.Segment{}, err
	}
	if err := shiftStoryboardsAfter(ctx, tx, projectID, segment.OrderIndex, 1); err != nil {
		return domain.Segment{}, err
	}
	inserted := domain.Segment{SourceText: sourceText, SubtitleText: subtitleText, Speaker: "旁白", OrderIndex: segment.OrderIndex + 1, Confirmed: true, ManuallyEdited: true}
	inserted.ID, err = insertSegment(ctx, tx, projectID, inserted, inserted.OrderIndex, inserted.Confirmed)
	if err != nil {
		return domain.Segment{}, err
	}
	inserted.ProjectID = projectID
	if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_segment_source_units(segment_id, source_unit_id, position_index) VALUES(?, ?, 1)`, inserted.ID, unitID); err != nil {
		return domain.Segment{}, err
	}
	if err := renumberStoryboards(ctx, tx, projectID); err != nil {
		return domain.Segment{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Segment{}, err
	}
	return inserted, nil
}

// ReadProject returns the complete active workbench state from one repeatable
// read snapshot. Re-segmentation replaces rows atomically, so mixing queries
// from before and after that commit would otherwise produce unusable mappings.
func (s *SourceUnits) ReadProject(ctx context.Context, ownerID, projectID int64) (domain.ProjectReadModel, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	defer tx.Rollback()

	project, err := readOwnedProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	segments, err := listSegmentsByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	sourceUnits, err := listUnitsByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	mappings, err := listMappingsByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	assets, err := listAssetsByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	segmentAssetIDs, err := listSegmentAssetIDsByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	media, err := listMediaByProject(ctx, tx, ownerID, projectID)
	if err != nil {
		return domain.ProjectReadModel{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProjectReadModel{}, err
	}
	return domain.ProjectReadModel{
		Project:              project,
		Segments:             segments,
		SourceUnits:          sourceUnits,
		SegmentSourceUnitIDs: mappings,
		Assets:               assets,
		SegmentAssetIDs:      segmentAssetIDs,
		Media:                media,
	}, nil
}

func (s *SourceUnits) ListUnitsByProject(ctx context.Context, ownerID, projectID int64) ([]domain.SourceUnit, error) {
	return listUnitsByProject(ctx, s.db, ownerID, projectID)
}

func listUnitsByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) ([]domain.SourceUnit, error) {
	rows, err := q.QueryContext(ctx, `
	SELECT u.id, u.project_id, u.text, u.source_kind, u.segmentation_version, u.source_order, u.created_at
FROM shuihuo_source_units u
JOIN shuihuo_projects p ON p.id = u.project_id
JOIN shuihuo_segment_source_units m ON m.source_unit_id = u.id
JOIN shuihuo_segments s ON s.id = m.segment_id
WHERE u.project_id = ? AND p.user_id = ? AND u.segmentation_version = p.segmentation_version
ORDER BY u.source_order ASC, u.id ASC`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	units := make([]domain.SourceUnit, 0)
	for rows.Next() {
		var unit domain.SourceUnit
		if err := rows.Scan(&unit.ID, &unit.ProjectID, &unit.Text, &unit.SourceKind, &unit.SegmentationVersion, &unit.SourceOrder, &unit.CreatedAt); err != nil {
			return nil, err
		}
		units = append(units, unit)
	}
	return units, rows.Err()
}

// ListMappingsByProject groups ordered source-unit IDs by storyboard. The shape
// is convenient for the project read model and avoids one query per segment.
func (s *SourceUnits) ListMappingsByProject(ctx context.Context, ownerID, projectID int64) (map[int64][]int64, error) {
	return listMappingsByProject(ctx, s.db, ownerID, projectID)
}

func listMappingsByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) (map[int64][]int64, error) {
	rows, err := q.QueryContext(ctx, `
SELECT m.segment_id, m.source_unit_id
FROM shuihuo_segment_source_units m
JOIN shuihuo_segments s ON s.id = m.segment_id
JOIN shuihuo_source_units u ON u.id = m.source_unit_id
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.project_id = ? AND p.user_id = ? AND u.segmentation_version = p.segmentation_version
ORDER BY s.order_index ASC, m.position_index ASC, m.source_unit_id ASC`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mappings := make(map[int64][]int64)
	for rows.Next() {
		var segmentID, sourceUnitID int64
		if err := rows.Scan(&segmentID, &sourceUnitID); err != nil {
			return nil, err
		}
		mappings[segmentID] = append(mappings[segmentID], sourceUnitID)
	}
	return mappings, rows.Err()
}

func readOwnedProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) (domain.Project, error) {
	var project domain.Project
	err := q.QueryRowContext(ctx, `
SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version
FROM shuihuo_projects
WHERE id = ? AND user_id = ? AND segmentation_status <> 'importing'
`, projectID, ownerID).Scan(
		&project.ID, &project.UserID, &project.Name, &project.SourceText,
		&project.SourceObjectKey, &project.SegmentationStatus, &project.SegmentationVersion,
	)
	return project, err
}

func listSegmentsByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) ([]domain.Segment, error) {
	rows, err := q.QueryContext(ctx, `
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
		if err := rows.Scan(
			&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker,
			&segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited, &segment.ImagePrompt,
			&segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked,
		); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func listAssetsByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) ([]domain.Asset, error) {
	rows, err := q.QueryContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.voice_asset_id, a.reference_object_key, a.source, a.manually_edited, a.is_current
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.project_id = ? AND p.user_id = ? AND a.is_current = TRUE
ORDER BY a.created_at ASC, a.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(
			&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.VoiceAssetID,
			&asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited, &asset.IsCurrent,
		); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func listMediaByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) ([]domain.Media, error) {
	rows, err := q.QueryContext(ctx, `
SELECT m.id, m.project_id, m.segment_id, m.task_id, m.kind, m.object_key, m.source, m.manually_edited, m.width, m.height, m.duration_ms, m.is_primary, m.created_at, m.updated_at
FROM shuihuo_media m JOIN shuihuo_projects p ON p.id = m.project_id
WHERE m.project_id = ? AND p.user_id = ? ORDER BY m.created_at ASC, m.id ASC`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Media, 0)
	for rows.Next() {
		var item domain.Media
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.SegmentID, &item.TaskID, &item.Kind, &item.ObjectKey, &item.Source, &item.ManuallyEdited, &item.Width, &item.Height, &item.DurationMS, &item.IsPrimary, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listSegmentAssetIDsByProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) (map[int64][]int64, error) {
	rows, err := q.QueryContext(ctx, `
	SELECT sa.segment_id, sa.asset_id
	FROM shuihuo_segment_assets sa
	JOIN shuihuo_segments s ON s.id = sa.segment_id
	JOIN shuihuo_projects p ON p.id = s.project_id
	WHERE s.project_id = ? AND p.user_id = ?
	ORDER BY s.order_index ASC, sa.segment_id ASC, sa.asset_id ASC`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mappings := make(map[int64][]int64)
	for rows.Next() {
		var segmentID, assetID int64
		if err := rows.Scan(&segmentID, &assetID); err != nil {
			return nil, err
		}
		mappings[segmentID] = append(mappings[segmentID], assetID)
	}
	return mappings, rows.Err()
}

// ListHistoricalMappingsByProject exposes the preserved source identity for a
// prior confirmed segmentation without mixing it into the active workbench.
func (s *SourceUnits) ListHistoricalMappingsByProject(ctx context.Context, ownerID, projectID int64, segmentationVersion int) (map[int64][]int64, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT h.segment_id, h.source_unit_id
FROM shuihuo_segment_source_unit_history h
JOIN shuihuo_projects p ON p.id = h.project_id
WHERE h.project_id = ? AND p.user_id = ? AND h.segmentation_version = ?
ORDER BY h.segment_order_index ASC, h.position_index ASC, h.source_unit_id ASC`, projectID, ownerID, segmentationVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mappings := make(map[int64][]int64)
	for rows.Next() {
		var segmentID, sourceUnitID int64
		if err := rows.Scan(&segmentID, &sourceUnitID); err != nil {
			return nil, err
		}
		mappings[segmentID] = append(mappings[segmentID], sourceUnitID)
	}
	return mappings, rows.Err()
}

// ListHistoricalStoryboardsByProject returns a complete ordered read model for
// one archived segmentation version. It keeps the legacy ID-only mapping API
// available while allowing callers to reconstruct prior storyboard rows.
func (s *SourceUnits) ListHistoricalStoryboardsByProject(ctx context.Context, ownerID, projectID int64, segmentationVersion int) ([]domain.HistoricalStoryboard, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT h.segment_id, h.segment_order_index, h.source_unit_id, h.position_index, u.text
FROM shuihuo_segment_source_unit_history h
JOIN shuihuo_source_units u ON u.id = h.source_unit_id
JOIN shuihuo_projects p ON p.id = h.project_id
WHERE h.project_id = ? AND p.user_id = ? AND h.segmentation_version = ?
ORDER BY h.segment_order_index ASC, h.position_index ASC, h.source_unit_id ASC`, projectID, ownerID, segmentationVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	storyboards := make([]domain.HistoricalStoryboard, 0)
	storyboardIndex := make(map[int64]int)
	for rows.Next() {
		var segmentID, sourceUnitID int64
		var segmentOrder, positionIndex int
		var sourceText string
		if err := rows.Scan(&segmentID, &segmentOrder, &sourceUnitID, &positionIndex, &sourceText); err != nil {
			return nil, err
		}
		index, found := storyboardIndex[segmentID]
		if !found {
			index = len(storyboards)
			storyboardIndex[segmentID] = index
			storyboards = append(storyboards, domain.HistoricalStoryboard{SegmentID: segmentID, OrderIndex: segmentOrder, SourceUnits: make([]domain.HistoricalStoryboardSourceUnit, 0)})
		}
		storyboards[index].SourceUnits = append(storyboards[index].SourceUnits, domain.HistoricalStoryboardSourceUnit{ID: sourceUnitID, Text: sourceText, PositionIndex: positionIndex})
	}
	return storyboards, rows.Err()
}

type mappedSourceUnit struct {
	UnitID int64
	Text   string
}

func lockOwnedProject(ctx context.Context, q sourceUnitQueryer, ownerID, projectID int64) error {
	var id int64
	if err := q.QueryRowContext(ctx, `SELECT id FROM shuihuo_projects WHERE id = ? AND user_id = ? FOR UPDATE`, projectID, ownerID).Scan(&id); err != nil {
		return err
	}
	return nil
}

func lockOwnedProjectForStoryboard(ctx context.Context, q sourceUnitQueryer, ownerID, segmentID int64) (int64, error) {
	var projectID int64
	err := q.QueryRowContext(ctx, `
SELECT p.id
FROM shuihuo_projects p
JOIN shuihuo_segments s ON s.project_id = p.id
WHERE s.id = ? AND p.user_id = ?
FOR UPDATE`, segmentID, ownerID).Scan(&projectID)
	return projectID, err
}

func requireNoActiveTasks(ctx context.Context, q sourceUnitQueryer, projectID int64) error {
	var hasActiveTasks bool
	if err := q.QueryRowContext(ctx, `
SELECT EXISTS(
  SELECT 1 FROM shuihuo_tasks
  WHERE project_id = ? AND status IN ('queued', 'running')
)`, projectID).Scan(&hasActiveTasks); err != nil {
		return err
	}
	if hasActiveTasks {
		return ErrStoryboardMutationHasActiveTasks
	}
	return nil
}

func ownedStoryboard(ctx context.Context, q sourceUnitQueryer, ownerID, segmentID int64) (domain.Segment, error) {
	var segment domain.Segment
	err := q.QueryRowContext(ctx, `
SELECT s.id, s.project_id, s.source_text, s.subtitle_text, s.speaker, s.order_index, s.confirmed, s.manually_edited,
       s.image_prompt, s.video_prompt, s.negative_prompt, s.image_prompt_locked, s.video_prompt_locked, s.negative_prompt_locked
FROM shuihuo_segments s
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE s.id = ? AND p.user_id = ?`, segmentID, ownerID).Scan(
		&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited,
		&segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked,
	)
	return segment, err
}

func previousStoryboard(ctx context.Context, q sourceUnitQueryer, projectID int64, orderIndex int) (domain.Segment, error) {
	var segment domain.Segment
	err := q.QueryRowContext(ctx, `
SELECT id, project_id, source_text, subtitle_text, speaker, order_index, confirmed, manually_edited,
       image_prompt, video_prompt, negative_prompt, image_prompt_locked, video_prompt_locked, negative_prompt_locked
FROM shuihuo_segments
WHERE project_id = ? AND order_index < ?
ORDER BY order_index DESC, id DESC
LIMIT 1`, projectID, orderIndex).Scan(
		&segment.ID, &segment.ProjectID, &segment.SourceText, &segment.SubtitleText, &segment.Speaker, &segment.OrderIndex, &segment.Confirmed, &segment.ManuallyEdited,
		&segment.ImagePrompt, &segment.VideoPrompt, &segment.NegativePrompt, &segment.ImagePromptLocked, &segment.VideoPromptLocked, &segment.NegativePromptLocked,
	)
	return segment, err
}

func storyboardMappings(ctx context.Context, q sourceUnitQueryer, segmentID int64) ([]mappedSourceUnit, error) {
	rows, err := q.QueryContext(ctx, `
SELECT m.source_unit_id, u.text
FROM shuihuo_segment_source_units m
JOIN shuihuo_source_units u ON u.id = m.source_unit_id
WHERE m.segment_id = ?
ORDER BY m.position_index ASC, m.source_unit_id ASC`, segmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mappings := make([]mappedSourceUnit, 0)
	for rows.Next() {
		var mapping mappedSourceUnit
		if err := rows.Scan(&mapping.UnitID, &mapping.Text); err != nil {
			return nil, err
		}
		mappings = append(mappings, mapping)
	}
	return mappings, rows.Err()
}

func storyboardSourceText(ctx context.Context, q sourceUnitQueryer, segmentID int64) (string, error) {
	mappings, err := storyboardMappings(ctx, q, segmentID)
	if err != nil {
		return "", err
	}
	parts := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		parts = append(parts, mapping.Text)
	}
	return strings.Join(parts, "\n"), nil
}

func insertSourceUnit(ctx context.Context, q sourceUnitQueryer, projectID int64, text, sourceKind string, segmentationVersion, sourceOrder int) (int64, error) {
	result, err := q.ExecContext(ctx, `INSERT INTO shuihuo_source_units(project_id, text, source_kind, segmentation_version, source_order) VALUES(?, ?, ?, ?, ?)`, projectID, text, sourceKind, segmentationVersion, sourceOrder)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func insertSegment(ctx context.Context, q sourceUnitQueryer, projectID int64, segment domain.Segment, orderIndex int, confirmed bool) (int64, error) {
	result, err := q.ExecContext(ctx, `
INSERT INTO shuihuo_segments(project_id, source_text, subtitle_text, speaker, order_index, confirmed, manually_edited, image_prompt, video_prompt, negative_prompt, image_prompt_locked, video_prompt_locked, negative_prompt_locked)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, projectID, segment.SourceText, segment.SubtitleText, normalizeSpeaker(segment.Speaker), orderIndex, confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func shiftStoryboardsAfter(ctx context.Context, tx sourceUnitTx, projectID int64, orderIndex, count int) error {
	var maximum int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(order_index), 0) FROM shuihuo_segments WHERE project_id = ?`, projectID).Scan(&maximum); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE shuihuo_segments SET order_index = order_index + ? WHERE project_id = ? AND order_index > ?`, maximum+count+1, projectID, orderIndex)
	return err
}

// With a unique (project_id, source_order) key, a single increment can collide
// with the next row. Use a negative temporary range while the project lock is held.
func shiftSourceUnitsAfter(ctx context.Context, tx sourceUnitTx, projectID int64, segmentationVersion, sourceOrder int) error {
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_source_units SET source_order = -source_order WHERE project_id = ? AND segmentation_version = ? AND source_order > ?`, projectID, segmentationVersion, sourceOrder); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE shuihuo_source_units SET source_order = -source_order + 1 WHERE project_id = ? AND segmentation_version = ? AND source_order < 0`, projectID, segmentationVersion)
	return err
}

func projectSegmentationVersion(ctx context.Context, q sourceUnitQueryer, projectID int64) (int, error) {
	var version int
	err := q.QueryRowContext(ctx, `SELECT segmentation_version FROM shuihuo_projects WHERE id = ?`, projectID).Scan(&version)
	return version, err
}

func archiveSourceMappings(ctx context.Context, q sourceUnitQueryer, projectID int64, segmentationVersion int) error {
	_, err := q.ExecContext(ctx, `
INSERT IGNORE INTO shuihuo_segment_source_unit_history(project_id, segmentation_version, segment_id, segment_order_index, source_unit_id, position_index)
SELECT s.project_id, ?, m.segment_id, s.order_index, m.source_unit_id, m.position_index
FROM shuihuo_segment_source_units m
JOIN shuihuo_segments s ON s.id = m.segment_id
WHERE s.project_id = ?`, segmentationVersion, projectID)
	return err
}

func renumberStoryboards(ctx context.Context, tx sourceUnitTx, projectID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM shuihuo_segments WHERE project_id = ? ORDER BY order_index ASC, id ASC`, projectID)
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
