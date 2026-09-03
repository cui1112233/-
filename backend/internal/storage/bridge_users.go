package storage

import (
	"context"
	"database/sql"
)

type BridgeUsers struct{ DB *sql.DB }

func (s BridgeUsers) ResolveBridgeUser(ctx context.Context, username string, isOwner bool) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO batch_factory_v11_bridge_users(username,is_owner,created_at,updated_at) VALUES(?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE is_owner=VALUES(is_owner), updated_at=CURRENT_TIMESTAMP(6)`, username, isOwner)
	return err
}
