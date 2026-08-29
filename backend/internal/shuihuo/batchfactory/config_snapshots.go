package batchfactory

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type PresetVersion struct {
	ID           string         `json:"id"`
	Module       string         `json:"module"`
	Name         string         `json:"name"`
	Version      int            `json:"version"`
	Status       string         `json:"status"`
	Body         string         `json:"body"`
	PublishedAt  string         `json:"publishedAt"`
	ProtocolLock map[string]any `json:"protocolLock,omitempty"`
}

type ConfigSnapshot struct {
	Revision       string         `json:"revision"`
	Label          string         `json:"label"`
	PublishedAt    string         `json:"publishedAt"`
	PresetVersions map[string]int `json:"presetVersions"`
}

type ConfigSnapshotCatalog struct {
	Latest   *ConfigSnapshot  `json:"latest"`
	Versions []ConfigSnapshot `json:"versions"`
}

type presetPublishEvent struct {
	PresetVersion
	publishedTime time.Time
}

func ResolveConfigSnapshots(rows []PresetVersion) ConfigSnapshotCatalog {
	catalog := ConfigSnapshotCatalog{Versions: []ConfigSnapshot{}}
	filtered := batchFactoryPresetRows(rows)
	current := make([]PresetVersion, 0)
	for _, row := range filtered {
		if row.Status == "published" && row.Version > 0 && strings.TrimSpace(row.ID) != "" {
			current = append(current, row)
		}
	}
	if len(current) == 0 {
		return catalog
	}
	sort.Slice(current, func(i, j int) bool { return current[i].ID < current[j].ID })

	required := make(map[string]struct{}, len(current))
	for _, row := range current {
		required[row.ID] = struct{}{}
	}

	events := make([]presetPublishEvent, 0, len(filtered))
	for _, row := range filtered {
		if _, ok := required[row.ID]; !ok || row.Version < 1 {
			continue
		}
		publishedAt, ok := parsePublishedAt(row.PublishedAt)
		if !ok {
			continue
		}
		events = append(events, presetPublishEvent{PresetVersion: row, publishedTime: publishedAt})
	}
	sort.Slice(events, func(i, j int) bool {
		if !events[i].publishedTime.Equal(events[j].publishedTime) {
			return events[i].publishedTime.Before(events[j].publishedTime)
		}
		if events[i].ID != events[j].ID {
			return events[i].ID < events[j].ID
		}
		return events[i].Version < events[j].Version
	})

	state := map[string]int{}
	seen := map[string]struct{}{}
	for _, event := range events {
		state[event.ID] = event.Version
		if !hasAllRequiredPins(state, required) {
			continue
		}
		snapshot := configSnapshotFromPins(state, event.PublishedAt)
		if snapshot.Revision == "" {
			continue
		}
		if _, exists := seen[snapshot.Revision]; exists {
			continue
		}
		seen[snapshot.Revision] = struct{}{}
		catalog.Versions = append(catalog.Versions, snapshot)
	}

	currentPins := make(map[string]int, len(current))
	publishedTimes := make([]string, 0, len(current))
	for _, row := range current {
		currentPins[row.ID] = row.Version
		if strings.TrimSpace(row.PublishedAt) != "" {
			publishedTimes = append(publishedTimes, row.PublishedAt)
		}
	}
	sort.Strings(publishedTimes)
	currentPublishedAt := ""
	if len(publishedTimes) > 0 {
		currentPublishedAt = publishedTimes[len(publishedTimes)-1]
	}
	currentSnapshot := configSnapshotFromPins(currentPins, currentPublishedAt)
	if currentSnapshot.Revision != "" {
		if _, exists := seen[currentSnapshot.Revision]; !exists {
			catalog.Versions = append(catalog.Versions, currentSnapshot)
			seen[currentSnapshot.Revision] = struct{}{}
		}
	}

	for index := range catalog.Versions {
		catalog.Versions[index].Label = fmt.Sprintf("配置 v%d", index+1)
		if catalog.Versions[index].Revision == currentSnapshot.Revision {
			copy := catalog.Versions[index]
			catalog.Latest = &copy
		}
	}
	return catalog
}

func ResolveVersionedPreset(rows []PresetVersion, id string, version int) (PresetVersion, bool) {
	presetID := strings.TrimSpace(id)
	if presetID == "" {
		return PresetVersion{}, false
	}
	filtered := batchFactoryPresetRows(rows)
	if version > 0 {
		for _, row := range filtered {
			if row.ID == presetID && row.Version == version && strings.TrimSpace(row.Body) != "" {
				row.Body = strings.TrimSpace(row.Body)
				return row, true
			}
		}
	}
	for _, row := range filtered {
		if row.ID == presetID && row.Status == "published" && row.Version > 0 && strings.TrimSpace(row.Body) != "" {
			row.Body = strings.TrimSpace(row.Body)
			return row, true
		}
	}
	return PresetVersion{}, false
}

func batchFactoryPresetRows(rows []PresetVersion) []PresetVersion {
	filtered := make([]PresetVersion, 0, len(rows))
	for _, row := range rows {
		row.ID = strings.TrimSpace(row.ID)
		row.Module = strings.TrimSpace(row.Module)
		row.Name = strings.TrimSpace(row.Name)
		row.Status = strings.TrimSpace(row.Status)
		if row.Module != "batch-factory" || row.ID == "" || row.Version < 1 {
			continue
		}
		filtered = append(filtered, row)
	}
	return filtered
}

func parsePublishedAt(value string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	return parsed, err == nil
}

func hasAllRequiredPins(state map[string]int, required map[string]struct{}) bool {
	for id := range required {
		if state[id] < 1 {
			return false
		}
	}
	return true
}

func configSnapshotFromPins(pins map[string]int, publishedAt string) ConfigSnapshot {
	stable := stablePresetPins(pins)
	return ConfigSnapshot{
		Revision:       configRevision(stable),
		PublishedAt:    strings.TrimSpace(publishedAt),
		PresetVersions: stable,
	}
}

func stablePresetPins(pins map[string]int) map[string]int {
	stable := map[string]int{}
	for id, version := range pins {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" && version > 0 {
			stable[trimmed] = version
		}
	}
	return stable
}

func configRevision(pins map[string]int) string {
	ids := make([]string, 0, len(pins))
	for id, version := range pins {
		if strings.TrimSpace(id) != "" && version > 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	sort.Strings(ids)
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, id+"@"+strconv.Itoa(pins[id]))
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])[:12]
}
