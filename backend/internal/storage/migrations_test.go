package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestOwnerMigrationsPreserveLegacyAccountDefaults(t *testing.T) {
	ownerMigration := migrationForVersion(t, 5)
	if ownerMigration.apply == nil {
		t.Fatal("owner migration needs a recoverable custom apply function")
	}
	marker := migrationSQL(t, 6)
	if !strings.Contains(marker, "CREATE TABLE IF NOT EXISTS app_initializations") {
		t.Fatalf("seed initialization marker migration missing: %s", marker)
	}
}

func TestMigrationsUseExclusiveDatabaseLock(t *testing.T) {
	if migrationLockName == "" {
		t.Fatal("migration lock name is required")
	}
}

func TestVideoAPIConfigMigrationCreatesIdempotentUserScopedTable(t *testing.T) {
	migration := migrationForVersion(t, 33)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS video_api_configs",
		"user_id BIGINT PRIMARY KEY",
		"provider VARCHAR(64) NOT NULL",
		"api_key_ciphertext TEXT NOT NULL",
		"updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
		"REFERENCES users(id) ON DELETE CASCADE",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("video config migration missing %q", required)
		}
	}
}

func TestYDVideoModelMigrationSeedsAccountScopedModel(t *testing.T) {
	migration := migrationForVersion(t, 34)
	if migration.apply == nil {
		t.Fatal("YD model migration must execute its seed statements individually")
	}
	for _, required := range []string{
		"INSERT INTO model_definitions",
		"yd2-mini-video",
		"YD2.0 Mini",
		"'video'",
		"'yd_video'",
		"TRUE",
		"credential_ref, endpoint, request_template, response_mapping, created_by",
		"SELECT d.id, 1, '', '', NULL, NULL, NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("YD model migration missing %q", required)
		}
	}
}

func TestShuihuoVideoGenerationModeMigrationPersistsImageToVideoDefault(t *testing.T) {
	migration := migrationForVersion(t, 35)
	if migration.apply == nil {
		t.Fatal("video generation mode migration must repair existing config tables")
	}
}

func TestTaskProviderIDMigrationReleasesUnassignedTaskIDs(t *testing.T) {
	migration := migrationForVersion(t, 31)
	if !strings.Contains(migration.sql, "UPDATE shuihuo_tasks") || !strings.Contains(migration.sql, "provider_task_id = NULL") || !strings.Contains(migration.sql, "provider_task_id = ''") {
		t.Fatalf("migration must release empty provider task IDs: %q", migration.sql)
	}
}

func TestNovelFetchWorkshopMigrationExecutesDDLStatementsIndividually(t *testing.T) {
	migration := migrationForVersion(t, 32)
	if migration.apply == nil {
		t.Fatal("novel-fetch workshop migration must apply its two CREATE TABLE statements individually")
	}
	if strings.Count(migration.sql, ";") < 2 {
		t.Fatalf("novel-fetch workshop migration should contain both table definitions: %q", migration.sql)
	}
}

func TestSourceUnitMigrationCreatesReversibleMappingAndLegacyBackfill(t *testing.T) {
	migration := migrationForVersion(t, 15)
	if migration.apply == nil {
		t.Fatal("source-unit migration must include an idempotent legacy backfill")
	}
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_source_units",
		"CREATE TABLE IF NOT EXISTS shuihuo_segment_source_units",
		"UNIQUE KEY uniq_shuihuo_source_units_project_order",
		"fk_shuihuo_segment_source_units_segment",
		"fk_shuihuo_segment_source_units_source",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
}

func TestSourceUnitVersionMigrationPreservesPriorSourceIdentity(t *testing.T) {
	migration := migrationForVersion(t, 17)
	if migration.apply == nil {
		t.Fatal("source-unit version migration must have an idempotent apply function")
	}
	for _, required := range []string{
		"segmentation_version",
		"shuihuo_segment_source_unit_history",
		"segment_order_index",
		"fk_shuihuo_source_unit_history_source",
	} {
		if !strings.Contains(shuihuoSourceUnitHistoryMigrationSQL, required) {
			t.Fatalf("source-unit version migration missing %q", required)
		}
	}
}

func TestObjectCleanupMigrationPersistsRecoverableDeletionState(t *testing.T) {
	migration := migrationForVersion(t, 18)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_object_cleanup_queue",
		"object_key VARCHAR(768) NOT NULL",
		"reason VARCHAR(128) NOT NULL",
		"last_error VARCHAR(2048) NOT NULL DEFAULT ''",
		"attempt_count INT NOT NULL DEFAULT 0",
		"last_attempt_at DATETIME NULL",
		"uniq_shuihuo_object_cleanup_key",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("object cleanup migration missing %q", required)
		}
	}
}

func TestImportCompensationMigrationAddsLeasesAndHiddenImportRecovery(t *testing.T) {
	migration := migrationForVersion(t, 19)
	if migration.apply == nil {
		t.Fatal("import compensation migration must use a resumable custom apply function")
	}
	if strings.Count(migration.sql, ";") > 1 {
		t.Fatalf("migration 19 must not rely on a multi-statement driver execution: %q", migration.sql)
	}
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_import_compensation_queue",
		"project_id BIGINT PRIMARY KEY",
		"ON DELETE CASCADE",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("import compensation migration missing %q", required)
		}
	}
}

func TestAccountAPITextModelMigrationSeedsSelectableTextModel(t *testing.T) {
	migration := migrationForVersion(t, 21)
	if migration.apply == nil {
		t.Fatal("account API text model migration must apply statements individually")
	}
	for _, required := range []string{
		"当前账号 API 文本模型",
		"account_api_config",
		"text_completion",
		"INSERT INTO model_definitions",
		"INSERT INTO model_versions",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
}

func TestShuihuoUserConfigMigrationPersistsAudioDefaults(t *testing.T) {
	baseMigration := migrationForVersion(t, 7)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_user_configs",
		"audio_model_id BIGINT NULL",
		"jianying_draft_directory",
	} {
		if !strings.Contains(baseMigration.sql, required) {
			t.Fatalf("base shuihuo migration missing %q", required)
		}
	}
	migration := migrationForVersion(t, 23)
	if migration.apply == nil {
		t.Fatal("user config migration must repair existing tables idempotently")
	}
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_user_configs",
		"audio_model_id BIGINT NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("user config migration missing %q", required)
		}
	}
}

