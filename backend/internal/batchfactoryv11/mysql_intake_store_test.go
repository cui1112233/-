package batchfactoryv11

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMySQLCreateIntakeKeepsSameBookIDAcrossPlatforms(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO batch_factory_v11_intakes").
		WithArgs(sqlmock.AnyArg(), "alice", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	store := NewMySQLStore(db)
	intake, err := store.CreateIntake(context.Background(), "alice", NovelFetchIntakeInput{Books: []CreateBookInput{
		{ID: "737092", Title: "甲", Platform: "3"},
		{ID: "737092", Title: "乙", Platform: "15"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var got NovelFetchIntakeInput
	if err := json.Unmarshal(intake.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Books) != 2 {
		t.Fatalf("cross-platform same ID must keep both books, got %d: %+v", len(got.Books), got.Books)
	}
	if got.Books[0].Platform != "3" || got.Books[1].Platform != "15" {
		t.Fatalf("books=%+v", got.Books)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLCreateIntakeDeduplicatesSamePlatformBookID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO batch_factory_v11_intakes").
		WithArgs(sqlmock.AnyArg(), "alice", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	store := NewMySQLStore(db)
	intake, err := store.CreateIntake(context.Background(), "alice", NovelFetchIntakeInput{Books: []CreateBookInput{
		{ID: "737092", Title: "甲", Platform: "3"},
		{ID: "737092", Title: "甲重复行", Platform: "3"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var got NovelFetchIntakeInput
	if err := json.Unmarshal(intake.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Books) != 1 || got.Books[0].Title != "甲" {
		t.Fatalf("same-platform duplicate must collapse to the first row, got %+v", got.Books)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLCreateIntakeBindsJSONPayloadAsText(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// MySQL JSON columns reject a driver-bound []byte value because the driver
	// labels it as _binary. The persisted value must instead be bound as UTF-8
	// text so MySQL can parse it as JSON.
	mock.ExpectExec("INSERT INTO batch_factory_v11_intakes").
		WithArgs(sqlmock.AnyArg(), "alice", `{"books":[]}`, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	store := NewMySQLStore(db)
	if _, err := store.CreateIntake(context.Background(), "alice", NovelFetchIntakeInput{Books: []CreateBookInput{}}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
