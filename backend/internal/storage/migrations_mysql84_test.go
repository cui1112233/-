//go:build mysql84

package storage

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

func TestMySQL84EmptyToLatest(t *testing.T) {
	dsn := os.Getenv("QIANTIE_TEST_MYSQL84_DSN")
	if dsn == "" {
		t.Skip("QIANTIE_TEST_MYSQL84_DSN not configured; run against a disposable MySQL 8.4 database")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := RunMigrations(context.Background(), db, V11Migrations()); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(context.Background(), db, V11Migrations()); err != nil {
		t.Fatalf("repeat startup: %v", err)
	}
}