func TestShuihuoAssetPromptSelectionMigrationAddsNullablePresetIDs(t *testing.T) {
	migration := migrationForVersion(t, 24)
	if migration.apply == nil {
		t.Fatal("asset prompt selection migration must repair existing tables idempotently")
	}
	for _, required := range []string{
		"ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN character_preset_id VARCHAR(64) NULL",
		"ALTER TABLE shuihuo_asset_generation_configs ADD COLUMN scene_preset_id VARCHAR(64) NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
}

func TestShuihuoAssetPromptSelectionMigrationIsRepeatable(t *testing.T) {
	executor := &assetPromptSelectionMigrationTestExecutor{columns: map[string]bool{}}
	columnExists := func(_ context.Context, column string) (bool, error) { return executor.columns[column], nil }

	if err := applyShuihuoAssetPromptSelectionMigrationWithExecutor(context.Background(), executor, columnExists); err != nil {
		t.Fatalf("first asset prompt selection migration apply: %v", err)
	}
	if err := applyShuihuoAssetPromptSelectionMigrationWithExecutor(context.Background(), executor, columnExists); err != nil {
		t.Fatalf("repeat asset prompt selection migration apply: %v", err)
	}
	for _, column := range []string{"character_preset_id", "scene_preset_id"} {
		if !executor.columns[column] || executor.columnAdds[column] != 1 {
			t.Fatalf("column %q migration state = columns:%v adds:%v", column, executor.columns, executor.columnAdds)
		}
	}
}

func TestShuihuoAssetPresetImageMigrationKeepsStylesAndImagesSeparateFromMedia(t *testing.T) {
	migration := migrationForVersion(t, 25)
	if migration.apply == nil {
		t.Fatal("asset preset image migration must repair config columns idempotently")
	}
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS shuihuo_asset_styles",
		"CREATE TABLE IF NOT EXISTS shuihuo_asset_images",
		"asset_id BIGINT NOT NULL",
		"task_id BIGINT NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("asset preset image migration missing %q", required)
		}
	}
}

func TestShuihuoAssetHistoryMigrationPreservesGeneratedImages(t *testing.T) {
	migration := migrationForVersion(t, 26)
	if migration.apply == nil {
		t.Fatal("asset history migration must repair existing tables idempotently")
	}
	for _, required := range []string{
		"ALTER TABLE shuihuo_assets ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT TRUE",
		"asset_name_snapshot VARCHAR(255) NOT NULL DEFAULT ''",
		"asset_category_snapshot VARCHAR(32) NOT NULL DEFAULT ''",
		"asset_prompt_snapshot MEDIUMTEXT NOT NULL",
	} {
		if !strings.Contains(migration.sql, required) {
			t.Fatalf("asset history migration missing %q", required)
		}
	}
}

func TestModelCenterCatalogMigrationAddsCompatibilityColumns(t *testing.T) {
	migration := migrationForVersion(t, 27)
	if migration.apply == nil {
		t.Fatal("model-center catalog migration must use an idempotent apply function")
	}
	if migration.sql != "" {
		t.Fatal("model-center catalog migration must not keep a non-executed duplicate SQL definition")
	}
	appliedSQL := make([]string, 0, len(modelCenterCatalogColumns)+2)
	for _, column := range modelCenterCatalogColumns {
		appliedSQL = append(appliedSQL, modelCenterCatalogAddColumnSQL(column))
	}
	appliedSQL = append(appliedSQL, modelCenterCatalogBackfillSQL, modelCenterCatalogUniqueIndexSQL)
	schema := strings.Join(appliedSQL, ";\n")
	for _, required := range []string{
		"model_key VARCHAR(128) NOT NULL DEFAULT ''",
		"hidden BOOLEAN NOT NULL DEFAULT FALSE",
		"sort_order INT NOT NULL DEFAULT 0",
		"admin_note MEDIUMTEXT NULL",
		"base_domain VARCHAR(512) NOT NULL DEFAULT ''",
		"base_path VARCHAR(1024) NOT NULL DEFAULT ''",
		"polling_template MEDIUMTEXT NULL",
		"image_input_format VARCHAR(16) NOT NULL DEFAULT 'url'",
		"image_request_mode VARCHAR(16) NOT NULL DEFAULT 'json'",
		"runtime_policy_json JSON NULL",
		"UNIQUE KEY uniq_model_definition_key",
		"CONCAT('legacy-', LOWER(kind), '-', id)",
	} {
		if !strings.Contains(schema, required) {
			t.Fatalf("model-center applied schema missing %q", required)
		}
	}
}

