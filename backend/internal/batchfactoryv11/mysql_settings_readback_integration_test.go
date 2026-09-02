package batchfactoryv11_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/storage"
)

func mysqlRawJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestMySQLGetBatchReadsBackSettingsStateForEveryScope(t *testing.T) {
	dsn := os.Getenv("BFV11_MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("BFV11_MYSQL_TEST_DSN is not configured")
	}

	ctx := context.Background()
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	if err := storage.RunMigrations(ctx, db, storage.V11Migrations()); err != nil {
		t.Fatal(err)
	}

	store := batchfactoryv11.NewMySQLStore(db)
	created, err := store.CreateBatch(ctx, "alice", batchfactoryv11.CreateBatchInput{
		Title: "mysql-readback",
		Books: []batchfactoryv11.CreateBookInput{{
			Title: "book",
			Videos: []batchfactoryv11.CreateVideoInput{{Label: "video"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	initial, err := store.GetBatch(ctx, "alice", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if initial.SettingsState.Revision != 1 || len(initial.SettingsState.Patch) != 0 {
		t.Fatalf("initial batch settings=%+v", initial.SettingsState)
	}
	if len(initial.Books) != 1 || initial.Books[0].SettingsState.Revision != 1 || len(initial.Books[0].SettingsState.Patch) != 0 {
		t.Fatalf("initial book settings=%+v", initial.Books)
	}
	if len(initial.Books[0].Videos) != 1 || initial.Books[0].Videos[0].SettingsState.Revision != 1 || len(initial.Books[0].Videos[0].SettingsState.Patch) != 0 {
		t.Fatalf("initial video settings=%+v", initial.Books[0].Videos)
	}

	book := initial.Books[0]
	video := book.Videos[0]
	if _, err := store.SaveSettings(ctx, "alice", batchfactoryv11.ScopeRef{Kind: batchfactoryv11.ScopeBatch, BatchID: initial.ID}, batchfactoryv11.SettingsUpdate{
		Patch: batchfactoryv11.SettingsPatch{"batchFlag": mysqlRawJSON(t, false)}, ExpectedRevision: initial.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveSettings(ctx, "alice", batchfactoryv11.ScopeRef{Kind: batchfactoryv11.ScopeBook, BatchID: initial.ID, BookID: book.ID}, batchfactoryv11.SettingsUpdate{
		Patch: batchfactoryv11.SettingsPatch{"bookText": mysqlRawJSON(t, "")}, ExpectedRevision: book.Revision,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveSettings(ctx, "alice", batchfactoryv11.ScopeRef{Kind: batchfactoryv11.ScopeVideo, BatchID: initial.ID, BookID: book.ID, VideoID: video.ID}, batchfactoryv11.SettingsUpdate{
		Patch: batchfactoryv11.SettingsPatch{"videoNumber": mysqlRawJSON(t, 0)}, ExpectedRevision: video.Revision,
	}); err != nil {
		t.Fatal(err)
	}

	got, err := store.GetBatch(ctx, "alice", initial.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.SettingsState.Revision != 2 || string(got.SettingsState.Patch["batchFlag"]) != "false" {
		t.Fatalf("batch settings=%+v", got.SettingsState)
	}
	if got.Books[0].SettingsState.Revision != 2 || string(got.Books[0].SettingsState.Patch["bookText"]) != `""` {
		t.Fatalf("book settings=%+v", got.Books[0].SettingsState)
	}
	if got.Books[0].Videos[0].SettingsState.Revision != 2 || string(got.Books[0].Videos[0].SettingsState.Patch["videoNumber"]) != "0" {
		t.Fatalf("video settings=%+v", got.Books[0].Videos[0].SettingsState)
	}
}
