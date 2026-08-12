package store

import (
	"context"
	"database/sql"

	"qiantie/backend/internal/shuihuo/domain"
)

type Assets struct{ db *sql.DB }

func NewAssets(db *sql.DB) *Assets { return &Assets{db: db} }

func (s *Assets) Create(ctx context.Context, ownerID, projectID int64, asset domain.Asset) (domain.Asset, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_assets(project_id, asset_type_id, name, prompt, reference_object_key, source, manually_edited)
SELECT id, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, asset.AssetTypeID, asset.Name, asset.Prompt, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, projectID, ownerID)
	if err != nil {
		return domain.Asset{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Asset{}, err
	}
	asset.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Asset{}, err
	}
	asset.ProjectID = projectID
	return asset, nil
}

func (s *Assets) Get(ctx context.Context, ownerID, assetID int64) (domain.Asset, error) {
	var asset domain.Asset
	err := s.db.QueryRowContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.name, a.prompt, a.reference_object_key, a.source, a.manually_edited
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.id = ? AND p.user_id = ?
`, assetID, ownerID).Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Name, &asset.Prompt, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited)
	return asset, err
}

func (s *Assets) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Asset, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.name, a.prompt, a.reference_object_key, a.source, a.manually_edited
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.project_id = ? AND p.user_id = ?
ORDER BY a.created_at ASC, a.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Name, &asset.Prompt, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func (s *Assets) Update(ctx context.Context, ownerID int64, asset domain.Asset) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
SET a.asset_type_id = ?, a.name = ?, a.prompt = ?, a.reference_object_key = ?, a.source = ?, a.manually_edited = ?
WHERE a.id = ? AND p.user_id = ?
`, asset.AssetTypeID, asset.Name, asset.Prompt, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, asset.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}