func TestModelCenterCatalogMigrationBackfillsLegacyKeysAndIsRepeatable(t *testing.T) {
	executor := &modelCenterCatalogMigrationTestExecutor{
		columns: map[string]bool{},
		indexes: map[string]bool{},
		definitions: []modelCenterMigrationDefinition{
			{id: 12, kind: "IMAGE"},
			{id: 4, kind: "text"},
			{id: 9, kind: "video", modelKey: "configured-video"},
		},
	}
	columnExists := func(_ context.Context, table, column string) (bool, error) {
		return executor.columns[table+"."+column], nil
	}
	indexExists := func(_ context.Context, table, index string) (bool, error) {
		return executor.indexes[table+"."+index], nil
	}
	findCollision := func(context.Context) (string, error) { return executor.findCollision(), nil }

	if err := applyModelCenterCatalogMigrationWithExecutor(context.Background(), executor, columnExists, indexExists, findCollision); err != nil {
		t.Fatalf("first model-center migration apply: %v", err)
	}
	if err := applyModelCenterCatalogMigrationWithExecutor(context.Background(), executor, columnExists, indexExists, findCollision); err != nil {
		t.Fatalf("repeat model-center migration apply: %v", err)
	}

	for _, column := range modelCenterCatalogColumns {
		key := column.table + "." + column.name
		if !executor.columns[key] || executor.columnAdds[key] != 1 {
			t.Fatalf("column %q state = columns:%v adds:%v", key, executor.columns, executor.columnAdds)
		}
	}
	if !executor.indexes["model_definitions.uniq_model_definition_key"] || executor.indexAdds["model_definitions.uniq_model_definition_key"] != 1 {
		t.Fatalf("model-key index state = indexes:%v adds:%v", executor.indexes, executor.indexAdds)
	}
	if got, want := executor.definitionKey(12), "legacy-image-12"; got != want {
		t.Fatalf("definition 12 model key = %q, want %q", got, want)
	}
	if got, want := executor.definitionKey(4), "legacy-text-4"; got != want {
		t.Fatalf("definition 4 model key = %q, want %q", got, want)
	}
	if got, want := executor.definitionKey(9), "configured-video"; got != want {
		t.Fatalf("definition 9 model key = %q, want %q", got, want)
	}
	if executor.backfillRuns != 2 {
		t.Fatalf("backfill runs = %d, want 2 for repeat safety", executor.backfillRuns)
	}
	executor.assertBackfillPrecedesUniqueIndex(t)
}

func TestModelCenterCatalogMigrationRejectsLegacyKeyCollision(t *testing.T) {
	executor := &modelCenterCatalogMigrationTestExecutor{
		columns: map[string]bool{},
		indexes: map[string]bool{},
		definitions: []modelCenterMigrationDefinition{
			{id: 12, kind: "image"},
			{id: 99, kind: "text", modelKey: "legacy-image-12"},
		},
	}
	columnExists := func(_ context.Context, table, column string) (bool, error) {
		return executor.columns[table+"."+column], nil
	}
	indexExists := func(_ context.Context, table, index string) (bool, error) {
		return executor.indexes[table+"."+index], nil
	}
	findCollision := func(context.Context) (string, error) { return executor.findCollision(), nil }

	err := applyModelCenterCatalogMigrationWithExecutor(context.Background(), executor, columnExists, indexExists, findCollision)
	if err == nil || !strings.Contains(err.Error(), "legacy-image-12") {
		t.Fatalf("collision error = %v, want colliding model key", err)
	}
	if got := executor.definitionKey(12); got != "" {
		t.Fatalf("colliding definition key = %q, want unchanged empty value", got)
	}
	if executor.indexes["model_definitions.uniq_model_definition_key"] {
		t.Fatal("unique model-key index must not be added after a collision")
	}
}

func TestImportCompensationMigrationRetriesAfterPartialDDL(t *testing.T) {
	executor := &importCompensationMigrationTestExecutor{
		columns:         map[string]bool{},
		indexes:         map[string]bool{},
		failTableCreate: true,
	}
	columnExists := func(_ context.Context, column string) (bool, error) { return executor.columns[column], nil }
	indexExists := func(_ context.Context, index string) (bool, error) { return executor.indexes[index], nil }

	if err := applyShuihuoImportCompensationMigrationWithExecutor(context.Background(), executor, columnExists, indexExists); err == nil {
		t.Fatal("first migration apply should fail after the lease DDL has been applied")
	}
	if !executor.columns["lease_token"] || !executor.columns["lease_expires_at"] || !executor.indexes["idx_shuihuo_object_cleanup_lease"] {
		t.Fatalf("partial migration state = columns:%v indexes:%v", executor.columns, executor.indexes)
	}

	if err := applyShuihuoImportCompensationMigrationWithExecutor(context.Background(), executor, columnExists, indexExists); err != nil {
		t.Fatalf("retry after partial migration failed: %v", err)
	}
	if err := applyShuihuoImportCompensationMigrationWithExecutor(context.Background(), executor, columnExists, indexExists); err != nil {
		t.Fatalf("repeat migration failed: %v", err)
	}
	if executor.columnAdds["lease_token"] != 1 || executor.columnAdds["lease_expires_at"] != 1 || executor.indexAdds["idx_shuihuo_object_cleanup_lease"] != 1 {
		t.Fatalf("lease DDL was repeated: columns=%v indexes=%v", executor.columnAdds, executor.indexAdds)
	}
	if !executor.tableCreated {
		t.Fatal("import compensation table was not created on retry")
	}
}

func TestSourceUnitMigrationBackfillIsIdempotent(t *testing.T) {
	executor := &legacySourceUnitMigrationExecutor{
		segments: []legacySourceUnitSegment{
			{id: 11, projectID: 101, text: "第一句", order: 1},
			{id: 12, projectID: 101, text: "第二句", order: 2},
		},
	}
	if err := applyShuihuoSourceUnitMigration(context.Background(), executor); err != nil {
		t.Fatalf("first applyShuihuoSourceUnitMigration() error = %v", err)
	}
	if err := applyShuihuoSourceUnitMigration(context.Background(), executor); err != nil {
		t.Fatalf("second applyShuihuoSourceUnitMigration() error = %v", err)
	}
	if got, want := len(executor.units), len(executor.segments); got != want {
		t.Fatalf("source units = %d, want %d", got, want)
	}
	for _, segment := range executor.segments {
		mappings := executor.mappings[segment.id]
		if len(mappings) != 1 {
			t.Fatalf("segment %d mappings = %v, want exactly one", segment.id, mappings)
		}
		unit := executor.units[mappings[0]]
		if unit.projectID != segment.projectID || unit.text != segment.text || unit.order != segment.order {
			t.Fatalf("segment %d mapping = %#v, want legacy source identity", segment.id, unit)
		}
	}
}

