package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type Migration struct {
	Version          int
	SQL              []string
	CallbackChecksum string
}

type MigrationLedger interface {
	RecordedChecksum(context.Context, int) (string, bool, error)
	Record(context.Context, int, string) error
}

var whitespace = regexp.MustCompile(`\s+`)

func canonicalSQL(statements []string) string {
	normalized := make([]string, 0, len(statements))
	for _, statement := range statements {
		normalized = append(normalized, strings.TrimSpace(whitespace.ReplaceAllString(statement, " ")))
	}
	return strings.Join(normalized, "\n")
}

func checksumFor(m Migration) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("v=%d\nsql=%s\ncallback=%s", m.Version, canonicalSQL(m.SQL), m.CallbackChecksum)))
	return hex.EncodeToString(sum[:])
}

func ChecksumFor(m Migration) string { return checksumFor(m) }

func RunMigrationPlan(ctx context.Context, ledger MigrationLedger, migrations []Migration, apply func(context.Context, Migration) error) error {
	ordered := append([]Migration(nil), migrations...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Version < ordered[j].Version })
	last := -1
	for _, migration := range ordered {
		if migration.Version <= last {
			return fmt.Errorf("migration versions must be strictly increasing: %d", migration.Version)
		}
		last = migration.Version
		expected := checksumFor(migration)
		recorded, exists, err := ledger.RecordedChecksum(ctx, migration.Version)
		if err != nil {
			return err
		}
		if exists {
			if recorded != expected {
				return fmt.Errorf("migration %d checksum mismatch: recorded=%s expected=%s", migration.Version, recorded, expected)
			}
			continue
		}
		if err := apply(ctx, migration); err != nil {
			return fmt.Errorf("apply migration %d: %w", migration.Version, err)
		}
		if err := ledger.Record(ctx, migration.Version, expected); err != nil {
			return fmt.Errorf("record migration %d: %w", migration.Version, err)
		}
	}
	return nil
}

func RunMigrations(ctx context.Context, db *sql.DB, migrations []Migration) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version BIGINT NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(6) NOT NULL) ENGINE=InnoDB`); err != nil {
		return fmt.Errorf("create migration ledger: %w", err)
	}
	ordered := append([]Migration(nil), migrations...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Version < ordered[j].Version })
	for _, migration := range ordered {
		expected := checksumFor(migration)
		var recorded string
		err := db.QueryRowContext(ctx, `SELECT checksum FROM schema_migrations WHERE version = ?`, migration.Version).Scan(&recorded)
		if err == nil {
			if recorded != expected {
				return fmt.Errorf("migration %d checksum mismatch: recorded=%s expected=%s", migration.Version, recorded, expected)
			}
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("read migration %d: %w", migration.Version, err)
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		for _, statement := range migration.SQL {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("apply migration %d: %w", migration.Version, err)
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP(6))`, migration.Version, expected); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
