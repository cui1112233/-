package batchfactoryv11

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Only the roster is rewritten; preserving raw card JSON keeps missing-field
// validation (especially explicit empty character arrays) authoritative.
func bindH3DirectorAssets(raw json.RawMessage, assets []BookAsset) (json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	var schema string
	_ = json.Unmarshal(root["schema_version"], &schema)
	if schema != h3DirectorSchemaV1 {
		return raw, nil
	}
	var roster []H3Character
	if err := json.Unmarshal(root["character_roster"], &roster); err != nil {
		return nil, err
	}
	used := map[string]bool{}
	for i := range roster {
		c := &roster[i]
		matches := []BookAsset{}
		for _, a := range assets {
			if a.Kind != "character" {
				continue
			}
			if (c.AssetID != "" && a.ID == c.AssetID) || (c.AssetID == "" && a.Name == c.CanonicalName) {
				matches = append(matches, a)
			}
		}
		if len(matches) != 1 || matches[0].ID == "" || strings.TrimSpace(matches[0].Prompt) == "" {
			return nil, fmt.Errorf("%w: 人物 %s 缺少唯一可用资产，请先获取或修正人物资产", ErrInvalid, c.CanonicalName)
		}
		a := matches[0]
		if used[a.ID] {
			return nil, fmt.Errorf("%w: 同一人物资产被重复建立人物槽位", ErrInvalid)
		}
		used[a.ID] = true
		if c.CanonicalName != a.Name {
			c.Aliases = append(c.Aliases, c.CanonicalName)
		}
		c.AssetID, c.AssetRevision, c.CanonicalName, c.Appearance = a.ID, a.Revision, a.Name, a.Prompt
	}
	value, err := json.Marshal(roster)
	if err != nil {
		return nil, err
	}
	root["character_roster"] = value
	return json.Marshal(root)
}

func h3AnalysisFromBook(document H3DirectorDocument, book Book) (H3AnalysisSnapshot, error) {
	analysis := h3AnalysisFromDirector(document)
	for _, c := range document.CharacterRoster {
		// Existing unbound documents remain readable using their historical snapshot.
		// All new director runs bind an asset ID before persistence.
		if c.AssetID == "" {
			continue
		}
		found := false
		for _, a := range book.AssetRecords {
			if a.ID != c.AssetID || a.Kind != "character" {
				continue
			}
			if strings.TrimSpace(a.Prompt) == "" {
				return H3AnalysisSnapshot{}, fmt.Errorf("%w: 人物资产外形为空", ErrInvalid)
			}
			analysis.CharacterSettings[c.SlotID] = a.Prompt
			found = true
			break
		}
		if !found {
			return H3AnalysisSnapshot{}, fmt.Errorf("%w: 人物资产 %s 已不存在", ErrConflict, c.AssetID)
		}
	}
	return analysis, nil
}