func TestSourceUnitOrderUpgradeNormalizesDuplicateLegacyOrders(t *testing.T) {
	// The standard repository test command has no MySQL DSN, container harness, or
	// external database dependency. This recording executor runs the production v16
	// migration body so go test ./... proves retry and normalization behavior locally.
	executor := &legacySourceUnitMigrationExecutor{
		units: map[int64]legacySourceUnit{
			1: {id: 1, projectID: 101, text: "第一句", order: 1},
			2: {id: 2, projectID: 101, text: "第二句", order: 1},
			3: {id: 3, projectID: 101, text: "第三句", order: 4},
			4: {id: 4, projectID: 102, text: "另一个项目", order: 1},
		},
	}
	if err := ensureShuihuoSourceUnitOrderUniqueWithExecutor(context.Background(), executor, func(context.Context) (bool, error) {
		return false, nil
	}); err != nil {
		t.Fatalf("ensureShuihuoSourceUnitOrderUniqueWithExecutor() error = %v", err)
	}
	if !executor.uniqueIndexCreated {
		t.Fatal("v16 must create the project/source-order unique index after normalization")
	}
	if got, want := []int{executor.units[1].order, executor.units[2].order, executor.units[3].order, executor.units[4].order}, []int{1, 2, 3, 1}; !sameInts(got, want) {
		t.Fatalf("normalized orders = %v, want %v", got, want)
	}
	assertSourceUnitOrderNormalizationPrecedesUniqueIndex(t, executor.commands)
}

