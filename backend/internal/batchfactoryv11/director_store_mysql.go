package batchfactoryv11

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"strings"
)

func (s *MySQLStore) CreateHookRevision(ctx context.Context, owner, batchID, bookID, text, digest string) (HookRevision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return HookRevision{}, err }
	defer tx.Rollback()
	var one int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM batch_factory_v11_books WHERE id=? AND batch_id=? AND owner_username=? FOR UPDATE`, bookID, batchID, owner).Scan(&one); errors.Is(err, sql.ErrNoRows) {
		return HookRevision{}, ErrNotFound
	} else if err != nil { return HookRevision{}, err }
	var current int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision),0) FROM batch_factory_v11_hook_revisions WHERE batch_id=? AND book_id=? AND owner_username=?`, batchID, bookID, owner).Scan(&current); err != nil { return HookRevision{}, err }
	id, err := newID("hook")
	if err != nil { return HookRevision{}, err }
	now := time.Now().UTC()
	value := HookRevision{ID: id, BatchID: batchID, BookID: bookID, Revision: current+1, Status: "draft", Text: text, SourceDigest: digest, CreatedAt: now}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_hook_revisions(id,batch_id,book_id,owner_username,revision,status,hook_text,source_digest,created_at) VALUES(?,?,?,?,?,'draft',?,?,?)`, id, batchID, bookID, owner, value.Revision, text, digest, now); err != nil { return HookRevision{}, err }
	if err := tx.Commit(); err != nil { return HookRevision{}, err }
	return value, nil
}

func (s *MySQLStore) ApproveHookRevision(ctx context.Context, owner, batchID, bookID, hookID string) (HookRevision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return HookRevision{}, err }
	defer tx.Rollback()
	value, err := loadHookRevision(ctx, tx, owner, batchID, bookID, hookID, true)
	if err != nil { return HookRevision{}, err }
	if value.Status == "approved" { return value, nil }
	now := time.Now().UTC()
	res, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_hook_revisions SET status='approved',approved_at=? WHERE id=? AND batch_id=? AND book_id=? AND owner_username=?`, now, hookID, batchID, bookID, owner)
	if err != nil { return HookRevision{}, err }
	if count, _ := res.RowsAffected(); count != 1 { return HookRevision{}, ErrNotFound }
	if err := tx.Commit(); err != nil { return HookRevision{}, err }
	value.Status, value.ApprovedAt = "approved", &now
	return value, nil
}

func (s *MySQLStore) LatestHookRevision(ctx context.Context, owner, batchID, bookID string) (HookRevision, error) {
	return loadHookRevision(ctx, s.db, owner, batchID, bookID, "", false)
}

type hookQueryer interface { QueryRowContext(context.Context, string, ...any) *sql.Row }

func loadHookRevision(ctx context.Context, q hookQueryer, owner, batchID, bookID, hookID string, forUpdate bool) (HookRevision, error) {
	query := `SELECT id,revision,status,hook_text,source_digest,created_at,approved_at FROM batch_factory_v11_hook_revisions WHERE batch_id=? AND book_id=? AND owner_username=?`
	args := []any{batchID, bookID, owner}
	if hookID != "" { query += ` AND id=?`; args = append(args, hookID) } else { query += ` ORDER BY revision DESC LIMIT 1` }
	if forUpdate { query += ` FOR UPDATE` }
	var value HookRevision
	var approved sql.NullTime
	err := q.QueryRowContext(ctx, query, args...).Scan(&value.ID, &value.Revision, &value.Status, &value.Text, &value.SourceDigest, &value.CreatedAt, &approved)
	if errors.Is(err, sql.ErrNoRows) { return HookRevision{}, ErrNotFound }
	if err != nil { return HookRevision{}, err }
	value.BatchID, value.BookID = batchID, bookID
	if approved.Valid { value.ApprovedAt = &approved.Time }
	return value, nil
}

