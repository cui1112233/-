package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"sync"
	"testing"
)

func TestVideoAPIConfigConfiguredRequiresYDProviderAndCiphertext(t *testing.T) {
	cases := []struct {
		name string
		cfg  VideoAPIConfig
		want bool
	}{
		{name: "configured", cfg: VideoAPIConfig{Provider: YDVideoProvider, APIKeyCiphertext: "v1:ciphertext"}, want: true},
		{name: "missing ciphertext", cfg: VideoAPIConfig{Provider: YDVideoProvider}, want: false},
		{name: "wrong provider", cfg: VideoAPIConfig{Provider: "other", APIKeyCiphertext: "v1:ciphertext"}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.Configured(); got != tc.want {
				t.Fatalf("Configured() = %v, want %v", got, tc.want)
			}
		})
	}
}

const videoConfigTestDriverName = "qiantie-video-config-test"

var (
	registerVideoConfigTestDriver sync.Once
	videoConfigTestState          *videoConfigDBState
)

type videoConfigDBState struct {
	configs map[int64]VideoAPIConfig
}

func TestVideoConfigsScopesPersistedCiphertextsByUser(t *testing.T) {
	configs := newVideoConfigTestStore(t, &videoConfigDBState{configs: map[int64]VideoAPIConfig{}})
	first := VideoAPIConfig{Provider: YDVideoProvider, APIKeyCiphertext: "v1:first-ciphertext"}
	second := VideoAPIConfig{Provider: YDVideoProvider, APIKeyCiphertext: "v1:second-ciphertext"}

	if err := configs.Save(context.Background(), 101, first); err != nil {
		t.Fatalf("Save first user: %v", err)
	}
	if err := configs.Save(context.Background(), 202, second); err != nil {
		t.Fatalf("Save second user: %v", err)
	}
	gotFirst, err := configs.Get(context.Background(), 101)
	if err != nil {
		t.Fatalf("Get first user: %v", err)
	}
	gotSecond, err := configs.Get(context.Background(), 202)
	if err != nil {
		t.Fatalf("Get second user: %v", err)
	}
	if gotFirst != first || gotSecond != second {
		t.Fatalf("scoped configurations = first:%#v second:%#v", gotFirst, gotSecond)
	}
	missing, err := configs.Get(context.Background(), 303)
	if err != nil {
		t.Fatalf("Get missing user: %v", err)
	}
	if missing.Provider != YDVideoProvider || missing.APIKeyCiphertext != "" {
		t.Fatalf("missing user config = %#v", missing)
	}
}

func newVideoConfigTestStore(t *testing.T, state *videoConfigDBState) *VideoConfigs {
	t.Helper()
	registerVideoConfigTestDriver.Do(func() { sql.Register(videoConfigTestDriverName, videoConfigTestDriver{}) })
	videoConfigTestState = state
	db, err := sql.Open(videoConfigTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewVideoConfigs(db)
}

type videoConfigTestDriver struct{}

func (videoConfigTestDriver) Open(string) (driver.Conn, error) { return videoConfigTestConn{}, nil }

type videoConfigTestConn struct{}

func (videoConfigTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (videoConfigTestConn) Close() error                        { return nil }
func (videoConfigTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }
func (videoConfigTestConn) ExecContext(_ context.Context, _ string, args []driver.NamedValue) (driver.Result, error) {
	userID := args[0].Value.(int64)
	videoConfigTestState.configs[userID] = VideoAPIConfig{
		Provider:         args[1].Value.(string),
		APIKeyCiphertext: args[2].Value.(string),
	}
	return driver.RowsAffected(1), nil
}
func (videoConfigTestConn) QueryContext(_ context.Context, _ string, args []driver.NamedValue) (driver.Rows, error) {
	return &videoConfigTestRows{config: videoConfigTestState.configs[args[0].Value.(int64)]}, nil
}

type videoConfigTestRows struct {
	config   VideoAPIConfig
	returned bool
}

func (r *videoConfigTestRows) Columns() []string { return []string{"provider", "api_key_ciphertext"} }
func (r *videoConfigTestRows) Close() error      { return nil }
func (r *videoConfigTestRows) Next(dest []driver.Value) error {
	if r.returned || r.config.Provider == "" {
		return io.EOF
	}
	dest[0], dest[1] = r.config.Provider, r.config.APIKeyCiphertext
	r.returned = true
	return nil
}