func TestMySQLSourceUnitMigrationsAreRepeatable(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("QIANTIE_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("QIANTIE_MYSQL_DSN is not set; skipping MySQL migration integration test")
	}

	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse QIANTIE_MYSQL_DSN: %v", err)
	}
	config.DBName = ""
	admin, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatalf("open MySQL admin connection: %v", err)
	}
	defer admin.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := admin.PingContext(ctx); err != nil {
		t.Fatalf("ping MySQL: %v", err)
	}
	databaseName := fmt.Sprintf("qiantie_source_unit_migration_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE `"+databaseName+"` CHARACTER SET utf8mb4"); err != nil {
		t.Fatalf("create temporary database: %v", err)
	}

	config.DBName = databaseName
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatalf("open temporary database: %v", err)
	}
	defer func() {
		_ = db.Close()
		if _, err := admin.ExecContext(context.Background(), "DROP DATABASE `"+databaseName+"`"); err != nil {
			t.Errorf("drop temporary database: %v", err)
		}
	}()

	for _, statement := range []string{
		`CREATE TABLE shuihuo_projects (
			id BIGINT PRIMARY KEY,
			segmentation_version INT NOT NULL DEFAULT 0
		) ENGINE=InnoDB`,
		`CREATE TABLE shuihuo_segments (
			id BIGINT PRIMARY KEY,
			project_id BIGINT NOT NULL,
			source_text MEDIUMTEXT NOT NULL,
			order_index INT NOT NULL,
			UNIQUE KEY uniq_shuihuo_segments_project_order (project_id, order_index),
			CONSTRAINT fk_test_segments_project FOREIGN KEY (project_id) REFERENCES shuihuo_projects(id) ON DELETE CASCADE
		) ENGINE=InnoDB`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO shuihuo_projects(id) VALUES (1)`); err != nil {
		t.Fatalf("seed project: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO shuihuo_segments(id, project_id, source_text, order_index)
VALUES (11, 1, '第一句', 1), (12, 1, '第二句', 2)`); err != nil {
		t.Fatalf("seed legacy segments: %v", err)
	}

	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("open migration connection: %v", err)
	}
	defer conn.Close()
	for attempt := 1; attempt <= 2; attempt++ {
		if err := applyShuihuoSourceUnitMigration(ctx, conn); err != nil {
			t.Fatalf("apply v15 source-unit migration attempt %d: %v", attempt, err)
		}
	}
	assertMySQLSourceUnitBackfill(t, ctx, db, 2)

	if _, err := conn.ExecContext(ctx, `ALTER TABLE shuihuo_source_units DROP INDEX uniq_shuihuo_source_units_project_order`); err != nil {
		t.Fatalf("drop v15 unique index for v16 upgrade simulation: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `UPDATE shuihuo_source_units SET source_order = 1 WHERE project_id = 1`); err != nil {
		t.Fatalf("seed duplicate legacy source orders: %v", err)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if err := ensureShuihuoSourceUnitOrderUnique(ctx, conn); err != nil {
			t.Fatalf("apply v16 source-order migration attempt %d: %v", attempt, err)
		}
	}

	var indexCount int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'shuihuo_source_units'
  AND index_name = 'uniq_shuihuo_source_units_project_order'`).Scan(&indexCount); err != nil {
		t.Fatalf("read source-order unique index: %v", err)
	}
	if indexCount != 2 {
		t.Fatalf("source-order unique index columns = %d, want 2", indexCount)
	}
	rows, err := db.QueryContext(ctx, `SELECT source_order FROM shuihuo_source_units WHERE project_id = 1 ORDER BY source_order ASC, id ASC`)
	if err != nil {
		t.Fatalf("read normalized source orders: %v", err)
	}
	defer rows.Close()
	orders := make([]int, 0, 2)
	for rows.Next() {
		var order int
		if err := rows.Scan(&order); err != nil {
			t.Fatalf("scan normalized source order: %v", err)
		}
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read normalized source orders: %v", err)
	}
	if !sameInts(orders, []int{1, 2}) {
		t.Fatalf("normalized source orders = %v, want [1 2]", orders)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if err := addShuihuoSourceUnitSegmentationVersions(ctx, conn); err != nil {
			t.Fatalf("apply v17 source-unit version migration attempt %d: %v", attempt, err)
		}
	}
	assertMySQLSourceUnitVersionMigration(t, ctx, db)
	assertMySQLSourceUnitBackfill(t, ctx, db, 2)

	for _, statement := range []string{
		`CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB`,
		`CREATE TABLE shuihuo_object_cleanup_queue (
			id BIGINT PRIMARY KEY AUTO_INCREMENT,
			object_key VARCHAR(768) NOT NULL,
			reason VARCHAR(128) NOT NULL,
			last_error VARCHAR(2048) NOT NULL DEFAULT '',
			attempt_count INT NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_attempt_at DATETIME NULL,
			UNIQUE KEY uniq_shuihuo_object_cleanup_key (object_key)
		) ENGINE=InnoDB`,
		// Simulate an interrupted v19 upgrade after its first DDL statement.
		`ALTER TABLE shuihuo_object_cleanup_queue ADD COLUMN lease_token VARCHAR(64) NOT NULL DEFAULT ''`,
	} {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			t.Fatalf("prepare v19 retry schema: %v", err)
		}
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if err := addShuihuoImportCompensationRecovery(ctx, conn); err != nil {
			t.Fatalf("apply v19 import compensation migration attempt %d: %v", attempt, err)
		}
	}
	for _, column := range []string{"lease_token", "lease_expires_at"} {
		var count int
		if err := db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'shuihuo_object_cleanup_queue' AND column_name = ?`, column).Scan(&count); err != nil {
			t.Fatalf("read v19 column %s: %v", column, err)
		}
		if count != 1 {
			t.Fatalf("v19 column %s count = %d, want 1", column, count)
		}
	}
	var tableCount int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'shuihuo_import_compensation_queue'`).Scan(&tableCount); err != nil {
		t.Fatalf("read v19 import compensation table: %v", err)
	}
	if tableCount != 1 {
		t.Fatalf("v19 import compensation table count = %d, want 1", tableCount)
	}
}

func TestMySQLModelCenterCatalogMigration(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("QIANTIE_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("QIANTIE_MYSQL_DSN is not set; skipping Model Center migration integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("backfills populated definitions and preserves versions", func(t *testing.T) {
		db, conn := openModelCenterMigrationTestDatabase(t, ctx, dsn)
		createLegacyModelCatalogTables(t, ctx, conn)
		for _, statement := range []string{
			`INSERT INTO model_definitions(id, name, kind, adapter_kind, enabled) VALUES
				(7, 'Legacy Text', 'TEXT', 'text_completion', TRUE),
				(12, 'Legacy Image', 'image', 'generic_http', TRUE)`,
			`INSERT INTO model_versions(id, model_definition_id, version_number, credential_ref, endpoint) VALUES
				(70, 7, 1, 'text-ref', 'https://text.example'),
				(120, 12, 1, 'image-ref', 'https://image.example')`,
		} {
			if _, err := conn.ExecContext(ctx, statement); err != nil {
				t.Fatalf("seed legacy catalog: %v", err)
			}
		}

		for attempt := 1; attempt <= 2; attempt++ {
			if err := addModelCenterCatalogColumns(ctx, conn); err != nil {
				t.Fatalf("apply v27 model-center migration attempt %d: %v", attempt, err)
			}
		}

		assertMySQLModelCenterCatalogColumns(t, ctx, db)
		var indexColumns int
		if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'model_definitions'
  AND index_name = 'uniq_model_definition_key'`).Scan(&indexColumns); err != nil {
			t.Fatalf("read model-key index: %v", err)
		}
		if indexColumns != 1 {
			t.Fatalf("model-key unique index columns = %d, want 1", indexColumns)
		}

		rows, err := db.QueryContext(ctx, `SELECT id, model_key FROM model_definitions ORDER BY id ASC`)
		if err != nil {
			t.Fatalf("read migrated model keys: %v", err)
		}
		defer rows.Close()
		keys := map[int64]string{}
		for rows.Next() {
			var id int64
			var key string
			if err := rows.Scan(&id, &key); err != nil {
				t.Fatalf("scan migrated model key: %v", err)
			}
			keys[id] = key
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("read migrated model keys: %v", err)
		}
		if got, want := keys[7], "legacy-text-7"; got != want {
			t.Fatalf("definition 7 model key = %q, want %q", got, want)
		}
		if got, want := keys[12], "legacy-image-12"; got != want {
			t.Fatalf("definition 12 model key = %q, want %q", got, want)
		}
		for versionID, wantDefinitionID := range map[int64]int64{70: 7, 120: 12} {
			var definitionID int64
			if err := db.QueryRowContext(ctx, `SELECT model_definition_id FROM model_versions WHERE id = ?`, versionID).Scan(&definitionID); err != nil {
				t.Fatalf("read version %d definition: %v", versionID, err)
			}
			if definitionID != wantDefinitionID {
				t.Fatalf("version %d definition ID = %d, want %d", versionID, definitionID, wantDefinitionID)
			}
		}
		_, err = conn.ExecContext(ctx, `
INSERT INTO model_versions(id, model_definition_id, version_number, credential_ref, endpoint)
VALUES (999, 999999, 1, 'invalid-ref', 'https://invalid.example')`)
		var mysqlErr *mysql.MySQLError
		if !errors.As(err, &mysqlErr) || mysqlErr.Number != 1452 {
			t.Fatalf("invalid version definition insert error = %v, want MySQL foreign-key error 1452", err)
		}
	})

	t.Run("rejects collision before backfill or unique index", func(t *testing.T) {
		db, conn := openModelCenterMigrationTestDatabase(t, ctx, dsn)
		createLegacyModelCatalogTables(t, ctx, conn)
		if _, err := conn.ExecContext(ctx, `ALTER TABLE model_definitions ADD COLUMN model_key VARCHAR(128) NOT NULL DEFAULT ''`); err != nil {
			t.Fatalf("prepare partial migration: %v", err)
		}
		if _, err := conn.ExecContext(ctx, `INSERT INTO model_definitions(id, name, kind, adapter_kind, enabled, model_key) VALUES
			(12, 'Legacy Image', 'image', 'generic_http', TRUE, ''),
			(99, 'Assigned Key', 'text', 'text_completion', TRUE, 'legacy-image-12')`); err != nil {
			t.Fatalf("seed collision fixture: %v", err)
		}

		err := addModelCenterCatalogColumns(ctx, conn)
		if err == nil || !strings.Contains(err.Error(), "model key collision") || !strings.Contains(err.Error(), "legacy-image-12") {
			t.Fatalf("collision migration error = %v, want explicit model-key collision", err)
		}
		var indexColumns int
		if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'model_definitions'
  AND index_name = 'uniq_model_definition_key'`).Scan(&indexColumns); err != nil {
			t.Fatalf("read model-key index after collision: %v", err)
		}
		if indexColumns != 0 {
			t.Fatalf("model-key unique index columns after collision = %d, want 0", indexColumns)
		}
		var key string
		if err := db.QueryRowContext(ctx, `SELECT model_key FROM model_definitions WHERE id = 12`).Scan(&key); err != nil {
			t.Fatalf("read colliding definition key: %v", err)
		}
		if key != "" {
			t.Fatalf("colliding definition key = %q, want unchanged empty value", key)
		}
	})
}

func openModelCenterMigrationTestDatabase(t *testing.T, ctx context.Context, dsn string) (*sql.DB, *sql.Conn) {
	t.Helper()
	config, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse QIANTIE_MYSQL_DSN: %v", err)
	}
	config.DBName = ""
	admin, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatalf("open MySQL admin connection: %v", err)
	}
	if err := admin.PingContext(ctx); err != nil {
		_ = admin.Close()
		t.Fatalf("ping MySQL: %v", err)
	}
	databaseName := fmt.Sprintf("qiantie_model_center_migration_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE `"+databaseName+"` CHARACTER SET utf8mb4"); err != nil {
		_ = admin.Close()
		t.Fatalf("create temporary database: %v", err)
	}

	config.DBName = databaseName
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		_, _ = admin.ExecContext(context.Background(), "DROP DATABASE `"+databaseName+"`")
		_ = admin.Close()
		t.Fatalf("open temporary database: %v", err)
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		_ = db.Close()
		_, _ = admin.ExecContext(context.Background(), "DROP DATABASE `"+databaseName+"`")
		_ = admin.Close()
		t.Fatalf("open migration connection: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
		_ = db.Close()
		if _, err := admin.ExecContext(context.Background(), "DROP DATABASE `"+databaseName+"`"); err != nil {
			t.Errorf("drop temporary database: %v", err)
		}
		_ = admin.Close()
	})
	return db, conn
}

func createLegacyModelCatalogTables(t *testing.T, ctx context.Context, conn *sql.Conn) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE model_definitions (
			id BIGINT PRIMARY KEY,
			name VARCHAR(128) NOT NULL,
			kind VARCHAR(32) NOT NULL,
			adapter_kind VARCHAR(64) NOT NULL,
			enabled BOOLEAN NOT NULL DEFAULT FALSE,
			allowed_roles_json JSON NULL,
			parameter_schema_json JSON NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_model_definition_name (name)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE model_versions (
			id BIGINT PRIMARY KEY,
			model_definition_id BIGINT NOT NULL,
			version_number INT NOT NULL,
			credential_ref VARCHAR(255) NOT NULL DEFAULT '',
			endpoint VARCHAR(1024) NOT NULL DEFAULT '',
			request_template MEDIUMTEXT NULL,
			response_mapping MEDIUMTEXT NULL,
			created_by BIGINT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_model_version (model_definition_id, version_number),
			CONSTRAINT fk_test_model_version_definition FOREIGN KEY (model_definition_id) REFERENCES model_definitions(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	} {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			t.Fatalf("create legacy model catalog schema: %v", err)
		}
	}
}

func assertMySQLModelCenterCatalogColumns(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	for _, column := range modelCenterCatalogColumns {
		var count int
		if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, column.table, column.name).Scan(&count); err != nil {
			t.Fatalf("read model-center column %s.%s: %v", column.table, column.name, err)
		}
		if count != 1 {
			t.Fatalf("model-center column %s.%s count = %d, want 1", column.table, column.name, count)
		}
	}
}

func assertMySQLSourceUnitVersionMigration(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	var segmentationVersionColumn int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'shuihuo_source_units'
  AND column_name = 'segmentation_version'`).Scan(&segmentationVersionColumn); err != nil {
		t.Fatalf("read segmentation version column: %v", err)
	}
	if segmentationVersionColumn != 1 {
		t.Fatalf("segmentation version column = %d, want 1", segmentationVersionColumn)
	}
	var versionedIndexColumns int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'shuihuo_source_units'
  AND index_name = 'uniq_shuihuo_source_units_project_version_order'`).Scan(&versionedIndexColumns); err != nil {
		t.Fatalf("read versioned source-order unique index: %v", err)
	}
	if versionedIndexColumns != 3 {
		t.Fatalf("versioned source-order unique index columns = %d, want 3", versionedIndexColumns)
	}
	var oldIndexColumns int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'shuihuo_source_units'
  AND index_name = 'uniq_shuihuo_source_units_project_order'`).Scan(&oldIndexColumns); err != nil {
		t.Fatalf("read old source-order unique index: %v", err)
	}
	if oldIndexColumns != 0 {
		t.Fatalf("old source-order unique index columns = %d, want 0", oldIndexColumns)
	}
	var historyTableCount int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'shuihuo_segment_source_unit_history'`).Scan(&historyTableCount); err != nil {
		t.Fatalf("read source mapping history table: %v", err)
	}
	if historyTableCount != 1 {
		t.Fatalf("source mapping history table = %d, want 1", historyTableCount)
	}
}

func assertMySQLSourceUnitBackfill(t *testing.T, ctx context.Context, db *sql.DB, want int) {
	t.Helper()
	for _, table := range []string{"shuihuo_source_units", "shuihuo_segment_source_units"} {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != want {
			t.Fatalf("%s rows = %d, want %d", table, count, want)
		}
	}
	var mappedSegments int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM (
		SELECT segment_id
		FROM shuihuo_segment_source_units
		GROUP BY segment_id
		HAVING COUNT(*) = 1
	) AS single_mapped_segments`).Scan(&mappedSegments); err != nil {
		t.Fatalf("count one-to-one source mappings: %v", err)
	}
	if mappedSegments != want {
		t.Fatalf("segments with one source mapping = %d, want %d", mappedSegments, want)
	}
}