func (s *MySQLStore) PersistDirectorRevision(ctx context.Context, owner string, book Book, snapshot DirectorSnapshot, digest, hookID string, output DirectorResult) (DirectorRevision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return DirectorRevision{}, err }
	defer tx.Rollback()
	var currentBookRevision int64
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_books WHERE id=? AND batch_id=? AND owner_username=? FOR UPDATE`, book.ID, book.BatchID, owner).Scan(&currentBookRevision); errors.Is(err, sql.ErrNoRows) {
		return DirectorRevision{}, ErrNotFound
	} else if err != nil { return DirectorRevision{}, err }
	if snapshot.Mode == "viral" {
		hook, err := loadHookRevision(ctx, tx, owner, book.BatchID, book.ID, hookID, true)
		if err != nil || hook.Status != "approved" { return DirectorRevision{}, fmt.Errorf("%w: approved Hook required", ErrConflict) }
	}
	snapshotID, err := newID("snapshot")
	if err != nil { return DirectorRevision{}, err }
	snapshotJSON, err := json.Marshal(snapshot.Effective)
	if err != nil { return DirectorRevision{}, err }
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_config_snapshots(id,owner_username,batch_id,book_id,video_id,effective_json,created_at) VALUES(?,?,?,?,NULL,?,?)`, snapshotID, owner, book.BatchID, book.ID, snapshotJSON, now); err != nil { return DirectorRevision{}, err }
	var currentRevision int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision),0) FROM batch_factory_v11_director_revisions WHERE batch_id=? AND book_id=? AND owner_username=?`, book.BatchID, book.ID, owner).Scan(&currentRevision); err != nil { return DirectorRevision{}, err }
	revisionID, err := newID("director")
	if err != nil { return DirectorRevision{}, err }
	outputJSON, err := json.Marshal(output)
	if err != nil { return DirectorRevision{}, err }
	var hookValue any
	if hookID != "" { hookValue = hookID }
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_director_revisions(id,batch_id,book_id,owner_username,revision,snapshot_id,mode,source_digest,hook_revision_id,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, revisionID, book.BatchID, book.ID, owner, currentRevision+1, snapshotID, snapshot.Mode, digest, hookValue, outputJSON, now); err != nil { return DirectorRevision{}, err }

	orphaned := []OrphanedOverride{}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM batch_factory_v11_videos WHERE batch_id=? AND book_id=? AND owner_username=? AND compatibility_state='active' ORDER BY ordinal,id`, book.BatchID, book.ID, owner)
	if err != nil { return DirectorRevision{}, err }
	oldIDs := []string{}
	for rows.Next() { var id string; if err := rows.Scan(&id); err != nil { rows.Close(); return DirectorRevision{}, err }; oldIDs = append(oldIDs, id) }
	if err := rows.Err(); err != nil { rows.Close(); return DirectorRevision{}, err }
	rows.Close()
	for _, videoID := range oldIDs {
		patch, err := loadPatch(ctx, tx, owner, ScopeRef{Kind: ScopeVideo, BatchID: book.BatchID, BookID: book.ID, VideoID: videoID})
		if err != nil { return DirectorRevision{}, err }
		if len(patch) > 0 {
			encoded, err := json.Marshal(patch); if err != nil { return DirectorRevision{}, err }
			auditID, err := newID("orphan"); if err != nil { return DirectorRevision{}, err }
			if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_orphaned_overrides(id,director_revision_id,video_id,patch_json,state,created_at) VALUES(?,?,?,?, 'orphaned',?)`, auditID, revisionID, videoID, encoded, now); err != nil { return DirectorRevision{}, err }
			orphaned = append(orphaned, OrphanedOverride{VideoID: videoID, Patch: patch, State: "orphaned"})
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_videos SET compatibility_state='orphaned',updated_at=? WHERE batch_id=? AND book_id=? AND owner_username=? AND compatibility_state='active'`, now, book.BatchID, book.ID, owner); err != nil { return DirectorRevision{}, err }

	videos := make([]Video, 0, len(output.Storyboard))
	for ordinal, draft := range output.Storyboard {
		videoID, err := newID("video"); if err != nil { return DirectorRevision{}, err }
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_videos(id,batch_id,book_id,owner_username,ordinal,compatibility_state,revision,created_at,updated_at) VALUES(?,?,?,?,?,'active',1,?,?)`, videoID, book.BatchID, book.ID, owner, ordinal, now, now); err != nil { return DirectorRevision{}, err }
		label := fmt.Sprintf("VIDEO %02d", ordinal+1)
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_video_records(video_id,label,visual_prompt,duration_seconds) VALUES(?,?,?,?)`, videoID, label, draft.VideoDesc, draft.DurationSec); err != nil { return DirectorRevision{}, err }
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_director_video_links(director_revision_id,video_id,ordinal) VALUES(?,?,?)`, revisionID, videoID, ordinal); err != nil { return DirectorRevision{}, err }
		videos = append(videos, Video{ID: videoID, BatchID: book.BatchID, BookID: book.ID, Label: label, VisualPrompt: draft.VideoDesc, DurationSeconds: float64(draft.DurationSec), CompatibilityState: "active", Revision: 1})
	}
	if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_books SET revision=?,updated_at=? WHERE id=? AND batch_id=? AND owner_username=?`, currentBookRevision+1, now, book.ID, book.BatchID, owner); err != nil { return DirectorRevision{}, err }
	if err := tx.Commit(); err != nil { return DirectorRevision{}, err }
	return DirectorRevision{ID: revisionID, BatchID: book.BatchID, BookID: book.ID, Revision: currentRevision+1, Mode: snapshot.Mode, SnapshotID: snapshotID, SourceDigest: digest, HookRevisionID: hookID, Output: output, Videos: videos, OrphanedOverrides: orphaned, CreatedAt: now}, nil
}


