package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
)

const assetGenerationConfigTestDriverName = "shuihuo_asset_generation_config_test"

var (
	registerAssetGenerationConfigTestDriver sync.Once
	assetGenerationConfigState              *assetGenerationConfigTestState
)

func TestAssetGenerationConfigIsProjectScoped(t *testing.T) {
	assets := newAssetGenerationConfigTestAssets(t)
	ctx := context.Background()
	assetGenerationConfigState.projects[101] = 11
	assetGenerationConfigState.projects[102] = 11
	assetGenerationConfigState.projects[201] = 22
	textModelID, imageModelID, audioModelID, promptTemplateID, mediaID := int64(31), int64(32), int64(33), int64(34), int64(35)
	characterPresetID, scenePresetID := "character-preset-v2", "scene-preset-v2"
	want := domain.AssetGenerationConfig{
		TextModelID:           &textModelID,
		ImageModelID:          &imageModelID,
		AudioModelID:          &audioModelID,
		PromptTemplateID:      &promptTemplateID,
		CharacterPresetID:     &characterPresetID,
		ScenePresetID:         &scenePresetID,
		AspectRatio:           "9:16",
		StyleReferenceMediaID: &mediaID,
		ThreeView:             true,
	}

	if err := assets.SaveGenerationConfig(ctx, 11, 101, want); err != nil {
		t.Fatalf("SaveGenerationConfig() error = %v", err)
	}
	got, err := assets.GetGenerationConfig(ctx, 11, 101)
	if err != nil {
		t.Fatalf("GetGenerationConfig() error = %v", err)
	}
	if got.ProjectID != 101 || !sameGenerationConfig(want, got) || got.UpdatedAt.IsZero() {
		t.Fatalf("GetGenerationConfig() = %#v, want project-scoped saved config", got)
	}

	otherProject, err := assets.GetGenerationConfig(ctx, 11, 102)
	if err != nil {
		t.Fatalf("GetGenerationConfig() other project error = %v", err)
	}
	if otherProject != (domain.AssetGenerationConfig{}) {
		t.Fatalf("other project config = %#v, want empty", otherProject)
	}
	otherOwner, err := assets.GetGenerationConfig(ctx, 22, 101)
	if err != nil {
		t.Fatalf("GetGenerationConfig() other owner error = %v", err)
	}
	if otherOwner != (domain.AssetGenerationConfig{}) {
		t.Fatalf("other owner config = %#v, want empty", otherOwner)
	}
	if err := assets.SaveGenerationConfig(ctx, 22, 101, want); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-owner SaveGenerationConfig() error = %v, want sql.ErrNoRows", err)
	}
	if _, ok := assetGenerationConfigState.configs[assetGenerationConfigKey{projectID: 101, ownerID: 22}]; ok {
		t.Fatal("cross-owner save created a configuration")
	}
}

func TestAssetGenerationConfigRejectsInvalidAspectRatio(t *testing.T) {
	assets := newAssetGenerationConfigTestAssets(t)
	assetGenerationConfigState.projects[101] = 11

	err := assets.SaveGenerationConfig(context.Background(), 11, 101, domain.AssetGenerationConfig{AspectRatio: "4:3"})
	if !errors.Is(err, ErrInvalidAssetGenerationAspectRatio) {
		t.Fatalf("SaveGenerationConfig() error = %v, want ErrInvalidAssetGenerationAspectRatio", err)
	}
	if len(assetGenerationConfigState.configs) != 0 {
		t.Fatalf("invalid aspect ratio wrote configs = %#v", assetGenerationConfigState.configs)
	}
}

func sameGenerationConfig(want, got domain.AssetGenerationConfig) bool {
	return sameInt64Ptr(want.TextModelID, got.TextModelID) &&
		sameInt64Ptr(want.ImageModelID, got.ImageModelID) &&
		sameInt64Ptr(want.AudioModelID, got.AudioModelID) &&
		sameInt64Ptr(want.PromptTemplateID, got.PromptTemplateID) &&
		sameStringPtr(want.CharacterPresetID, got.CharacterPresetID) &&
		sameStringPtr(want.ScenePresetID, got.ScenePresetID) &&
		want.AspectRatio == got.AspectRatio &&
		sameInt64Ptr(want.StyleReferenceMediaID, got.StyleReferenceMediaID) &&
		want.ThreeView == got.ThreeView
}

