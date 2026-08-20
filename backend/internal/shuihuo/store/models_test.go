package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"strings"
	"sync"
	"testing"

	"qiantie/backend/internal/shuihuo/models"
)

const modelCatalogDriverName = "qiantie-model-catalog-test"

var (
	registerModelCatalogDriver sync.Once
	modelCatalogTestState      *modelCatalogState
)

type modelCatalogState struct {
	queries []string
	execs   []modelCatalogExec
}

type modelCatalogExec struct {
	query string
	args  []driver.NamedValue
}

func TestModelsPreserveModelKeyOnCreateAndReads(t *testing.T) {
	store, state := newModelCatalogTestStore(t)
	ctx := context.Background()

	created, err := store.Create(ctx, 42, models.Definition{
		ModelID:       "video-vidu-admin",
		Name:          "Vidu",
		Kind:          models.KindVideo,
		AdapterKind:   models.AdapterViduImageToVideo,
		CredentialRef: "VIDU_API_KEY",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.ModelID != "video-vidu-admin" {
		t.Fatalf("created modelId = %q, want video-vidu-admin", created.ModelID)
	}

	reads := []struct {
		name string
		read func() ([]models.Definition, error)
	}{
		{"ListEnabled", func() ([]models.Definition, error) { return store.ListEnabled(ctx) }},
		{"ListAll", func() ([]models.Definition, error) { return store.ListAll(ctx) }},
		{"GetEnabled", func() ([]models.Definition, error) {
			model, err := store.GetEnabled(ctx, 7)
			return []models.Definition{model}, err
		}},
		{"GetVersion", func() ([]models.Definition, error) {
			model, err := store.GetVersion(ctx, 7, 8)
			return []models.Definition{model}, err
		}},
	}
	for _, read := range reads {
		t.Run(read.name, func(t *testing.T) {
			items, err := read.read()
			if err != nil {
				t.Fatalf("%s() error = %v", read.name, err)
			}
			if len(items) != 1 || items[0].ModelID != "video-vidu-admin" {
				t.Fatalf("%s() = %#v, want persisted modelId", read.name, items)
			}
		})
	}

	if len(state.execs) == 0 || !strings.Contains(state.execs[0].query, "INSERT INTO model_definitions(model_key,") || state.execs[0].args[0].Value != "video-vidu-admin" {
		t.Fatalf("definition insert = %#v, want model_key with modelId", state.execs)
	}
	for _, query := range state.queries {
		if !strings.Contains(query, "d.model_key") {
			t.Fatalf("model read omitted model_key: %s", query)
		}
	}
}

func newModelCatalogTestStore(t *testing.T) (*Models, *modelCatalogState) {
	t.Helper()
	registerModelCatalogDriver.Do(func() { sql.Register(modelCatalogDriverName, modelCatalogDriver{}) })
	modelCatalogTestState = &modelCatalogState{}
	db, err := sql.Open(modelCatalogDriverName, "")
	if err != nil {
		t.Fatalf("open model catalog test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewModels(db), modelCatalogTestState
}

type modelCatalogDriver struct{}

func (modelCatalogDriver) Open(string) (driver.Conn, error) { return modelCatalogConn{}, nil }

type modelCatalogConn struct{}

func (modelCatalogConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (modelCatalogConn) Close() error                        { return nil }
func (modelCatalogConn) Begin() (driver.Tx, error)           { return modelCatalogTx{}, nil }
func (modelCatalogConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return modelCatalogTx{}, nil
}
func (modelCatalogConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return recordModelCatalogExec(query, args)
}
func (modelCatalogConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	modelCatalogTestState.queries = append(modelCatalogTestState.queries, compactModelCatalogSQL(query))
	return &modelCatalogRows{values: [][]driver.Value{{int64(7), "video-vidu-admin", int64(8), "Vidu", "video", "vidu_image_to_video", false, []byte("[]"), []byte("{}"), "VIDU_API_KEY", "", "", ""}}}, nil
}

type modelCatalogTx struct{}

func (modelCatalogTx) Commit() error   { return nil }
func (modelCatalogTx) Rollback() error { return nil }
func (modelCatalogTx) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return recordModelCatalogExec(query, args)
}

func recordModelCatalogExec(query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactModelCatalogSQL(query)
	modelCatalogTestState.execs = append(modelCatalogTestState.execs, modelCatalogExec{query: query, args: args})
	if strings.Contains(query, "model_definitions") {
		return modelCatalogResult{lastInsertID: 7}, nil
	}
	return modelCatalogResult{lastInsertID: 8}, nil
}

func compactModelCatalogSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type modelCatalogResult struct{ lastInsertID int64 }

func (result modelCatalogResult) LastInsertId() (int64, error) { return result.lastInsertID, nil }
func (modelCatalogResult) RowsAffected() (int64, error)        { return 1, nil }

type modelCatalogRows struct {
	values [][]driver.Value
	index  int
}

func (rows *modelCatalogRows) Columns() []string {
	return []string{"id", "model_key", "version_id", "name", "kind", "adapter_kind", "enabled", "allowed_roles_json", "parameter_schema_json", "credential_ref", "endpoint", "request_template", "response_mapping"}
}
func (rows *modelCatalogRows) Close() error { return nil }
func (rows *modelCatalogRows) Next(dest []driver.Value) error {
	if rows.index >= len(rows.values) {
		return io.EOF
	}
	copy(dest, rows.values[rows.index])
	rows.index++
	return nil
}
