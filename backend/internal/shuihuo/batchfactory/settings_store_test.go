package batchfactory

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
)

func TestSettingsStoreUpsertsAndLoadsAllScopes(t *testing.T) {
	db := newBatchFactorySettingsStoreTestDB(t)
	store := NewSettingsStore(db)
	ctx := context.Background()

	if err := store.SaveBatch(ctx, 7, "batch_1", Settings{"aspectRatio": "16:9", "videoModelId": 18}); err != nil {
		t.Fatalf("save batch: %v", err)
	}
	if err := store.SaveItemOverride(ctx, 7, "batch_1", "opening_1", Settings{"quality": "4K", "qualityEnabled": false}); err != nil {
		t.Fatalf("save item override: %v", err)
	}
	if err := store.SaveVideoOverride(ctx, 7, "batch_1", "opening_1", "3", Settings{"restriction": "禁止水印"}); err != nil {
		t.Fatalf("save video override: %v", err)
	}

	state, err := store.LoadBatchState(ctx, 7, "batch_1")
	if err != nil {
		t.Fatalf("load state: %v", err)
	}
	if state.Batch["aspectRatio"] != "16:9" || state.Batch["videoModelId"] != float64(18) {
		t.Fatalf("batch = %#v", state.Batch)
	}
	if got := state.Items["opening_1"]; got["quality"] != "4K" || got["qualityEnabled"] != false {
		t.Fatalf("item override = %#v", got)
	}
	if got := state.Videos["opening_1"]["3"]; got["restriction"] != "禁止水印" {
		t.Fatalf("video override = %#v", got)
	}
}

func TestSettingsStoreDeletesEmptyOverrides(t *testing.T) {
	db := newBatchFactorySettingsStoreTestDB(t)
	store := NewSettingsStore(db)
	ctx := context.Background()

	if err := store.SaveItemOverride(ctx, 7, "batch_1", "opening_1", Settings{"quality": "4K"}); err != nil {
		t.Fatalf("seed item: %v", err)
	}
	if err := store.SaveVideoOverride(ctx, 7, "batch_1", "opening_1", "3", Settings{"quality": "8K"}); err != nil {
		t.Fatalf("seed video: %v", err)
	}
	if err := store.SaveItemOverride(ctx, 7, "batch_1", "opening_1", Settings{}); err != nil {
		t.Fatalf("delete item override: %v", err)
	}
	if err := store.SaveVideoOverride(ctx, 7, "batch_1", "opening_1", "3", Settings{}); err != nil {
		t.Fatalf("delete video override: %v", err)
	}

	state, err := store.LoadBatchState(ctx, 7, "batch_1")
	if err != nil {
		t.Fatalf("load state: %v", err)
	}
	if _, ok := state.Items["opening_1"]; ok {
		t.Fatalf("item override should be deleted: %#v", state.Items)
	}
	if _, ok := state.Videos["opening_1"]; ok {
		t.Fatalf("video override should be deleted: %#v", state.Videos)
	}
}

func TestBootstrapBatchStateRollsBackPartialLegacyImport(t *testing.T) {
	db := newBatchFactorySettingsStoreTestDB(t)
	store := NewSettingsStore(db)
	batchFactorySettingsStoreFailScope = settingsScopeVideo

	_, err := store.BootstrapBatchState(context.Background(), 7, "batch_1", PersistedSettingsState{
		Batch: Settings{"aspectRatio": "9:16", "videoModelId": 18},
		Items: map[string]Settings{
			"opening_1": {"quality": "4K"},
		},
		Videos: map[string]map[string]Settings{
			"opening_1": {"1": {"restriction": "禁止水印"}},
		},
	})
	if err == nil {
		t.Fatal("bootstrap should fail on injected VIDEO write")
	}
	if batchFactorySettingsStoreBeginCount != 1 {
		t.Fatalf("bootstrap must use one SQL transaction, begin count = %d", batchFactorySettingsStoreBeginCount)
	}
	if len(batchFactorySettingsStoreState) != 0 {
		t.Fatalf("failed bootstrap must roll back all partial rows: %#v", batchFactorySettingsStoreState)
	}
}

const batchFactorySettingsStoreDriverName = "qiantie-batch-factory-settings-store-test"

var (
	registerBatchFactorySettingsStoreDriver sync.Once
	batchFactorySettingsStoreState          map[string][]byte
	batchFactorySettingsStoreTxState        map[string][]byte
	batchFactorySettingsStoreInTx           bool
	batchFactorySettingsStoreBeginCount     int
	batchFactorySettingsStoreFailScope      string
)

func cloneSettingsStoreState(source map[string][]byte) map[string][]byte {
	out := make(map[string][]byte, len(source))
	for key, raw := range source {
		out[key] = append([]byte(nil), raw...)
	}
	return out
}

func currentSettingsStoreState() map[string][]byte {
	if batchFactorySettingsStoreInTx {
		return batchFactorySettingsStoreTxState
	}
	return batchFactorySettingsStoreState
}