type legacySourceUnitSegment struct {
	id, projectID int64
	text          string
	order         int
}

type legacySourceUnit struct {
	id, projectID int64
	text          string
	order         int
}

type legacySourceUnitMigrationExecutor struct {
	segments           []legacySourceUnitSegment
	units              map[int64]legacySourceUnit
	mappings           map[int64][]int64
	nextID             int64
	uniqueIndexCreated bool
	commands           []string
}

func assertSourceUnitOrderNormalizationPrecedesUniqueIndex(t *testing.T, commands []string) {
	t.Helper()
	const update = "UPDATE shuihuo_source_units SET source_order = ? WHERE id = ?"
	const uniqueIndex = "ALTER TABLE shuihuo_source_units ADD UNIQUE KEY uniq_shuihuo_source_units_project_order (project_id, source_order)"
	uniqueIndexAt := -1
	updateCount := 0
	for index, command := range commands {
		switch command {
		case update:
			updateCount++
			if uniqueIndexAt >= 0 {
				t.Fatalf("normalization update occurred after unique index creation: %v", commands)
			}
		case uniqueIndex:
			uniqueIndexAt = index
		}
	}
	if updateCount != 4 {
		t.Fatalf("normalization updates = %d, want 4; commands = %v", updateCount, commands)
	}
	if uniqueIndexAt < 0 {
		t.Fatalf("unique index creation command missing: %v", commands)
	}
}