func (s *MySQLStore) UpdateShotVisualImage(ctx context.Context, owner, batchID, bookID, videoID, shotID, imageURL string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer tx.Rollback()
	var revisionID string
	var raw []byte
	err = tx.QueryRowContext(ctx, `SELECT id, output_json FROM batch_factory_v11_director_revisions WHERE owner_username=? AND batch_id=? AND book_id=? ORDER BY revision DESC LIMIT 1 FOR UPDATE`, owner, batchID, bookID).Scan(&revisionID, &raw)
	if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }
	if err != nil { return err }
	var videoIndex int
	if err := tx.QueryRowContext(ctx, `SELECT ordinal FROM batch_factory_v11_videos WHERE id=? AND owner_username=? AND batch_id=? AND book_id=?`, videoID, owner, batchID, bookID).Scan(&videoIndex); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil { return err }
	var output DirectorResult
	if err := json.Unmarshal(raw, &output); err != nil { return err }
	if videoIndex < 0 || videoIndex >= len(output.Storyboard) || !strings.HasPrefix(shotID, videoID+":shot:") {
		return ErrNotFound
	}
	found := false
	for shotIndex := range output.Storyboard[videoIndex].Shots {
		if fmt.Sprintf("%s:shot:%02d", videoID, shotIndex+1) == shotID {
			output.Storyboard[videoIndex].Shots[shotIndex].VisualImageURL = imageURL
			found = true
			break
		}
	}
	if !found { return ErrNotFound }
	if !found { return ErrNotFound }
	encoded, err := json.Marshal(output)
	if err != nil { return err }
	result, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_director_revisions SET output_json=? WHERE id=? AND owner_username=? AND batch_id=? AND book_id=?`, encoded, revisionID, owner, batchID, bookID)
	if err != nil { return err }
	if count, _ := result.RowsAffected(); count != 1 { return ErrNotFound }
	return tx.Commit()
}

func loadLatestDirectorRevision(ctx context.Context, q batchQueryer, owner, batchID, bookID string) (DirectorRevision, error) {
	var value DirectorRevision
	var hook sql.NullString
	var raw []byte
	err := q.QueryRowContext(ctx, `SELECT id,revision,snapshot_id,mode,source_digest,hook_revision_id,output_json,created_at FROM batch_factory_v11_director_revisions WHERE batch_id=? AND book_id=? AND owner_username=? ORDER BY revision DESC LIMIT 1`, batchID, bookID, owner).Scan(&value.ID, &value.Revision, &value.SnapshotID, &value.Mode, &value.SourceDigest, &hook, &raw, &value.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) { return DirectorRevision{}, ErrNotFound }
	if err != nil { return DirectorRevision{}, err }
	value.BatchID, value.BookID = batchID, bookID
	if hook.Valid { value.HookRevisionID = hook.String }
	if err := json.Unmarshal(raw, &value.Output); err != nil { return DirectorRevision{}, err }
	return value, nil
}

