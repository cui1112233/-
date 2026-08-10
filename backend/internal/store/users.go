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
}

type Users struct {
	db *sql.DB
}

func NewUsers(db *sql.DB) *Users {
	return &Users{db: db}
}

func (s *Users) EnsureUser(ctx context.Context, username string, passwordHash string) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO users(username, password_hash)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE username = username
`, username, passwordHash)
	return err
}

func (s *Users) FindByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash
FROM users
WHERE username = ?
`, username).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}

func (s *Users) FindByID(ctx context.Context, id int64) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash
FROM users
WHERE id = ?
`, id).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}
