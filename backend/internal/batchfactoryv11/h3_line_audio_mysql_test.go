package batchfactoryv11

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestH3MySQLReloadPreservesLineMeasurements(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT").WithArgs("alice", "batch", "book", "lines").WillReturnRows(sqlmock.NewRows([]string{"id", "hash", "duration", "revision", "source_hash", "created", "details"}).AddRow("m1", "hash", 3240, "r1", "source", time.Now(), `{"method":"per_line_tts_probe","tts_fingerprint":"voice","lines":[{"source_key":"line_0001","source_text_hash":"text","content_hash":"audio","duration_ms":3240}]}`))
	got, err := loadH3AudioMeasurement(context.Background(), db, "alice", "batch", "book", "lines", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Measurement.Method != "per_line_tts_probe" || len(got.Measurement.Lines) != 1 || got.Measurement.Lines[0].DurationMS != 3240 {
		t.Fatalf("lost measured lines: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