func sameStringPtr(left, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func sameInt64Ptr(left, right *int64) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func newAssetGenerationConfigTestAssets(t *testing.T) *Assets {
	t.Helper()
	registerAssetGenerationConfigTestDriver.Do(func() {
		sql.Register(assetGenerationConfigTestDriverName, assetGenerationConfigTestDriver{})
	})
	assetGenerationConfigState = &assetGenerationConfigTestState{
		projects: make(map[int64]int64),
		configs:  make(map[assetGenerationConfigKey]domain.AssetGenerationConfig),
	}
	db, err := sql.Open(assetGenerationConfigTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewAssets(db)
}

type assetGenerationConfigKey struct {
	projectID int64
	ownerID   int64
}

type assetGenerationConfigTestState struct {
	projects map[int64]int64
	configs  map[assetGenerationConfigKey]domain.AssetGenerationConfig
}

type assetGenerationConfigTestDriver struct{}

func (assetGenerationConfigTestDriver) Open(string) (driver.Conn, error) {
	return assetGenerationConfigTestConn{}, nil
}

type assetGenerationConfigTestConn struct{}

func (assetGenerationConfigTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (assetGenerationConfigTestConn) Close() error                        { return nil }
func (assetGenerationConfigTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (assetGenerationConfigTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactGenerationConfigSQL(query)
	if !strings.HasPrefix(query, "INSERT INTO shuihuo_asset_generation_configs") {
		return nil, errors.New("unexpected exec query: " + query)
	}
	projectID, ownerID := args[9].Value.(int64), args[10].Value.(int64)
	if assetGenerationConfigState.projects[projectID] != ownerID {
		return assetGenerationConfigTestResult{}, nil
	}
	config := domain.AssetGenerationConfig{
		ProjectID:             projectID,
		TextModelID:           asOptionalInt64(args[0].Value),
		ImageModelID:          asOptionalInt64(args[1].Value),
		AudioModelID:          asOptionalInt64(args[2].Value),
		PromptTemplateID:      asOptionalInt64(args[3].Value),
		CharacterPresetID:     asOptionalString(args[4].Value),
		ScenePresetID:         asOptionalString(args[5].Value),
		AspectRatio:           args[6].Value.(string),
		StyleReferenceMediaID: asOptionalInt64(args[7].Value),
		ThreeView:             args[8].Value.(bool),
		UpdatedAt:             time.Now().UTC(),
	}
	assetGenerationConfigState.configs[assetGenerationConfigKey{projectID: projectID, ownerID: ownerID}] = config
	return assetGenerationConfigTestResult{rows: 1}, nil
}

func (assetGenerationConfigTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	query = compactGenerationConfigSQL(query)
	if !strings.HasPrefix(query, "SELECT c.project_id, c.text_model_id") {
		return nil, errors.New("unexpected query: " + query)
	}
	projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
	config, ok := assetGenerationConfigState.configs[assetGenerationConfigKey{projectID: projectID, ownerID: ownerID}]
	if !ok || assetGenerationConfigState.projects[projectID] != ownerID {
		return &assetGenerationConfigTestRows{}, nil
	}
	return &assetGenerationConfigTestRows{
		columns: []string{"project_id", "text_model_id", "image_model_id", "audio_model_id", "prompt_template_id", "character_preset_id", "scene_preset_id", "aspect_ratio", "style_reference_media_id", "three_view", "updated_at"},
		values:  [][]driver.Value{{config.ProjectID, config.TextModelID, config.ImageModelID, config.AudioModelID, config.PromptTemplateID, optionalStringValue(config.CharacterPresetID), optionalStringValue(config.ScenePresetID), config.AspectRatio, config.StyleReferenceMediaID, config.ThreeView, config.UpdatedAt}},
	}, nil
}

func compactGenerationConfigSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

func asOptionalInt64(value driver.Value) *int64 {
	if value == nil {
		return nil
	}
	id := value.(int64)
	return &id
}

func asOptionalString(value driver.Value) *string {
	if value == nil {
		return nil
	}
	text := value.(string)
	return &text
}

func optionalStringValue(value *string) driver.Value {
	if value == nil {
		return nil
	}
	return *value
}

type assetGenerationConfigTestResult struct{ rows int64 }

func (r assetGenerationConfigTestResult) LastInsertId() (int64, error) { return 0, nil }
func (r assetGenerationConfigTestResult) RowsAffected() (int64, error) { return r.rows, nil }

type assetGenerationConfigTestRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *assetGenerationConfigTestRows) Columns() []string { return r.columns }
func (r *assetGenerationConfigTestRows) Close() error      { return nil }
func (r *assetGenerationConfigTestRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