func sameInts(got, want []int) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func (e *legacySourceUnitMigrationExecutor) QueryContext(_ context.Context, query string, _ ...any) (sourceUnitOrderRows, error) {
	command := strings.TrimSpace(query)
	e.commands = append(e.commands, command)
	if !strings.Contains(command, "FROM shuihuo_source_units") {
		return nil, fmt.Errorf("unexpected query: %s", command)
	}
	ordered := make([]sourceUnitOrder, 0, len(e.units))
	for _, unit := range e.units {
		ordered = append(ordered, sourceUnitOrder{id: unit.id, projectID: unit.projectID, sourceOrder: unit.order})
	}
	sort.Slice(ordered, func(left, right int) bool {
		if ordered[left].projectID != ordered[right].projectID {
			return ordered[left].projectID < ordered[right].projectID
		}
		if ordered[left].sourceOrder != ordered[right].sourceOrder {
			return ordered[left].sourceOrder < ordered[right].sourceOrder
		}
		return ordered[left].id < ordered[right].id
	})
	return &legacySourceUnitOrderRows{items: ordered, index: -1}, nil
}

func (e *legacySourceUnitMigrationExecutor) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	if e.units == nil {
		e.units = make(map[int64]legacySourceUnit)
		e.mappings = make(map[int64][]int64)
	}
	command := strings.TrimSpace(query)
	e.commands = append(e.commands, command)
	switch {
	case command == "UPDATE shuihuo_source_units SET source_order = ? WHERE id = ?":
		sourceOrder, ok := args[0].(int)
		if !ok {
			return nil, fmt.Errorf("source order argument type = %T, want int", args[0])
		}
		id, ok := args[1].(int64)
		if !ok {
			return nil, fmt.Errorf("source unit id argument type = %T, want int64", args[1])
		}
		unit := e.units[id]
		unit.order = sourceOrder
		e.units[id] = unit
	case command == "ALTER TABLE shuihuo_source_units ADD UNIQUE KEY uniq_shuihuo_source_units_project_order (project_id, source_order)":
		e.uniqueIndexCreated = true
	case strings.Contains(query, "INSERT INTO shuihuo_source_units"):
		for _, segment := range e.segments {
			if len(e.mappings[segment.id]) != 0 || e.findLegacyUnit(segment) != 0 {
				continue
			}
			e.nextID++
			e.units[e.nextID] = legacySourceUnit{id: e.nextID, projectID: segment.projectID, text: segment.text, order: segment.order}
		}
	case strings.Contains(query, "INSERT IGNORE INTO shuihuo_segment_source_units"):
		for _, segment := range e.segments {
			if len(e.mappings[segment.id]) != 0 {
				continue
			}
			if unitID := e.findLegacyUnit(segment); unitID != 0 {
				e.mappings[segment.id] = []int64{unitID}
			}
		}
	}
	return migrationTestResult{}, nil
}

type legacySourceUnitOrderRows struct {
	items []sourceUnitOrder
	index int
}

func (r *legacySourceUnitOrderRows) Close() error { return nil }

func (r *legacySourceUnitOrderRows) Err() error { return nil }

func (r *legacySourceUnitOrderRows) Next() bool {
	r.index++
	return r.index < len(r.items)
}

func (r *legacySourceUnitOrderRows) Scan(destinations ...any) error {
	if len(destinations) != 2 {
		return fmt.Errorf("scan destinations = %d, want 2", len(destinations))
	}
	id, ok := destinations[0].(*int64)
	if !ok {
		return fmt.Errorf("id scan destination type = %T, want *int64", destinations[0])
	}
	projectID, ok := destinations[1].(*int64)
	if !ok {
		return fmt.Errorf("project id scan destination type = %T, want *int64", destinations[1])
	}
	*id = r.items[r.index].id
	*projectID = r.items[r.index].projectID
	return nil
}

func (e *legacySourceUnitMigrationExecutor) findLegacyUnit(segment legacySourceUnitSegment) int64 {
	for id, unit := range e.units {
		if unit.projectID == segment.projectID && unit.order == segment.order {
			return id
		}
	}
	return 0
}

