package batchfactoryv11

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type MySQLStore struct{ db *sql.DB }

var _ Store = (*MySQLStore)(nil)

func NewMySQLStore(db *sql.DB) *MySQLStore { return &MySQLStore{db: db} }

func newID(prefix string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(buf), nil
}

func (s *MySQLStore) CreateIntake(ctx context.Context, owner string, input NovelFetchIntakeInput) (Intake, error) {
	input = normalizeNovelFetchIntake(input)
	id, err := newID("intake")
	if err != nil {
		return Intake{}, err
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return Intake{}, ErrInvalid
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `INSERT INTO batch_factory_v11_intakes(id,owner_username,payload_json,created_at) VALUES(?,?,?,?)`, id, owner, payload, now); err != nil {
		return Intake{}, err
	}
	return Intake{ID: id, Owner: owner, Payload: payload, CreatedAt: now}, nil
}

func (s *MySQLStore) GetIntake(ctx context.Context, owner, id string) (Intake, error) {
	var v Intake
	var payload []byte
	var consumed sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT id,payload_json,consumed_at,created_at FROM batch_factory_v11_intakes WHERE id=? AND owner_username=?`, id, owner).Scan(&v.ID, &payload, &consumed, &v.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Intake{}, ErrNotFound
	}
	if err != nil {
		return Intake{}, err
	}
	v.Owner, v.Payload = owner, json.RawMessage(payload)
	if consumed.Valid {
		t := consumed.Time
		v.ConsumedAt = &t
	}
	return v, nil
}

func (s *MySQLStore) CreateBatchFromIntake(ctx context.Context, owner, intakeID string, input CreateBatchInput) (Batch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Batch{}, err
	}
	defer tx.Rollback()
	var payload []byte
	var consumed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT payload_json,consumed_at FROM batch_factory_v11_intakes WHERE id=? AND owner_username=? FOR UPDATE`, intakeID, owner).Scan(&payload, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return Batch{}, ErrNotFound
	}
	if err != nil {
		return Batch{}, err
	}
	if consumed.Valid {
		return Batch{}, ErrConflict
	}
	var intake NovelFetchIntakeInput
	if err := json.Unmarshal(payload, &intake); err != nil {
		return Batch{}, err
	}
	if len(input.Books) == 0 {
		input.Books = intake.Books
	}
	if strings.TrimSpace(input.Title) == "" {
		input.Title = "Novel Fetch Batch"
	}
	batch, err := createBatchTx(ctx, tx, owner, input, intakeID)
	if err != nil {
		return Batch{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_intakes SET consumed_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_username=?`, intakeID, owner); err != nil {
		return Batch{}, err
	}
	if err := tx.Commit(); err != nil {
		return Batch{}, err
	}
	return batch, nil
}

func (s *MySQLStore) CreateBatch(ctx context.Context, owner string, input CreateBatchInput) (Batch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Batch{}, err
	}
	defer tx.Rollback()
	batch, err := createBatchTx(ctx, tx, owner, input, "")
	if err != nil {
		return Batch{}, err
	}
	if err := tx.Commit(); err != nil {
		return Batch{}, err
	}
	return batch, nil
}

func createBatchTx(ctx context.Context, tx *sql.Tx, owner string, input CreateBatchInput, sourceIntakeID string) (Batch, error) {
	batchID, err := newID("batch")
	if err != nil {
		return Batch{}, err
	}
	now := time.Now().UTC()
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = "Untitled Batch"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_batches(id,owner_username,revision,created_at,updated_at) VALUES(?,?,1,?,?)`, batchID, owner, now, now); err != nil {
		return Batch{}, err
	}
	var source any
	if sourceIntakeID != "" {
		source = sourceIntakeID
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_batch_records(batch_id,title,source_intake_id) VALUES(?,?,?)`, batchID, title, source); err != nil {
		return Batch{}, err
	}
	batch := Batch{ID: batchID, Title: title, SourceIntakeID: sourceIntakeID, Revision: 1, Books: []Book{}, CreatedAt: now, UpdatedAt: now}
	for bookOrdinal, bi := range input.Books {
		bookID, err := newID("book")
		if err != nil {
			return Batch{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_books(id,batch_id,owner_username,ordinal,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`, bookID, batchID, owner, bookOrdinal, now, now); err != nil {
			return Batch{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_book_records(book_id,title,source_text) VALUES(?,?,?)`, bookID, bi.Title, nullableString(bi.SourceText)); err != nil {
			return Batch{}, err
		}
		book := Book{ID: bookID, BookID: bookID, BatchID: batchID, Title: bi.Title, SourceText: bi.SourceText, Revision: 1, Videos: []Video{}}
		for videoOrdinal, vi := range bi.Videos {
			videoID, err := newID("video")
			if err != nil {
				return Batch{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_videos(id,batch_id,book_id,owner_username,ordinal,compatibility_state,revision,created_at,updated_at) VALUES(?,?,?,?,?,'active',1,?,?)`, videoID, batchID, bookID, owner, videoOrdinal, now, now); err != nil {
				return Batch{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_video_records(video_id,label,visual_prompt,duration_seconds) VALUES(?,?,?,?)`, videoID, vi.Label, nullableString(vi.VisualPrompt), nullableFloat(vi.DurationSeconds)); err != nil {
				return Batch{}, err
			}
			book.Videos = append(book.Videos, Video{ID: videoID, BatchID: batchID, BookID: bookID, Label: vi.Label, VisualPrompt: vi.VisualPrompt, DurationSeconds: vi.DurationSeconds, CompatibilityState: "active", Revision: 1})
		}
		batch.Books = append(batch.Books, book)
	}
	return batch, nil
}

func nullableString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
func nullableFloat(v float64) any {
	if v == 0 {
		return nil
	}
	return v
}

func (s *MySQLStore) ListBatches(ctx context.Context, owner string) ([]Batch, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM batch_factory_v11_batches WHERE owner_username=? ORDER BY created_at DESC,id DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Batch, 0, len(ids))
	for _, id := range ids {
		b, err := s.GetBatch(ctx, owner, id)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

func (s *MySQLStore) GetBatch(ctx context.Context, owner, id string) (Batch, error) {
	return loadBatch(ctx, s.db, owner, id)
}

type batchQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func loadBatch(ctx context.Context, q batchQueryer, owner, id string) (Batch, error) {
	var b Batch
	err := q.QueryRowContext(ctx, `SELECT b.id,r.title,COALESCE(r.source_intake_id,''),b.revision,b.created_at,b.updated_at FROM batch_factory_v11_batches b JOIN batch_factory_v11_batch_records r ON r.batch_id=b.id WHERE b.id=? AND b.owner_username=?`, id, owner).Scan(&b.ID, &b.Title, &b.SourceIntakeID, &b.Revision, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Batch{}, ErrNotFound
	}
	if err != nil {
		return Batch{}, err
	}
	b.Books = []Book{}
	rows, err := q.QueryContext(ctx, `SELECT b.id,r.title,COALESCE(r.source_text,''),b.revision FROM batch_factory_v11_books b JOIN batch_factory_v11_book_records r ON r.book_id=b.id WHERE b.batch_id=? AND b.owner_username=? ORDER BY b.ordinal,b.id`, b.ID, owner)
	if err != nil {
		return Batch{}, err
	}
	for rows.Next() {
		var book Book
		if err := rows.Scan(&book.ID, &book.Title, &book.SourceText, &book.Revision); err != nil {
			rows.Close()
			return Batch{}, err
		}
		book.BookID = book.ID
		book.BatchID = b.ID
		book.Videos = []Video{}
		b.Books = append(b.Books, book)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Batch{}, err
	}
	rows.Close()
	for i := range b.Books {
		vrows, err := q.QueryContext(ctx, `SELECT v.id,r.label,COALESCE(r.visual_prompt,''),COALESCE(r.duration_seconds,0),v.compatibility_state,v.revision FROM batch_factory_v11_videos v JOIN batch_factory_v11_video_records r ON r.video_id=v.id WHERE v.batch_id=? AND v.book_id=? AND v.owner_username=? AND v.compatibility_state='active' ORDER BY v.ordinal,v.id`, b.ID, b.Books[i].ID, owner)
		if err != nil {
			return Batch{}, err
		}
		for vrows.Next() {
			var v Video
			if err := vrows.Scan(&v.ID, &v.Label, &v.VisualPrompt, &v.DurationSeconds, &v.CompatibilityState, &v.Revision); err != nil {
				vrows.Close()
				return Batch{}, err
			}
			v.BatchID = b.ID
			v.BookID = b.Books[i].ID
			b.Books[i].Videos = append(b.Books[i].Videos, v)
		}
		if err := vrows.Err(); err != nil {
			vrows.Close()
			return Batch{}, err
		}
		vrows.Close()
	}
	return b, nil
}

func (s *MySQLStore) SaveSettings(ctx context.Context, owner string, ref ScopeRef, update SettingsUpdate) (SettingsResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SettingsResult{}, err
	}
	defer tx.Rollback()
	current, err := lockScopeRevision(ctx, tx, owner, ref)
	if err != nil {
		return SettingsResult{}, err
	}
	if current != update.ExpectedRevision {
		return SettingsResult{}, ErrConflict
	}
	versionID, selectsVersion, err := configVersionIDFromUpdate(ref, update)
	if err != nil {
		return SettingsResult{}, err
	}
	if selectsVersion {
		var one int
		err = tx.QueryRowContext(ctx, `SELECT 1 FROM batch_factory_v11_config_versions WHERE id=? AND (owner_username IS NULL OR owner_username=?)`, versionID, owner).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			return SettingsResult{}, ErrNotFound
		}
		if err != nil {
			return SettingsResult{}, err
		}
	}
	patch, err := loadPatch(ctx, tx, owner, ref)
	if err != nil {
		return SettingsResult{}, err
	}
	patch = ApplySparseUpdate(patch, update)
	next := current + 1
	if err := updateScopeRevision(ctx, tx, owner, ref, next); err != nil {
		return SettingsResult{}, err
	}
	encoded, err := json.Marshal(patch)
	if err != nil {
		return SettingsResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_settings_patches(scope_type,scope_id,owner_username,batch_id,book_id,video_id,patch_json,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE patch_json=VALUES(patch_json),revision=VALUES(revision),updated_at=VALUES(updated_at)`, string(ref.Kind), scopeID(ref), owner, ref.BatchID, nullIfEmpty(ref.BookID), nullIfEmpty(ref.VideoID), encoded, next)
	if err != nil {
		return SettingsResult{}, err
	}
	effective, err := effectiveSettings(ctx, tx, owner, ref)
	if err != nil {
		return SettingsResult{}, err
	}
	snapshotID, err := newID("snapshot")
	if err != nil {
		return SettingsResult{}, err
	}
	effJSON, err := json.Marshal(effective)
	if err != nil {
		return SettingsResult{}, err
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_config_snapshots(id,owner_username,batch_id,book_id,video_id,effective_json,created_at) VALUES(?,?,?,?,?,?,?)`, snapshotID, owner, ref.BatchID, nullIfEmpty(ref.BookID), nullIfEmpty(ref.VideoID), effJSON, now); err != nil {
		return SettingsResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettingsResult{}, err
	}
	snap := ConfigSnapshot{ID: snapshotID, BatchID: ref.BatchID, BookID: ref.BookID, VideoID: ref.VideoID, Effective: effective, CreatedAt: now}
	return SettingsResult{Scope: ref, Patch: patch, Revision: next, Snapshot: &snap}, nil
}

func scopeID(ref ScopeRef) string {
	switch ref.Kind {
	case ScopeBatch:
		return ref.BatchID
	case ScopeBook:
		return ref.BookID
	case ScopeVideo:
		return ref.VideoID
	}
	return ""
}
func nullIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func lockScopeRevision(ctx context.Context, tx *sql.Tx, owner string, ref ScopeRef) (int64, error) {
	var rev int64
	var err error
	switch ref.Kind {
	case ScopeBatch:
		err = tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_batches WHERE id=? AND owner_username=? FOR UPDATE`, ref.BatchID, owner).Scan(&rev)
	case ScopeBook:
		err = tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_books WHERE id=? AND batch_id=? AND owner_username=? FOR UPDATE`, ref.BookID, ref.BatchID, owner).Scan(&rev)
	case ScopeVideo:
		err = tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_videos WHERE id=? AND book_id=? AND batch_id=? AND owner_username=? FOR UPDATE`, ref.VideoID, ref.BookID, ref.BatchID, owner).Scan(&rev)
	default:
		return 0, ErrInvalid
	}
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return rev, err
}
func updateScopeRevision(ctx context.Context, tx *sql.Tx, owner string, ref ScopeRef, next int64) error {
	var res sql.Result
	var err error
	switch ref.Kind {
	case ScopeBatch:
		res, err = tx.ExecContext(ctx, `UPDATE batch_factory_v11_batches SET revision=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_username=?`, next, ref.BatchID, owner)
	case ScopeBook:
		res, err = tx.ExecContext(ctx, `UPDATE batch_factory_v11_books SET revision=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND batch_id=? AND owner_username=?`, next, ref.BookID, ref.BatchID, owner)
	case ScopeVideo:
		res, err = tx.ExecContext(ctx, `UPDATE batch_factory_v11_videos SET revision=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND book_id=? AND batch_id=? AND owner_username=?`, next, ref.VideoID, ref.BookID, ref.BatchID, owner)
	default:
		return ErrInvalid
	}
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrNotFound
	}
	return nil
}
func loadPatch(ctx context.Context, q batchQueryer, owner string, ref ScopeRef) (SettingsPatch, error) {
	var raw []byte
	err := q.QueryRowContext(ctx, `SELECT patch_json FROM batch_factory_v11_settings_patches WHERE scope_type=? AND scope_id=? AND owner_username=?`, string(ref.Kind), scopeID(ref), owner).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return SettingsPatch{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := SettingsPatch{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}
func effectiveSettings(ctx context.Context, q batchQueryer, owner string, ref ScopeRef) (SettingsPatch, error) {
	layers := []SettingsPatch{}
	for _, r := range []ScopeRef{{Kind: ScopeBatch, BatchID: ref.BatchID}, {Kind: ScopeBook, BatchID: ref.BatchID, BookID: ref.BookID}, {Kind: ScopeVideo, BatchID: ref.BatchID, BookID: ref.BookID, VideoID: ref.VideoID}} {
		if r.Kind == ScopeBook && ref.BookID == "" {
			continue
		}
		if r.Kind == ScopeVideo && ref.VideoID == "" {
			continue
		}
		p, err := loadPatch(ctx, q, owner, r)
		if err != nil {
			return nil, err
		}
		layers = append(layers, p)
	}
	return ResolveSettings(layers...), nil
}

func (s *MySQLStore) ConfigVersions(ctx context.Context, owner string) ([]ConfigVersion, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,config_json,created_at FROM batch_factory_v11_config_versions WHERE owner_username IS NULL OR owner_username=? ORDER BY created_at,id`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ConfigVersion{}
	for rows.Next() {
		var v ConfigVersion
		var raw []byte
		if err := rows.Scan(&v.ID, &v.Name, &raw, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Config = json.RawMessage(raw)
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *MySQLStore) ChangeImpact(ctx context.Context, owner, batchID string, update SettingsUpdate) (ChangeImpact, error) {
	b, err := s.GetBatch(ctx, owner, batchID)
	if err != nil {
		return ChangeImpact{}, err
	}
	videos := 0
	for _, book := range b.Books {
		videos += len(book.Videos)
	}
	return ChangeImpact{AffectedBooks: len(b.Books), AffectedVideos: videos, InvalidatesDirector: false, PreservesOverrides: true, ChangedKeys: ChangedKeys(update)}, nil
}
func (s *MySQLStore) ListPrompts(ctx context.Context, owner, kind string) ([]Prompt, error) {
	query := `SELECT d.id,v.id,d.name,d.kind,v.content,v.revision,v.created_at FROM batch_factory_v11_prompt_definitions d JOIN batch_factory_v11_prompt_versions v ON v.prompt_id=d.id AND v.revision=(SELECT MAX(v2.revision) FROM batch_factory_v11_prompt_versions v2 WHERE v2.prompt_id=d.id AND v2.owner_username=d.owner_username) WHERE d.owner_username=?`
	args := []any{owner}
	if kind != "" {
		query += ` AND d.kind=?`
		args = append(args, kind)
	}
	query += ` ORDER BY d.created_at,d.id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Prompt{}
	for rows.Next() {
		var p Prompt
		if err := rows.Scan(&p.ID, &p.VersionID, &p.Name, &p.Kind, &p.Content, &p.Revision, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *MySQLStore) CreatePrompt(ctx context.Context, owner string, p Prompt) (Prompt, error) {
	if strings.TrimSpace(p.Name) == "" || strings.TrimSpace(p.Content) == "" {
		return Prompt{}, ErrInvalid
	}
	id, err := newID("prompt")
	if err != nil {
		return Prompt{}, err
	}
	vid, err := newID("promptv")
	if err != nil {
		return Prompt{}, err
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Prompt{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_prompt_definitions(id,owner_username,name,kind,created_at) VALUES(?,?,?,?,?)`, id, owner, p.Name, p.Kind, now); err != nil {
		return Prompt{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_prompt_versions(id,prompt_id,owner_username,revision,content,created_at) VALUES(?,?,?,1,?,?)`, vid, id, owner, p.Content, now); err != nil {
		return Prompt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Prompt{}, err
	}
	p.ID = id
	p.VersionID = vid
	p.Revision = 1
	p.CreatedAt = now
	return p, nil
}
func (s *MySQLStore) GetDraft(ctx context.Context, owner, key, kind, scope string) (Draft, error) {
	var d Draft
	err := s.db.QueryRowContext(ctx, `SELECT draft_key,kind,scope,COALESCE(content,''),revision,updated_at FROM batch_factory_v11_drafts WHERE owner_username=? AND draft_key=? AND kind=? AND scope=?`, owner, key, kind, scope).Scan(&d.Key, &d.Kind, &d.Scope, &d.Content, &d.Revision, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Draft{}, ErrNotFound
	}
	return d, err
}
func (s *MySQLStore) SaveDraft(ctx context.Context, owner string, d Draft) (Draft, error) {
	if strings.TrimSpace(d.Key) == "" {
		return Draft{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Draft{}, err
	}
	defer tx.Rollback()
	var current int64
	err = tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_drafts WHERE owner_username=? AND draft_key=? AND kind=? AND scope=? FOR UPDATE`, owner, d.Key, d.Kind, d.Scope).Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Draft{}, err
	}
	next := current + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_drafts(owner_username,draft_key,kind,scope,content,revision,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE content=VALUES(content),revision=VALUES(revision),updated_at=VALUES(updated_at)`, owner, d.Key, d.Kind, d.Scope, nullableString(d.Content), next); err != nil {
		return Draft{}, err
	}
	if err := tx.Commit(); err != nil {
		return Draft{}, err
	}
	d.Revision = next
	d.UpdatedAt = time.Now().UTC()
	return d, nil
}

func (s *MySQLStore) String() string { return fmt.Sprintf("BatchFactoryV11MySQLStore(%p)", s.db) }
