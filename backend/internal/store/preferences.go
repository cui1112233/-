package store

import (
	"context"
	"database/sql"
	"errors"

	"qiantie/backend/internal/pet"
)

type Preferences struct {
	db *sql.DB
}

func NewPreferences(db *sql.DB) *Preferences {
	return &Preferences{db: db}
}

func (s *Preferences) GetPet(ctx context.Context, userID int64) (string, error) {
	var petID string
	err := s.db.QueryRowContext(ctx, `
SELECT pet_id
FROM user_preferences
WHERE user_id = ?
`, userID).Scan(&petID)
	if errors.Is(err, sql.ErrNoRows) {
		return pet.DefaultID, nil
	}
	if err != nil {
		return "", err
	}
	return pet.NormalizeID(petID, pet.DefaultID), nil
}

func (s *Preferences) SavePet(ctx context.Context, userID int64, petID string) error {
	petID = pet.NormalizeID(petID, pet.DefaultID)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO user_preferences(user_id, pet_id)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE
  pet_id = VALUES(pet_id)
`, userID, petID)
	return err
}
