package assets

import (
	"fmt"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

func NormalizeCategory(category string) (string, error) {
	category = strings.ToLower(strings.TrimSpace(category))
	switch category {
	case "character", "scene", "prop":
		return category, nil
	default:
		return "", fmt.Errorf("unsupported asset category %q", category)
	}
}

func MergeAssetCandidates(existing, candidates []domain.Asset, overwriteManual bool) []domain.Asset {
	merged := append([]domain.Asset(nil), existing...)
	byName := make(map[string]int, len(merged))
	for index, asset := range merged {
		byName[assetKey(asset)] = index
	}
	for _, candidate := range candidates {
		key := assetKey(candidate)
		if index, ok := byName[key]; ok {
			if !merged[index].ManuallyEdited || overwriteManual {
				candidate.ID = merged[index].ID
				candidate.ProjectID = merged[index].ProjectID
				merged[index] = candidate
			}
			continue
		}
		byName[key] = len(merged)
		merged = append(merged, candidate)
	}
	return merged
}

func ApplyPrefixSuffix(original, prefix, suffix string) string {
	parts := []string{strings.TrimSpace(prefix), strings.TrimSpace(original), strings.TrimSpace(suffix)}
	nonEmpty := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			nonEmpty = append(nonEmpty, part)
		}
	}
	return strings.Join(nonEmpty, "\n")
}

func assetKey(asset domain.Asset) string { return strings.ToLower(strings.TrimSpace(asset.Name)) }