func newBatchFactorySettingsStoreTestDB(t *testing.T) *sql.DB {
	t.Helper()
	registerBatchFactorySettingsStoreDriver.Do(func() { sql.Register(batchFactorySettingsStoreDriverName, batchFactorySettingsStoreDriver{}) })
	batchFactorySettingsStoreState = map[string][]byte{}
	batchFactorySettingsStoreTxState = nil
	batchFactorySettingsStoreInTx = false
	batchFactorySettingsStoreBeginCount = 0
	batchFactorySettingsStoreFailScope = ""
	db, err := sql.Open(batchFactorySettingsStoreDriverName, "")
	if err != nil {
		t.Fatalf("open store test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

type batchFactorySettingsStoreDriver struct{}

func (batchFactorySettingsStoreDriver) Open(string) (driver.Conn, error) { return batchFactorySettingsStoreConn{}, nil }

type batchFactorySettingsStoreConn struct{}

func (batchFactorySettingsStoreConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (batchFactorySettingsStoreConn) Close() error                        { return nil }
func (batchFactorySettingsStoreConn) Begin() (driver.Tx, error) {
	batchFactorySettingsStoreBeginCount++
	batchFactorySettingsStoreInTx = true
	batchFactorySettingsStoreTxState = cloneSettingsStoreState(batchFactorySettingsStoreState)
	return batchFactorySettingsStoreTx{}, nil
}

type batchFactorySettingsStoreTx struct{}

func (batchFactorySettingsStoreTx) Commit() error {
	batchFactorySettingsStoreState = cloneSettingsStoreState(batchFactorySettingsStoreTxState)
	batchFactorySettingsStoreTxState = nil
	batchFactorySettingsStoreInTx = false
	return nil
}

func (batchFactorySettingsStoreTx) Rollback() error {
	batchFactorySettingsStoreTxState = nil
	batchFactorySettingsStoreInTx = false
	return nil
}

func (batchFactorySettingsStoreConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	compact := strings.Join(strings.Fields(query), " ")
	state := currentSettingsStoreState()
	if strings.HasPrefix(compact, "INSERT INTO shuihuo_batch_factory_settings") {
		if len(args) != 6 {
			return nil, fmt.Errorf("unexpected upsert args: %#v", args)
		}
		if batchFactorySettingsStoreFailScope != "" && fmt.Sprint(args[2].Value) == batchFactorySettingsStoreFailScope {
			return nil, fmt.Errorf("injected %s write failure", batchFactorySettingsStoreFailScope)
		}
		key := batchFactorySettingsStoreKey(args[0].Value, args[1].Value, args[2].Value, args[3].Value, args[4].Value)
		raw, ok := args[5].Value.([]byte)
		if !ok {
			if text, textOK := args[5].Value.(string); textOK {
				raw = []byte(text)
			} else {
				return nil, fmt.Errorf("unexpected json arg: %#v", args[5].Value)
			}
		}
		state[key] = append([]byte(nil), raw...)
		return driver.RowsAffected(1), nil
	}
	if strings.HasPrefix(compact, "DELETE FROM shuihuo_batch_factory_settings") {
		if len(args) != 5 {
			return nil, fmt.Errorf("unexpected delete args: %#v", args)
		}
		key := batchFactorySettingsStoreKey(args[0].Value, args[1].Value, args[2].Value, args[3].Value, args[4].Value)
		delete(state, key)
		return driver.RowsAffected(1), nil
	}
	return nil, fmt.Errorf("unexpected settings store exec: %s", compact)
}

func (batchFactorySettingsStoreConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	compact := strings.Join(strings.Fields(query), " ")
	if !strings.Contains(compact, "FROM shuihuo_batch_factory_settings") || len(args) != 2 {
		return nil, fmt.Errorf("unexpected settings store query: %s %#v", compact, args)
	}
	userID := fmt.Sprint(args[0].Value)
	batchID := fmt.Sprint(args[1].Value)
	rows := &batchFactorySettingsStoreRows{columns: []string{"scope", "item_id", "video_id", "settings_json"}}
	for key, raw := range currentSettingsStoreState() {
		parts := strings.SplitN(key, "|", 5)
		if len(parts) != 5 || parts[0] != userID || parts[1] != batchID {
			continue
		}
		var checked any
		if err := json.Unmarshal(raw, &checked); err != nil {
			return nil, err
		}
		rows.values = append(rows.values, []driver.Value{parts[2], parts[3], parts[4], raw})
	}
	return rows, nil
}

func batchFactorySettingsStoreKey(values ...any) string {
	parts := make([]string, len(values))
	for i, value := range values {
		parts[i] = fmt.Sprint(value)
	}
	return strings.Join(parts, "|")
}

type batchFactorySettingsStoreRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *batchFactorySettingsStoreRows) Columns() []string { return r.columns }
func (r *batchFactorySettingsStoreRows) Close() error      { return nil }
func (r *batchFactorySettingsStoreRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
