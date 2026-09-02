package novelfetchworkshop

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestLegacyDocumentSplitPrefersNormalizedOriginal(t *testing.T) {
	document := Document{
		BookID:      "123",
		Meta:        map[string]any{"bookName": "测试小说"},
		Original:    "规范原文",
		OriginalRaw: "原始原文",
		Versions: map[string]any{
			"ai1": "AI1正文",
			"ai3": "AI3正文",
		},
	}

	bodies := legacyBodyRecords(document)
	if len(bodies) != 3 {
		t.Fatalf("bodies=%+v", bodies)
	}
	contents := map[string]string{}
	for _, body := range bodies {
		contents[body.VersionID] = body.Content
	}
	if contents["original"] != "规范原文" || contents["ai1"] != "AI1正文" || contents["ai3"] != "AI3正文" {
		t.Fatalf("contents=%+v", contents)
	}
	if _, exists := contents["originalRaw"]; exists {
		t.Fatal("originalRaw must not become a second body")
	}

	lightweight := lightweightLegacyDocument(document, bodies)
	if lightweight.Original != "" || lightweight.OriginalRaw != "" {
		t.Fatalf("full original text remains: %+v", lightweight)
	}
	for versionID, value := range lightweight.Versions {
		if _, isText := value.(string); isText {
			t.Fatalf("version %s still contains full text: %#v", versionID, value)
		}
	}
}

func TestMySQLStoreMigrateLegacyDocumentBodiesIsIdempotent(t *testing.T) {
	db, mock, store := newBodySQLMock(t)
	ctx := context.Background()
	document := Document{
		BookID:      "123",
		Meta:        map[string]any{"bookName": "测试小说"},
		Original:    "规范原文",
		OriginalRaw: "原始原文",
		Versions: map[string]any{
			"ai1": "AI1正文",
			"ai3": "AI3正文",
		},
		Logs: []any{},
	}
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	migrated := lightweightLegacyDocument(document, legacyBodyRecords(document))
	migratedRaw, err := json.Marshal(migrated)
	if err != nil {
		t.Fatal(err)
	}

	selectSQL := regexp.QuoteMeta(`SELECT document_json FROM novel_fetch_workshop_documents WHERE owner_username=? AND book_id=? FOR UPDATE`)
	insertSQL := regexp.QuoteMeta(`INSERT IGNORE INTO novel_fetch_workshop_bodies(owner_username,book_id,version_id,revision,content_encoding,content_blob,content_hash,char_count,state,created_at,updated_at,last_needed_at,expires_at) VALUES(?,?,?,1,'gzip',?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6),NULL)`)
	updateSQL := regexp.QuoteMeta(`UPDATE novel_fetch_workshop_documents SET document_json=?, updated_at=CURRENT_TIMESTAMP(6) WHERE owner_username=? AND book_id=?`)

	mock.ExpectBegin()
	mock.ExpectQuery(selectSQL).WithArgs("alice", "123").WillReturnRows(sqlmock.NewRows([]string{"document_json"}).AddRow(raw))
	mock.ExpectExec(insertSQL).WithArgs("alice", "123", "original", sqlmock.AnyArg(), sqlmock.AnyArg(), int64(4), "ready").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(insertSQL).WithArgs("alice", "123", "ai1", sqlmock.AnyArg(), sqlmock.AnyArg(), int64(5), "ready").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(insertSQL).WithArgs("alice", "123", "ai3", sqlmock.AnyArg(), sqlmock.AnyArg(), int64(5), "ready").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(updateSQL).WithArgs(sqlmock.AnyArg(), "alice", "123").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := store.MigrateLegacyDocumentBodies(ctx, "alice", "123"); err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(selectSQL).WithArgs("alice", "123").WillReturnRows(sqlmock.NewRows([]string{"document_json"}).AddRow(migratedRaw))
	mock.ExpectCommit()
	if err := store.MigrateLegacyDocumentBodies(ctx, "alice", "123"); err != nil {
		t.Fatal(err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	_ = db
}
