package store

import (
	"context"
	"database/sql"

	"qiantie/backend/internal/shuihuo/domain"
)

type AssetTypes struct{ db *sql.DB }
type AssetTemplates struct{ db *sql.DB }

func NewAssetTypes(db *sql.DB) *AssetTypes         { return &AssetTypes{db: db} }
func NewAssetTemplates(db *sql.DB) *AssetTemplates { return &AssetTemplates{db: db} }

func (s *AssetTypes) List(ctx context.Context, userID int64) ([]domain.AssetType, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, user_id, name, category, created_at, updated_at
FROM shuihuo_asset_types
WHERE user_id IS NULL OR user_id = ?
ORDER BY user_id IS NULL DESC, created_at ASC, id ASC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AssetType, 0)
	for rows.Next() {
		var item domain.AssetType
		if err := rows.Scan(&item.ID, &item.UserID, &item.Name, &item.Category, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetTypes) Create(ctx context.Context, userID int64, name, category string) (domain.AssetType, error) {
	result, err := s.db.ExecContext(ctx, `INSERT INTO shuihuo_asset_types(user_id, name, category) VALUES(?, ?, ?)`, userID, name, category)
	if err != nil {
		return domain.AssetType{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return domain.AssetType{}, err
	}
	return s.Get(ctx, userID, id)
}

func (s *AssetTypes) Get(ctx context.Context, userID, id int64) (domain.AssetType, error) {
	var item domain.AssetType
	err := s.db.QueryRowContext(ctx, `
SELECT id, user_id, name, category, created_at, updated_at
FROM shuihuo_asset_types
WHERE id = ? AND (user_id IS NULL OR user_id = ?)
`, id, userID).Scan(&item.ID, &item.UserID, &item.Name, &item.Category, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *AssetTypes) Update(ctx context.Context, userID, id int64, name, category string) (domain.AssetType, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE shuihuo_asset_types SET name = ?, category = ? WHERE id = ? AND user_id = ?`, name, category, id, userID)
	if err != nil {
		return domain.AssetType{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.AssetType{}, err
	}
	return s.Get(ctx, userID, id)
}

func (s *AssetTypes) Delete(ctx context.Context, userID, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_asset_types WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *AssetTemplates) List(ctx context.Context, userID int64, assetTypeID *int64) ([]domain.AssetTemplate, error) {
	query := `
SELECT t.id, t.user_id, t.asset_type_id, t.name, t.prompt, t.reference_object_key, t.source, t.created_at, t.updated_at
FROM shuihuo_asset_templates t
JOIN shuihuo_asset_types ty ON ty.id = t.asset_type_id
WHERE t.user_id = ? AND (ty.user_id IS NULL OR ty.user_id = ?)`
	args := []any{userID, userID}
	if assetTypeID != nil {
		query += ` AND t.asset_type_id = ?`
		args = append(args, *assetTypeID)
	}
	query += ` ORDER BY t.created_at ASC, t.id ASC`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AssetTemplate, 0)
	for rows.Next() {
		var item domain.AssetTemplate
		if err := rows.Scan(&item.ID, &item.UserID, &item.AssetTypeID, &item.Name, &item.Prompt, &item.ReferenceObjectKey, &item.Source, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetTemplates) Create(ctx context.Context, userID int64, input domain.AssetTemplate) (domain.AssetTemplate, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_asset_templates(user_id, asset_type_id, name, prompt, reference_object_key, source)
SELECT ?, id, ?, ?, ?, ? FROM shuihuo_asset_types WHERE id = ? AND (user_id IS NULL OR user_id = ?)
`, userID, input.Name, input.Prompt, input.ReferenceObjectKey, input.Source, input.AssetTypeID, userID)
	if err != nil {
		return domain.AssetTemplate{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.AssetTemplate{}, err
	}
	input.ID, err = result.LastInsertId()
	if err != nil {
		return domain.AssetTemplate{}, err
	}
	input.UserID = &userID
	return input, nil
}

func (s *AssetTemplates) Update(ctx context.Context, userID, id int64, input domain.AssetTemplate) (domain.AssetTemplate, error) {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_asset_templates t
JOIN shuihuo_asset_types ty ON ty.id = ? AND (ty.user_id IS NULL OR ty.user_id = ?)
SET t.asset_type_id = ty.id, t.name = ?, t.prompt = ?, t.reference_object_key = ?, t.source = ?
WHERE t.id = ? AND t.user_id = ?
`, input.AssetTypeID, userID, input.Name, input.Prompt, input.ReferenceObjectKey, input.Source, id, userID)
	if err != nil {
		return domain.AssetTemplate{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.AssetTemplate{}, err
	}
	input.ID = id
	input.UserID = &userID
	return input, nil
}

func (s *AssetTemplates) Delete(ctx context.Context, userID, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_asset_templates WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}
