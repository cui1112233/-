package store

import (
	"context"
	"database/sql"
	"errors"
)

type User struct {
	ID           int64
	Username     string
	PasswordHash string
	IsOwner      bool
	IsActive     bool
}

type Users struct {
	db *sql.DB
}

func NewUsers(db *sql.DB) *Users {
	return &Users{db: db}
}

func (s *Users) EnsureSeedOwner(ctx context.Context, username string, passwordHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
INSERT INTO users(username, password_hash, is_owner, is_active)
VALUES(?, ?, TRUE, TRUE)
ON DUPLICATE KEY UPDATE username = username
`, username, passwordHash); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
INSERT IGNORE INTO app_initializations(initialization_key)
VALUES(?)
`, "seed-owner:"+username)
	if err != nil {
		return err
	}
	initialized, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if initialized == 1 {
		if _, err := tx.ExecContext(ctx, `
UPDATE users
SET is_owner = TRUE
WHERE username = ?
`, username); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// EnsureBridgeUser creates the platform account in the Go database on its
// first water-production request. Authentication remains owned by Node; this
// record exists only to establish MySQL ownership and foreign-key relations.
func (s *Users) EnsureBridgeUser(ctx context.Context, username string, isOwner bool) (User, error) {
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO users(username, password_hash, is_owner, is_active)
VALUES(?, 'bridge-managed-account', ?, TRUE)
ON DUPLICATE KEY UPDATE
  is_owner = VALUES(is_owner),
  is_active = TRUE
`, username, isOwner); err != nil {
		return User{}, err
	}
	return s.FindByUsername(ctx, username)
}

func (s *Users) FindByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash, is_owner, is_active
FROM users
WHERE username = ?
`, username).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsOwner, &u.IsActive)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}

func (s *Users) FindByID(ctx context.Context, id int64) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash, is_owner, is_active
FROM users
WHERE id = ?
`, id).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsOwner, &u.IsActive)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}
