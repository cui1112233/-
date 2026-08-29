package storage

import (
	"context"
	"database/sql"
)

func init() {
	migrations = append(migrations, migration{version: 28, apply: applyYadiVideoIntegration})
}

func applyYadiVideoIntegration(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS shuihuo_user_model_credentials (
  user_id BIGINT NOT NULL,
  credential_ref VARCHAR(255) NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, credential_ref),
  CONSTRAINT fk_shuihuo_user_model_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}

	parameterSchema := `{"upstreamModel":"yd2.0-fast","maxVideoDuration":15,"defaultResolution":"720p","durations":[10,15],"aspectRatios":["9:16","16:9"],"credentialScope":"user","credentialLabel":"Yadi API Key"}`
	result, err := conn.ExecContext(ctx, `
INSERT INTO model_definitions(
  model_key, name, kind, adapter_kind, enabled, hidden, sort_order, admin_note, allowed_roles_json, parameter_schema_json
)
VALUES(?, ?, 'video', 'yadi_video', TRUE, FALSE, 20, ?, JSON_ARRAY(), CAST(? AS JSON))
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
		"yadi-yd2-0-fast",
		"YD2.0 Fast（Yadi 文生视频）",
		"Yadi OpenAPI。用户只在个人中心保存自己的 API Key；剧本生成和批量工厂共同使用该用户级凭据。",
		parameterSchema,
	)
	if err != nil {
		return err
	}
	definitionID, err := result.LastInsertId()
	if err != nil {
		return err
	}
	if definitionID == 0 {
		if err := conn.QueryRowContext(ctx, `SELECT id FROM model_definitions WHERE model_key = ?`, "yadi-yd2-0-fast").Scan(&definitionID); err != nil {
			return err
		}
	}

	var versions int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM model_versions WHERE model_definition_id = ?`, definitionID).Scan(&versions); err != nil {
		return err
	}
	if versions > 0 {
		return nil
	}
	_, err = conn.ExecContext(ctx, `
INSERT INTO model_versions(
  model_definition_id, version_number, credential_ref, endpoint, base_domain, base_path,
  request_template, response_mapping, polling_template, image_input_format, image_request_mode, runtime_policy_json, created_by
)
VALUES(?, 1, 'user:yadi', 'https://ydapi.yadiai.cn/openapi/v1/video/create', 'ydapi.yadiai.cn', '/openapi/v1/video',
  NULL, NULL, NULL, 'url', 'json', CAST(? AS JSON), NULL)`,
		definitionID,
		`{"provider":"yadi","credentialScope":"user","resultEndpoint":"/openapi/v1/video/tasks/{taskId}/result"}`,
	)
	return err
}
