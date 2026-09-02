package batchfactoryv11

import (
	"context"
	"encoding/json"
)

func initializeBatchSettingsState(batch Batch) Batch {
	batch.SettingsState = SettingsState{Patch: SettingsPatch{}, Revision: batch.Revision}
	for i := range batch.Books {
		batch.Books[i].SettingsState = SettingsState{Patch: SettingsPatch{}, Revision: batch.Books[i].Revision}
		for j := range batch.Books[i].Videos {
			batch.Books[i].Videos[j].SettingsState = SettingsState{Patch: SettingsPatch{}, Revision: batch.Books[i].Videos[j].Revision}
		}
	}
	return batch
}

func hydrateMySQLBatchSettingsState(ctx context.Context, q batchQueryer, owner string, batch Batch) (Batch, error) {
	batch = initializeBatchSettingsState(batch)
	rows, err := q.QueryContext(ctx, `SELECT scope_type,scope_id,patch_json FROM batch_factory_v11_settings_patches WHERE owner_username=? AND batch_id=?`, owner, batch.ID)
	if err != nil {
		return Batch{}, err
	}
	defer rows.Close()

	patches := map[string]SettingsPatch{}
	for rows.Next() {
		var scopeType, scopeID string
		var encoded []byte
		if err := rows.Scan(&scopeType, &scopeID, &encoded); err != nil {
			return Batch{}, err
		}
		patch := SettingsPatch{}
		if err := json.Unmarshal(encoded, &patch); err != nil {
			return Batch{}, err
		}
		patches[scopeType+":"+scopeID] = patch
	}
	if err := rows.Err(); err != nil {
		return Batch{}, err
	}

	if patch, ok := patches[string(ScopeBatch)+":"+batch.ID]; ok {
		batch.SettingsState.Patch = patch
	}
	for i := range batch.Books {
		book := &batch.Books[i]
		if patch, ok := patches[string(ScopeBook)+":"+book.ID]; ok {
			book.SettingsState.Patch = patch
		}
		for j := range book.Videos {
			video := &book.Videos[j]
			if patch, ok := patches[string(ScopeVideo)+":"+video.ID]; ok {
				video.SettingsState.Patch = patch
			}
		}
	}
	return batch, nil
}
