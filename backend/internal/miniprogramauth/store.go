package miniprogramauth

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type store struct{ db *sql.DB }

func (s *store) identityUsername(ctx context.Context, identityHash string) (string, bool, error) {
	var username string
	err := s.db.QueryRowContext(ctx, `SELECT username FROM wechat_miniprogram_identities WHERE identity_hash=?`, identityHash).Scan(&username)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return username, err == nil, err
}

func (s *store) createTicket(ctx context.Context, tokenHash, identityHash string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO wechat_miniprogram_binding_tickets(token_hash,identity_hash,expires_at,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP(6))`, tokenHash, identityHash, expiresAt)
	return err
}

func (s *store) bindIdentity(ctx context.Context, ticketHash, username string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var identityHash string
	err = tx.QueryRowContext(ctx, `SELECT identity_hash FROM wechat_miniprogram_binding_tickets WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP(6) FOR UPDATE`, ticketHash).Scan(&identityHash)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidTicket
	}
	if err != nil {
		return err
	}
	var boundUsername string
	err = tx.QueryRowContext(ctx, `SELECT username FROM wechat_miniprogram_identities WHERE identity_hash=? FOR UPDATE`, identityHash).Scan(&boundUsername)
	if err == nil && boundUsername != username {
		return ErrIdentityAlreadyBound
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wechat_miniprogram_identities(identity_hash,username,created_at,updated_at) VALUES(?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE username=VALUES(username),updated_at=CURRENT_TIMESTAMP(6)`, identityHash, username); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM wechat_miniprogram_binding_tickets WHERE token_hash=?`, ticketHash); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *store) createSession(ctx context.Context, tokenHash, username string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO wechat_miniprogram_sessions(token_hash,username,expires_at,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP(6))`, tokenHash, username, expiresAt)
	return err
}

func (s *store) sessionUsername(ctx context.Context, tokenHash string, now time.Time) (string, bool, error) {
	var username string
	err := s.db.QueryRowContext(ctx, `SELECT username FROM wechat_miniprogram_sessions WHERE token_hash=? AND expires_at>?`, tokenHash, now).Scan(&username)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return username, err == nil, err
}
