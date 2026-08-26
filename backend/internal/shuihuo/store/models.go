package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"qiantie/backend/internal/shuihuo/models"
)

type Models struct{ db *sql.DB }

func NewModels(db *sql.DB) *Models { return &Models{db: db} }

const modelSelectColumns = `
d.id, COALESCE(d.model_key, ''), v.id, d.name, d.kind, d.adapter_kind, d.enabled,
COALESCE(d.hidden, FALSE), COALESCE(d.sort_order, 0), COALESCE(d.admin_note, ''),
d.allowed_roles_json, d.parameter_schema_json,
COALESCE(v.credential_ref, ''), COALESCE(v.endpoint, ''), COALESCE(v.base_domain, ''), COALESCE(v.base_path, ''),
COALESCE(v.request_template, ''), COALESCE(v.response_mapping, ''), COALESCE(v.polling_template, ''),
COALESCE(v.image_input_format, ''), COALESCE(v.image_request_mode, ''), COALESCE(CAST(v.runtime_policy_json AS CHAR), '')`

func (s *Models) ListEnabled(ctx context.Context) ([]models.Definition, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT `+modelSelectColumns+`
FROM model_definitions d
JOIN model_versions v ON v.model_definition_id = d.id
WHERE d.enabled = TRUE
  AND v.version_number = (SELECT MAX(version_number) FROM model_versions latest WHERE latest.model_definition_id = d.id)
ORDER BY COALESCE(d.sort_order, 0), d.kind, d.name
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModels(rows)
}

func (s *Models) ListAll(ctx context.Context) ([]models.Definition, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT `+modelSelectColumns+`
FROM model_definitions d
LEFT JOIN model_versions v ON v.model_definition_id = d.id
  AND v.version_number = (SELECT MAX(version_number) FROM model_versions latest WHERE latest.model_definition_id = d.id)
ORDER BY d.created_at DESC, d.id DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanModels(rows)
}

func (s *Models) GetEnabled(ctx context.Context, modelID int64) (models.Definition, error) {
	var model models.Definition
	var rolesJSON, schemaJSON []byte
	err := s.db.QueryRowContext(ctx, `
SELECT `+modelSelectColumns+`
FROM model_definitions d
JOIN model_versions v ON v.model_definition_id = d.id
WHERE d.id = ? AND d.enabled = TRUE
  AND v.version_number = (SELECT MAX(version_number) FROM model_versions latest WHERE latest.model_definition_id = d.id)
`, modelID).Scan(modelScanTargets(&model, &rolesJSON, &schemaJSON)...)
	if err != nil {
		return models.Definition{}, err
	}
	if err := decodeModelJSON(&model, rolesJSON, schemaJSON); err != nil {
		return models.Definition{}, err
	}
	return model, nil
}

func (s *Models) GetVersion(ctx context.Context, modelID, versionID int64) (models.Definition, error) {
	var model models.Definition
	var rolesJSON, schemaJSON []byte
	err := s.db.QueryRowContext(ctx, `
SELECT `+modelSelectColumns+`
FROM model_definitions d
JOIN model_versions v ON v.model_definition_id = d.id
WHERE d.id = ? AND v.id = ? AND d.enabled = TRUE
`, modelID, versionID).Scan(modelScanTargets(&model, &rolesJSON, &schemaJSON)...)
	if err != nil {
		return models.Definition{}, err
	}
	if err := decodeModelJSON(&model, rolesJSON, schemaJSON); err != nil {
		return models.Definition{}, err
	}
	return model, nil
}

func (s *Models) Create(ctx context.Context, ownerID int64, model models.Definition) (models.Definition, error) {
	if err := models.ValidateDefinition(model); err != nil {
		return models.Definition{}, err
	}
	rolesJSON, err := json.Marshal(model.AllowedRoles)
	if err != nil {
		return models.Definition{}, err
	}
	if model.ParameterSchema == "" {
		model.ParameterSchema = "{}"
	}
	var runtimePolicy any
	if model.RuntimePolicyJSON != "" {
		if err := json.Unmarshal([]byte(model.RuntimePolicyJSON), &runtimePolicy); err != nil {
			return models.Definition{}, fmt.Errorf("decode runtime policy: %w", err)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return models.Definition{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
INSERT INTO model_definitions(model_key, name, kind, adapter_kind, enabled, hidden, sort_order, admin_note, allowed_roles_json, parameter_schema_json)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
`, model.ModelID, model.Name, model.Kind, model.AdapterKind, model.Enabled, model.Hidden, model.SortOrder, model.AdminNote, rolesJSON, model.ParameterSchema)
	if err != nil {
		return models.Definition{}, err
	}
	model.ID, err = result.LastInsertId()
	if err != nil {
		return models.Definition{}, err
	}
	result, err = tx.ExecContext(ctx, `
INSERT INTO model_versions(
  model_definition_id, version_number, credential_ref, endpoint, base_domain, base_path,
  request_template, response_mapping, polling_template, image_input_format, image_request_mode,
  runtime_policy_json, created_by
) VALUES(?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, model.ID, model.CredentialRef, model.Endpoint, model.BaseDomain, model.BasePath, model.RequestTemplate, model.ResponseMapping, model.PollingTemplate, model.ImageInputFormat, model.ImageRequestMode, nullableJSON(runtimePolicy), ownerID)
	if err != nil {
		return models.Definition{}, err
	}
	model.VersionID, err = result.LastInsertId()
	if err != nil {
		return models.Definition{}, err
	}
	if err := tx.Commit(); err != nil {
		return models.Definition{}, err
	}
	return model, nil
}

func nullableJSON(value any) any {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return string(encoded)
}

func scanModels(rows *sql.Rows) ([]models.Definition, error) {
	items := make([]models.Definition, 0)
	for rows.Next() {
		var model models.Definition
		var rolesJSON, schemaJSON []byte
		if err := rows.Scan(modelScanTargets(&model, &rolesJSON, &schemaJSON)...); err != nil {
			return nil, err
		}
		if err := decodeModelJSON(&model, rolesJSON, schemaJSON); err != nil {
			return nil, err
		}
		items = append(items, model)
	}
	return items, rows.Err()
}

func modelScanTargets(model *models.Definition, rolesJSON, schemaJSON *[]byte) []any {
	return []any{
		&model.ID, &model.ModelID, &model.VersionID, &model.Name, &model.Kind, &model.AdapterKind, &model.Enabled,
		&model.Hidden, &model.SortOrder, &model.AdminNote, rolesJSON, schemaJSON,
		&model.CredentialRef, &model.Endpoint, &model.BaseDomain, &model.BasePath,
		&model.RequestTemplate, &model.ResponseMapping, &model.PollingTemplate,
		&model.ImageInputFormat, &model.ImageRequestMode, &model.RuntimePolicyJSON,
	}
}

func decodeModelJSON(model *models.Definition, rolesJSON, schemaJSON []byte) error {
	if len(rolesJSON) > 0 && string(rolesJSON) != "null" && json.Unmarshal(rolesJSON, &model.AllowedRoles) != nil {
		return fmt.Errorf("decode model roles")
	}
	if len(schemaJSON) > 0 && string(schemaJSON) != "null" {
		model.ParameterSchema = string(schemaJSON)
	}
	return nil
}
