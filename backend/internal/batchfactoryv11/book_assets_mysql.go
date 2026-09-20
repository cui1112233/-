package batchfactoryv11

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

func ensureBookOwnership(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, owner, batchID, bookID string) error {
	var one int
	err := q.QueryRowContext(ctx, `SELECT 1 FROM batch_factory_v11_books WHERE id=? AND batch_id=? AND owner_username=?`, bookID, batchID, owner).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (s *MySQLStore) ListBookAssets(ctx context.Context, owner, batchID, bookID string) ([]BookAsset, error) {
	if err := ensureBookOwnership(ctx, s.db, owner, batchID, bookID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,kind,name,prompt,source,COALESCE(extraction_preset_id,''),COALESCE(extraction_preset_version,0),revision,created_at,updated_at FROM batch_factory_v11_book_assets WHERE owner_username=? AND batch_id=? AND book_id=? ORDER BY kind,name,id`, owner, batchID, bookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := []BookAsset{}
	for rows.Next() {
		var asset BookAsset
		if err := rows.Scan(&asset.ID, &asset.Kind, &asset.Name, &asset.Prompt, &asset.Source, &asset.ExtractionPresetID, &asset.ExtractionPresetVersion, &asset.Revision, &asset.CreatedAt, &asset.UpdatedAt); err != nil {
			return nil, err
		}
		asset.BatchID, asset.BookID = batchID, bookID
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return assets, nil
}

func (s *MySQLStore) CreateBookAsset(ctx context.Context, owner, batchID, bookID string, input CreateBookAssetInput) (BookAsset, error) {
	input, err := normalizeBookAssetInput(input)
	if err != nil {
		return BookAsset{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BookAsset{}, err
	}
	defer tx.Rollback()
	if err := ensureBookOwnership(ctx, tx, owner, batchID, bookID); err != nil {
		return BookAsset{}, err
	}
	id, err := newID("asset")
	if err != nil {
		return BookAsset{}, err
	}
	now := time.Now().UTC()
	asset := BookAsset{ID: id, BatchID: batchID, BookID: bookID, Kind: input.Kind, Name: input.Name, Prompt: input.Prompt, Source: "manual", Revision: 1, CreatedAt: now, UpdatedAt: now}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_book_assets(id,owner_username,batch_id,book_id,kind,name,prompt,source,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'manual',1,?,?)`, asset.ID, owner, asset.BatchID, asset.BookID, asset.Kind, asset.Name, asset.Prompt, now, now); err != nil {
		return BookAsset{}, err
	}
	if err := tx.Commit(); err != nil {
		return BookAsset{}, err
	}
	return asset, nil
}

// PersistExtractedBookAssets upserts only generated assets. Manual prompts are
// preserved by persistDirectorBookAssets and no director/video record is read
// or changed here.
func (s *MySQLStore) PersistExtractedBookAssets(ctx context.Context, owner string, book Book, snapshot DirectorSnapshot, assets DirectorAssets) ([]BookAsset, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := ensureBookOwnership(ctx, tx, owner, book.BatchID, book.ID); err != nil {
		return nil, err
	}
	output := DirectorResult{Characters: assets.Characters, Scenes: assets.Scenes, Props: assets.Props}
	if err := persistDirectorBookAssets(ctx, tx, owner, book, snapshot, output, time.Now().UTC()); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,kind,name,prompt,source,COALESCE(extraction_preset_id,''),COALESCE(extraction_preset_version,0),revision,created_at,updated_at FROM batch_factory_v11_book_assets WHERE owner_username=? AND batch_id=? AND book_id=? ORDER BY kind,name,id`, owner, book.BatchID, book.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BookAsset{}
	for rows.Next() {
		var asset BookAsset
		if err := rows.Scan(&asset.ID, &asset.Kind, &asset.Name, &asset.Prompt, &asset.Source, &asset.ExtractionPresetID, &asset.ExtractionPresetVersion, &asset.Revision, &asset.CreatedAt, &asset.UpdatedAt); err != nil {
			return nil, err
		}
		asset.BatchID, asset.BookID = book.BatchID, book.ID
		result = append(result, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *MySQLStore) UpdateBookAsset(ctx context.Context, owner, batchID, bookID, assetID string, input UpdateBookAssetInput) (BookAsset, error) {
	input.Name, input.Prompt = strings.TrimSpace(input.Name), strings.TrimSpace(input.Prompt)
	if input.Name == "" || input.Prompt == "" || len(input.Name) > 255 {
		return BookAsset{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BookAsset{}, err
	}
	defer tx.Rollback()
	if err := ensureBookOwnership(ctx, tx, owner, batchID, bookID); err != nil {
		return BookAsset{}, err
	}
	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_book_assets SET name=?,prompt=?,source='manual',revision=revision+1,updated_at=? WHERE id=? AND owner_username=? AND batch_id=? AND book_id=? AND revision=?`, input.Name, input.Prompt, now, assetID, owner, batchID, bookID, input.ExpectedRevision)
	if err != nil {
		return BookAsset{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		var revision int64
		err := tx.QueryRowContext(ctx, `SELECT revision FROM batch_factory_v11_book_assets WHERE id=? AND owner_username=? AND batch_id=? AND book_id=?`, assetID, owner, batchID, bookID).Scan(&revision)
		if errors.Is(err, sql.ErrNoRows) {
			return BookAsset{}, ErrNotFound
		}
		if err != nil {
			return BookAsset{}, err
		}
		return BookAsset{}, ErrConflict
	}
	var asset BookAsset
	err = tx.QueryRowContext(ctx, `SELECT kind,name,prompt,source,COALESCE(extraction_preset_id,''),COALESCE(extraction_preset_version,0),revision,created_at,updated_at FROM batch_factory_v11_book_assets WHERE id=? AND owner_username=? AND batch_id=? AND book_id=?`, assetID, owner, batchID, bookID).Scan(&asset.Kind, &asset.Name, &asset.Prompt, &asset.Source, &asset.ExtractionPresetID, &asset.ExtractionPresetVersion, &asset.Revision, &asset.CreatedAt, &asset.UpdatedAt)
	if err != nil {
		return BookAsset{}, err
	}
	asset.ID, asset.BatchID, asset.BookID = assetID, batchID, bookID
	if err := tx.Commit(); err != nil {
		return BookAsset{}, err
	}
	return asset, nil
}

func persistDirectorBookAssets(ctx context.Context, tx *sql.Tx, owner string, book Book, snapshot DirectorSnapshot, output DirectorResult, now time.Time) error {
	for _, asset := range directorBookAssets(book, snapshot, output) {
		id, err := newID("asset")
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_book_assets(id,owner_username,batch_id,book_id,kind,name,prompt,source,extraction_preset_id,extraction_preset_version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'director',?,?,1,?,?)
ON DUPLICATE KEY UPDATE
  prompt=IF(source='manual',prompt,VALUES(prompt)),
  source=IF(source='manual',source,VALUES(source)),
  extraction_preset_id=IF(source='manual',extraction_preset_id,VALUES(extraction_preset_id)),
  extraction_preset_version=IF(source='manual',extraction_preset_version,VALUES(extraction_preset_version)),
  revision=IF(source='manual',revision,revision+1),
  updated_at=IF(source='manual',updated_at,VALUES(updated_at))`, id, owner, book.BatchID, book.ID, asset.Kind, asset.Name, asset.Prompt, nullableString(asset.ExtractionPresetID), nullableInt64(asset.ExtractionPresetVersion), now, now)
		if err != nil {
			return err
		}
	}
	return nil
}

func nullableInt64(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
