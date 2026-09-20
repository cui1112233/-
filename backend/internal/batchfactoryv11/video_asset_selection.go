package batchfactoryv11

import (
	"encoding/json"
	"sort"
	"strings"
)

// VideoAssetSelection keeps the Director's automatic recommendations separate
// from a user's additions and exclusions. It is stored only on a VIDEO scope.
// Re-directing can therefore replace AutoAssetIDs without undoing manual work.
type VideoAssetSelection struct {
	AutoAssetIDs     []string `json:"autoAssetIds"`
	AddedAssetIDs    []string `json:"addedAssetIds"`
	ExcludedAssetIDs []string `json:"excludedAssetIds"`
}

const videoAssetSelectionKey = "assetSelection"

func uniqueAssetIDs(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func decodeVideoAssetSelection(patch SettingsPatch) (VideoAssetSelection, bool) {
	raw, exists := patch[videoAssetSelectionKey]
	if !exists || len(raw) == 0 {
		return VideoAssetSelection{}, false
	}
	var selection VideoAssetSelection
	if json.Unmarshal(raw, &selection) != nil {
		return VideoAssetSelection{}, false
	}
	selection.AutoAssetIDs = uniqueAssetIDs(selection.AutoAssetIDs)
	selection.AddedAssetIDs = uniqueAssetIDs(selection.AddedAssetIDs)
	selection.ExcludedAssetIDs = uniqueAssetIDs(selection.ExcludedAssetIDs)
	return selection, true
}

func (selection VideoAssetSelection) effectiveAssetIDSet() map[string]bool {
	selected := map[string]bool{}
	for _, id := range append(append([]string{}, selection.AutoAssetIDs...), selection.AddedAssetIDs...) {
		selected[id] = true
	}
	for _, id := range selection.ExcludedAssetIDs {
		delete(selected, id)
	}
	return selected
}

func reconcileVideoAssetSelection(previous VideoAssetSelection, hadPrevious bool, automaticIDs []string) VideoAssetSelection {
	selection := VideoAssetSelection{AutoAssetIDs: uniqueAssetIDs(automaticIDs)}
	if hadPrevious {
		selection.AddedAssetIDs = uniqueAssetIDs(previous.AddedAssetIDs)
		selection.ExcludedAssetIDs = uniqueAssetIDs(previous.ExcludedAssetIDs)
	}
	return selection
}

func automaticAssetIDsForDirectorVideo(draft DirectorVideo, idsByKindAndName map[string]string) []string {
	ids := make([]string, 0, len(draft.Characters)+len(draft.Props)+1)
	for _, name := range draft.Characters {
		ids = append(ids, idsByKindAndName["character\x00"+strings.TrimSpace(name)])
	}
	if name := strings.TrimSpace(draft.Scene); name != "" {
		ids = append(ids, idsByKindAndName["scene\x00"+name])
	}
	for _, name := range draft.Props {
		ids = append(ids, idsByKindAndName["prop\x00"+strings.TrimSpace(name)])
	}
	return uniqueAssetIDs(ids)
}