type migrationTestResult struct{}

func (migrationTestResult) LastInsertId() (int64, error) { return 0, nil }
func (migrationTestResult) RowsAffected() (int64, error) { return 0, nil }

type modelCenterMigrationDefinition struct {
	id       int64
	kind     string
	modelKey string
}

type modelCenterCatalogMigrationTestExecutor struct {
	columns      map[string]bool
	indexes      map[string]bool
	columnAdds   map[string]int
	indexAdds    map[string]int
	definitions  []modelCenterMigrationDefinition
	backfillRuns int
	commands     []string
}

func (e *modelCenterCatalogMigrationTestExecutor) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	command := strings.TrimSpace(query)
	e.commands = append(e.commands, command)
	if e.columnAdds == nil {
		e.columnAdds = make(map[string]int)
		e.indexAdds = make(map[string]int)
	}
	for _, column := range modelCenterCatalogColumns {
		if strings.Contains(command, "ALTER TABLE "+column.table+" ADD COLUMN "+column.name+" ") {
			key := column.table + "." + column.name
			e.columns[key] = true
			e.columnAdds[key]++
			return migrationTestResult{}, nil
		}
	}
	switch {
	case strings.Contains(command, "UPDATE model_definitions") && strings.Contains(command, "SET model_key = CONCAT('legacy-', LOWER(kind), '-', id)"):
		e.backfillRuns++
		for index := range e.definitions {
			if e.definitions[index].modelKey == "" {
				e.definitions[index].modelKey = fmt.Sprintf("legacy-%s-%d", strings.ToLower(e.definitions[index].kind), e.definitions[index].id)
			}
		}
	case strings.Contains(command, "ALTER TABLE model_definitions ADD UNIQUE KEY uniq_model_definition_key"):
		e.indexes["model_definitions.uniq_model_definition_key"] = true
		e.indexAdds["model_definitions.uniq_model_definition_key"]++
	default:
		return nil, fmt.Errorf("unexpected model-center migration command: %s", command)
	}
	return migrationTestResult{}, nil
}

func (e *modelCenterCatalogMigrationTestExecutor) findCollision() string {
	keys := make(map[string]int)
	for _, definition := range e.definitions {
		if definition.modelKey != "" {
			keys[definition.modelKey]++
			continue
		}
		keys[fmt.Sprintf("legacy-%s-%d", strings.ToLower(definition.kind), definition.id)]++
	}
	for key, count := range keys {
		if count > 1 {
			return key
		}
	}
	return ""
}

func (e *modelCenterCatalogMigrationTestExecutor) definitionKey(id int64) string {
	for _, definition := range e.definitions {
		if definition.id == id {
			return definition.modelKey
		}
	}
	return ""
}

func (e *modelCenterCatalogMigrationTestExecutor) assertBackfillPrecedesUniqueIndex(t *testing.T) {
	t.Helper()
	backfillAt := -1
	uniqueIndexAt := -1
	for index, command := range e.commands {
		if backfillAt < 0 && strings.Contains(command, "UPDATE model_definitions") {
			backfillAt = index
		}
		if uniqueIndexAt < 0 && strings.Contains(command, "ADD UNIQUE KEY uniq_model_definition_key") {
			uniqueIndexAt = index
		}
	}
	if backfillAt < 0 || uniqueIndexAt < 0 || backfillAt > uniqueIndexAt {
		t.Fatalf("commands must backfill before adding the unique model-key index: %v", e.commands)
	}
}

type importCompensationMigrationTestExecutor struct {
	columns         map[string]bool
	indexes         map[string]bool
	columnAdds      map[string]int
	indexAdds       map[string]int
	failTableCreate bool
	tableCreated    bool
}

type assetPromptSelectionMigrationTestExecutor struct {
	columns    map[string]bool
	columnAdds map[string]int
}

func (e *assetPromptSelectionMigrationTestExecutor) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	command := strings.TrimSpace(query)
	if e.columnAdds == nil {
		e.columnAdds = make(map[string]int)
	}
	for _, column := range []string{"character_preset_id", "scene_preset_id"} {
		if strings.Contains(command, "ADD COLUMN "+column+" VARCHAR(64) NULL") {
			e.columns[column] = true
			e.columnAdds[column]++
			return migrationTestResult{}, nil
		}
	}
	return nil, fmt.Errorf("unexpected asset prompt selection migration command: %s", command)
}

func (e *importCompensationMigrationTestExecutor) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	command := strings.TrimSpace(query)
	if e.columnAdds == nil {
		e.columnAdds = make(map[string]int)
		e.indexAdds = make(map[string]int)
	}
	switch {
	case strings.Contains(command, "ADD COLUMN lease_token"):
		e.columns["lease_token"] = true
		e.columnAdds["lease_token"]++
	case strings.Contains(command, "ADD COLUMN lease_expires_at"):
		e.columns["lease_expires_at"] = true
		e.columnAdds["lease_expires_at"]++
	case strings.Contains(command, "ADD KEY idx_shuihuo_object_cleanup_lease"):
		e.indexes["idx_shuihuo_object_cleanup_lease"] = true
		e.indexAdds["idx_shuihuo_object_cleanup_lease"]++
	case strings.Contains(command, "CREATE TABLE IF NOT EXISTS shuihuo_import_compensation_queue"):
		if e.failTableCreate {
			e.failTableCreate = false
			return nil, fmt.Errorf("simulated interruption after lease DDL")
		}
		e.tableCreated = true
	default:
		return nil, fmt.Errorf("unexpected import compensation migration command: %s", command)
	}
	return migrationTestResult{}, nil
}

func migrationSQL(t *testing.T, version int) string {
	return migrationForVersion(t, version).sql
}

func migrationForVersion(t *testing.T, version int) migration {
	t.Helper()
	for _, migration := range migrations {
		if migration.version == version {
			return migration
		}
	}
	t.Fatalf("migration %d not found", version)
	return migration{}
}
