package legacy

import (
	"context"
	"database/sql"
)

func Import(ctx context.Context, db *sql.DB, sourceDir string) error {
	_ = ctx
	_ = db
	_ = sourceDir
	return nil
}
