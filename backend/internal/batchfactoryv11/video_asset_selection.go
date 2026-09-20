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

func automaticAssetIDsForH3Segment(document H3DirectorDocument, segment H3VideoSegment, idsByKindAndName map[string]string) []string {
	roster := make(map[string]H3Character, len(document.CharacterRoster))
	for _, character := range document.CharacterRoster {
		roster[character.SlotID] = character
	}
	cardByIndex := make(map[int]H3DirectorCard, len(document.DirectorCards))
	for _, card := range document.DirectorCards {
		cardByIndex[card.SourceIndex] = card
	}
	ids := []string{}
	for _, slice := range segment.SourceSlices {
		card, exists := cardByIndex[slice.SourceIndex]
		if !exists || card.SourceKey != slice.SourceKey {
			continue
		}
		slotIDs := append([]string(nil), card.CharacterSlotIDs...)
		for _, shot := range card.MicroShots {
			slotIDs = append(slotIDs, shot.CharacterSlotIDs...)
		}
		for _, slotID := range uniqueAssetIDs(slotIDs) {
			character, exists := roster[slotID]
			if !exists {
				continue
			}
			names := append([]string{character.CanonicalName}, character.Aliases...)
			if character.AssetID != "" {
				for key, id := range idsByKindAndName {
					if strings.HasPrefix(key, "character\x00") && id == character.AssetID {
						ids = append(ids, id)
						break
					}
				}
				continue
			}
			for _, name := range names {
				if id := idsByKindAndName["character\x00"+strings.TrimSpace(name)]; id != "" {
					ids = append(ids, id)
					break
				}
			}
		}
		if name := strings.TrimSpace(card.Continuity.Location); name != "" {
			ids = append(ids, idsByKindAndName["scene\x00"+name])
		}
		for _, rawNames := range card.Continuity.HeldProps {
			for _, name := range h3HeldPropNames(rawNames) {
				if name = strings.TrimSpace(name); name != "" {
					ids = append(ids, idsByKindAndName["prop\x00"+name])
				}
			}
		}
	}
	return uniqueAssetIDs(ids)
}

func h3HeldPropNames(raw json.RawMessage) []string {
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return []string{value}
	}
	return nil
}
