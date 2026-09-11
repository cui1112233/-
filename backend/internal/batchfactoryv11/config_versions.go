package batchfactoryv11

import (
	"encoding/json"
	"strings"
)

// VersionConfigIDKey is the Go-owned canonical sparse settings key used to
// select a ConfigVersion by its stable catalog ID at Batch scope.
const VersionConfigIDKey = "versionConfigId"

func configVersionIDFromUpdate(ref ScopeRef, update SettingsUpdate) (string, bool, error) {
	raw, patched := update.Patch[VersionConfigIDKey]
	restored := false
	for _, key := range update.RestoreKeys {
		if key == VersionConfigIDKey {
			restored = true
			break
		}
	}
	if !patched && !restored {
		return "", false, nil
	}
	if ref.Kind != ScopeBatch {
		return "", false, ErrInvalid
	}
	if !patched {
		return "", false, nil
	}
	var id string
	if err := json.Unmarshal(raw, &id); err != nil {
		return "", false, ErrInvalid
	}
	if id == "" || id != strings.TrimSpace(id) {
		return "", false, ErrInvalid
	}
	return id, true, nil
}
