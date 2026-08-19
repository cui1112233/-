package store

import (
	"context"
	"database/sql"
	"errors"

	"qiantie/backend/internal/shuihuo/domain"
)

// AssetImages owns image references generated for an asset. These records are
// intentionally not part of shuihuo_media.
type AssetImages struct{ db *sql.DB }

func NewAssetImages(db *sql.DB) *AssetImages { return &AssetImages{db: db} }

func (s *AssetImages) CreateGenerated(ctx context.Context, image domain.AssetImage) (domain.AssetImage, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AssetImage{}, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM shuihuo_assets WHERE id = ? AND project_id = ?)`, image.AssetID, image.ProjectID).Scan(&exists); err != nil {
		return domain.AssetImage{}, err
	}
	if !exists {
		return domain.AssetImage{}, sql.ErrNoRows
	}
	if image.IsPrimary {
		if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_asset_images SET is_primary = FALSE WHERE asset_id = ?`, image.AssetID); err != nil {
			return domain.AssetImage{}, err
		}
	}
	var asset domain.Asset
	if err := tx.QueryRowContext(ctx, `SELECT name, category, prompt FROM shuihuo_assets WHERE id = ? AND project_id = ?`, image.AssetID, image.ProjectID).Scan(&asset.Name, &asset.Category, &asset.Prompt); err != nil {
		return domain.AssetImage{}, err
	}
	image.AssetNameSnapshot, image.AssetCategorySnapshot, image.AssetPromptSnapshot = asset.Name, asset.Category, asset.Prompt
	result, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_asset_images(project_id, asset_id, task_id, object_key, is_primary, asset_name_snapshot, asset_category_snapshot, asset_prompt_snapshot) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, image.ProjectID, image.AssetID, image.TaskID, image.ObjectKey, image.IsPrimary, image.AssetNameSnapshot, image.AssetCategorySnapshot, image.AssetPromptSnapshot)
	if err != nil {
		return domain.AssetImage{}, err
	}
	image.ID, err = result.LastInsertId()
	if err != nil {
		return domain.AssetImage{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AssetImage{}, err
	}
	return image, nil
}

func (s *AssetImages) ListByAsset(ctx context.Context, ownerID, assetID int64) ([]domain.AssetImage, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT i.id, i.project_id, i.asset_id, i.task_id, i.is_primary, i.created_at, i.updated_at
FROM shuihuo_asset_images i
JOIN shuihuo_projects p ON p.id = i.project_id
WHERE i.asset_id = ? AND p.user_id = ?
ORDER BY i.is_primary DESC, i.created_at DESC, i.id DESC`, assetID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.AssetImage{}
	for rows.Next() {
		var item domain.AssetImage
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.AssetID, &item.TaskID, &item.IsPrimary, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetImages) Get(ctx context.Context, ownerID, imageID int64) (domain.AssetImage, error) {
	var image domain.AssetImage
	err := s.db.QueryRowContext(ctx, `
SELECT i.id, i.project_id, i.asset_id, i.task_id, i.object_key, i.is_primary, i.created_at, i.updated_at
FROM shuihuo_asset_images i
JOIN shuihuo_projects p ON p.id = i.project_id
WHERE i.id = ? AND p.user_id = ?`, imageID, ownerID).Scan(&image.ID, &image.ProjectID, &image.AssetID, &image.TaskID, &image.ObjectKey, &image.IsPrimary, &image.CreatedAt, &image.UpdatedAt)
	return image, err
}

func (s *AssetImages) SetPrimary(ctx context.Context, ownerID, imageID int64) (domain.AssetImage, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AssetImage{}, err
	}
	defer tx.Rollback()
	var assetID int64
	if err := tx.QueryRowContext(ctx, `SELECT i.asset_id FROM shuihuo_asset_images i JOIN shuihuo_projects p ON p.id = i.project_id WHERE i.id = ? AND p.user_id = ? FOR UPDATE`, imageID, ownerID).Scan(&assetID); err != nil {
		return domain.AssetImage{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_asset_images SET is_primary = FALSE WHERE asset_id = ?`, assetID); err != nil {
		return domain.AssetImage{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_asset_images SET is_primary = TRUE WHERE id = ?`, imageID); err != nil {
		return domain.AssetImage{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AssetImage{}, err
	}
	return s.Get(ctx, ownerID, imageID)
}

func (s *AssetImages) Delete(ctx context.Context, ownerID, imageID int64) (domain.AssetImage, error) {
	image, err := s.Get(ctx, ownerID, imageID)
	if err != nil {
		return domain.AssetImage{}, err
	}
	result, err := s.db.ExecContext(ctx, `DELETE i FROM shuihuo_asset_images i JOIN shuihuo_projects p ON p.id = i.project_id WHERE i.id = ? AND p.user_id = ?`, imageID, ownerID)
	if err != nil {
		return domain.AssetImage{}, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return domain.AssetImage{}, err
		}
		return domain.AssetImage{}, errors.New("asset image delete conflict")
	}
	return image, nil
}
