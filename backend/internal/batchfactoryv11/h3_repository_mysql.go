package batchfactoryv11

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *MySQLStore) PersistH3AudioMeasurement(ctx context.Context, owner, batchID, bookID string, measurement H3AudioMeasurement) (H3AudioMeasurementRevision, error) {
	if err := validateH3AudioMeasurement(measurement); err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	director, err := loadLatestDirectorRevision(ctx, s.db, owner, batchID, bookID)
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	if director.Output.H3Director == nil || director.Output.H3Director.VideoSourceRevision != measurement.VideoSourceRevision || director.Output.H3Director.VideoSourceHash != measurement.VideoSourceHash {
		return H3AudioMeasurementRevision{}, fmt.Errorf("%w: audio measurement does not match active H3 video source", ErrConflict)
	}
	if existing, findErr := loadH3AudioMeasurement(ctx, s.db, owner, batchID, bookID, measurement.AssetID, measurement.ContentHash); findErr == nil {
		return existing, nil
	} else if !errors.Is(findErr, ErrNotFound) {
		return H3AudioMeasurementRevision{}, findErr
	}
	id, err := newID("h3-audio")
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO batch_factory_v12_audio_measurements(id,owner_username,batch_id,book_id,audio_asset_id,audio_content_hash,audio_duration_ms,video_source_revision,video_source_hash,probe_key,probe_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,'media-probe','v1',?)`, id, owner, batchID, bookID, measurement.AssetID, measurement.ContentHash, measurement.DurationMS, measurement.VideoSourceRevision, measurement.VideoSourceHash, now)
	if err != nil {
		if existing, findErr := loadH3AudioMeasurement(ctx, s.db, owner, batchID, bookID, measurement.AssetID, measurement.ContentHash); findErr == nil {
			return existing, nil
		}
		return H3AudioMeasurementRevision{}, err
	}
	return H3AudioMeasurementRevision{ID: id, Owner: owner, BatchID: batchID, BookID: bookID, Measurement: measurement, CreatedAt: now}, nil
}

func (s *MySQLStore) GetH3AudioMeasurement(ctx context.Context, owner, batchID, bookID, assetID string) (H3AudioMeasurementRevision, error) {
	return loadH3AudioMeasurement(ctx, s.db, owner, batchID, bookID, assetID, "")
}

func loadH3AudioMeasurement(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, batchID, bookID, assetID, contentHash string) (H3AudioMeasurementRevision, error) {
	query := `SELECT id,audio_content_hash,audio_duration_ms,video_source_revision,video_source_hash,created_at FROM batch_factory_v12_audio_measurements WHERE owner_username=? AND batch_id=? AND book_id=? AND audio_asset_id=?`
	args := []any{owner, batchID, bookID, assetID}
	if strings.TrimSpace(contentHash) != "" {
		query += ` AND audio_content_hash=?`
		args = append(args, contentHash)
	}
	query += ` ORDER BY created_at DESC,id DESC LIMIT 1`
	var value H3AudioMeasurementRevision
	value.Owner, value.BatchID, value.BookID = owner, batchID, bookID
	value.Measurement.AssetID = assetID
	err := q.QueryRowContext(ctx, query, args...).Scan(&value.ID, &value.Measurement.ContentHash, &value.Measurement.DurationMS, &value.Measurement.VideoSourceRevision, &value.Measurement.VideoSourceHash, &value.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return H3AudioMeasurementRevision{}, ErrNotFound
	}
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	return value, nil
}

func (s *MySQLStore) PersistH3CanonicalTimeline(ctx context.Context, owner, batchID, bookID string, timeline H3CanonicalTimeline) (H3CanonicalTimelineRevision, error) {
	if timeline.SchemaVersion != h3CanonicalTimelineSchemaV1 || strings.TrimSpace(timeline.InputHash) == "" || timeline.AudioDurationMS <= 0 {
		return H3CanonicalTimelineRevision{}, ErrInvalid
	}
	if existing, err := s.findH3CanonicalTimelineByInput(ctx, owner, bookID, timeline.InputHash); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return H3CanonicalTimelineRevision{}, err
	}
	var owns int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM batch_factory_v11_director_revisions WHERE id=? AND owner_username=? AND batch_id=? AND book_id=?`, timeline.DirectorRevisionID, owner, batchID, bookID).Scan(&owns); err != nil {
		return H3CanonicalTimelineRevision{}, err
	}
	if owns != 1 {
		return H3CanonicalTimelineRevision{}, ErrNotFound
	}
	raw, err := json.Marshal(timeline)
	if err != nil {
		return H3CanonicalTimelineRevision{}, err
	}
	id, err := newID("h3-timeline")
	if err != nil {
		return H3CanonicalTimelineRevision{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO batch_factory_v12_canonical_timelines(id,owner_username,batch_id,book_id,director_revision_id,audio_asset_id,audio_content_hash,audio_duration_ms,allocator_version,timeline_json,input_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, owner, batchID, bookID, timeline.DirectorRevisionID, timeline.AudioAssetID, timeline.AudioContentHash, timeline.AudioDurationMS, timeline.AllocatorVersion, raw, timeline.InputHash, now)
	if err != nil {
		if existing, findErr := s.findH3CanonicalTimelineByInput(ctx, owner, bookID, timeline.InputHash); findErr == nil {
			return existing, nil
		}
		return H3CanonicalTimelineRevision{}, err
	}
	return H3CanonicalTimelineRevision{ID: id, Owner: owner, BatchID: batchID, BookID: bookID, Timeline: cloneH3Timeline(timeline), CreatedAt: now}, nil
}

func (s *MySQLStore) GetH3CanonicalTimeline(ctx context.Context, owner, id string) (H3CanonicalTimelineRevision, error) {
	return loadH3CanonicalTimeline(ctx, s.db, owner, `id=?`, id)
}

func (s *MySQLStore) findH3CanonicalTimelineByInput(ctx context.Context, owner, bookID, inputHash string) (H3CanonicalTimelineRevision, error) {
	return loadH3CanonicalTimeline(ctx, s.db, owner, `book_id=? AND input_hash=?`, bookID, inputHash)
}

func loadH3CanonicalTimeline(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, predicate string, args ...any) (H3CanonicalTimelineRevision, error) {
	query := `SELECT id,batch_id,book_id,timeline_json,created_at FROM batch_factory_v12_canonical_timelines WHERE owner_username=? AND ` + predicate
	values := append([]any{owner}, args...)
	var revision H3CanonicalTimelineRevision
	var raw []byte
	err := q.QueryRowContext(ctx, query, values...).Scan(&revision.ID, &revision.BatchID, &revision.BookID, &raw, &revision.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return H3CanonicalTimelineRevision{}, ErrNotFound
	}
	if err != nil {
		return H3CanonicalTimelineRevision{}, err
	}
	if err := json.Unmarshal(raw, &revision.Timeline); err != nil {
		return H3CanonicalTimelineRevision{}, ErrInvalid
	}
	revision.Owner = owner
	return revision, nil
}

func (s *MySQLStore) PersistH3VideoCompilation(ctx context.Context, owner, batchID, bookID string, compilation H3VideoCompilation) (H3VideoCompilationRevision, error) {
	if compilation.SchemaVersion != h3VideoCompilationSchemaV1 || strings.TrimSpace(compilation.InputHash) == "" || len(compilation.Segments) == 0 {
		return H3VideoCompilationRevision{}, ErrInvalid
	}
	if existing, err := s.findH3VideoCompilationByInput(ctx, owner, bookID, compilation.InputHash); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return H3VideoCompilationRevision{}, err
	}
	timeline, err := s.GetH3CanonicalTimeline(ctx, owner, compilation.CanonicalTimelineID)
	if err != nil {
		return H3VideoCompilationRevision{}, err
	}
	if timeline.BatchID != batchID || timeline.BookID != bookID || timeline.Timeline.DirectorRevisionID != compilation.DirectorRevisionID {
		return H3VideoCompilationRevision{}, ErrConflict
	}
	raw, err := json.Marshal(compilation)
	if err != nil {
		return H3VideoCompilationRevision{}, err
	}
	preset, err := json.Marshal(compilation.VideoPreset)
	if err != nil {
		return H3VideoCompilationRevision{}, err
	}
	id, err := newID("h3-compilation")
	if err != nil {
		return H3VideoCompilationRevision{}, err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `INSERT INTO batch_factory_v12_video_compilations(id,owner_username,batch_id,book_id,director_revision_id,canonical_timeline_id,video_preset_key,video_preset_revision,video_preset_snapshot,compiler_key,compiler_version,max_segment_ms,compilation_json,input_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, owner, batchID, bookID, compilation.DirectorRevisionID, compilation.CanonicalTimelineID, compilation.VideoPreset.Key, compilation.VideoPreset.Revision, preset, compilation.CompilerKey, compilation.CompilerVersion, compilation.MaxSegmentMS, raw, compilation.InputHash, now)
	if err != nil {
		if existing, findErr := s.findH3VideoCompilationByInput(ctx, owner, bookID, compilation.InputHash); findErr == nil {
			return existing, nil
		}
		return H3VideoCompilationRevision{}, err
	}
	return H3VideoCompilationRevision{ID: id, Owner: owner, BatchID: batchID, BookID: bookID, Compilation: cloneH3Compilation(compilation), CreatedAt: now}, nil
}

func (s *MySQLStore) GetH3VideoCompilation(ctx context.Context, owner, id string) (H3VideoCompilationRevision, error) {
	return loadH3VideoCompilation(ctx, s.db, owner, `id=?`, id)
}

func (s *MySQLStore) LatestH3VideoCompilation(ctx context.Context, owner, batchID, bookID, directorRevisionID string) (H3VideoCompilationRevision, error) {
	return loadH3VideoCompilation(ctx, s.db, owner, `batch_id=? AND book_id=? AND director_revision_id=? ORDER BY created_at DESC,id DESC LIMIT 1`, batchID, bookID, directorRevisionID)
}

func (s *MySQLStore) findH3VideoCompilationByInput(ctx context.Context, owner, bookID, inputHash string) (H3VideoCompilationRevision, error) {
	return loadH3VideoCompilation(ctx, s.db, owner, `book_id=? AND input_hash=?`, bookID, inputHash)
}

func loadH3VideoCompilation(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, predicate string, args ...any) (H3VideoCompilationRevision, error) {
	query := `SELECT id,batch_id,book_id,compilation_json,created_at FROM batch_factory_v12_video_compilations WHERE owner_username=? AND ` + predicate
	values := append([]any{owner}, args...)
	var revision H3VideoCompilationRevision
	var raw []byte
	err := q.QueryRowContext(ctx, query, values...).Scan(&revision.ID, &revision.BatchID, &revision.BookID, &raw, &revision.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return H3VideoCompilationRevision{}, ErrNotFound
	}
	if err != nil {
		return H3VideoCompilationRevision{}, err
	}
	if err := json.Unmarshal(raw, &revision.Compilation); err != nil {
		return H3VideoCompilationRevision{}, ErrInvalid
	}
	revision.Owner = owner
	return revision, nil
}

func (s *MySQLStore) ApplyH3CompilationVideos(ctx context.Context, owner, batchID, bookID string, revision H3VideoCompilationRevision) ([]Video, error) {
	stored, err := s.GetH3VideoCompilation(ctx, owner, revision.ID)
	if err != nil {
		return nil, err
	}
	if stored.BatchID != batchID || stored.BookID != bookID || len(stored.Compilation.Segments) == 0 {
		return nil, ErrConflict
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,ordinal,revision FROM batch_factory_v11_videos WHERE owner_username=? AND batch_id=? AND book_id=? AND compatibility_state='active' ORDER BY ordinal,id FOR UPDATE`, owner, batchID, bookID)
	if err != nil {
		return nil, err
	}
	type existingVideo struct {
		id       string
		ordinal  int
		revision int64
	}
	existing := []existingVideo{}
	for rows.Next() {
		var value existingVideo
		if err := rows.Scan(&value.id, &value.ordinal, &value.revision); err != nil {
			rows.Close()
			return nil, err
		}
		existing = append(existing, value)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	now := time.Now().UTC()
	videos := make([]Video, len(stored.Compilation.Segments))
	if len(existing) == len(stored.Compilation.Segments) {
		for index, segment := range stored.Compilation.Segments {
			value := existing[index]
			label := fmt.Sprintf("VIDEO %02d", index+1)
			if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_videos SET ordinal=?,revision=revision+1,updated_at=? WHERE id=? AND owner_username=?`, index, now, value.id, owner); err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_video_records SET label=?,video_prompt=?,duration_seconds=? WHERE video_id=?`, label, segment.EditableCopy, float64(segment.CanonicalDurationMS)/1000, value.id); err != nil {
				return nil, err
			}
			videos[index] = Video{ID: value.id, BatchID: batchID, BookID: bookID, Label: label, VideoPrompt: segment.EditableCopy, DurationSeconds: float64(segment.CanonicalDurationMS) / 1000, CompatibilityState: "active", Revision: value.revision + 1}
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_videos SET compatibility_state='orphaned',updated_at=? WHERE owner_username=? AND batch_id=? AND book_id=? AND compatibility_state='active'`, now, owner, batchID, bookID); err != nil {
			return nil, err
		}
		for index, segment := range stored.Compilation.Segments {
			videoID, err := newID("video")
			if err != nil {
				return nil, err
			}
			label := fmt.Sprintf("VIDEO %02d", index+1)
			if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_videos(id,batch_id,book_id,owner_username,ordinal,compatibility_state,revision,created_at,updated_at) VALUES(?,?,?,?,?,'active',1,?,?)`, videoID, batchID, bookID, owner, index, now, now); err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_video_records(video_id,label,video_prompt,visual_prompt,duration_seconds) VALUES(?,?,?,NULL,?)`, videoID, label, segment.EditableCopy, float64(segment.CanonicalDurationMS)/1000); err != nil {
				return nil, err
			}
			videos[index] = Video{ID: videoID, BatchID: batchID, BookID: bookID, Label: label, VideoPrompt: segment.EditableCopy, DurationSeconds: float64(segment.CanonicalDurationMS) / 1000, CompatibilityState: "active", Revision: 1}
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_books SET revision=revision+1,updated_at=? WHERE id=? AND batch_id=? AND owner_username=?`, now, bookID, batchID, owner)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return videos, nil
}
