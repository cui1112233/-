package batchfactoryv11

import "strings"

func directorBookAssets(book Book, snapshot DirectorSnapshot, output DirectorResult) []BookAsset {
	config := aiReasoningPromptConfig(snapshot.Effective).Assets
	assets := make([]BookAsset, 0, len(output.Characters)+len(output.Scenes)+len(output.Props))
	seen := map[string]bool{}
	appendAssets := func(kind string, values []NamedPrompt, preset PresetSnapshot) {
		for _, value := range values {
			name, prompt := strings.TrimSpace(value.Name), strings.TrimSpace(value.Prompt)
			key := kind + "\x00" + name
			if name == "" || prompt == "" || seen[key] {
				continue
			}
			seen[key] = true
			assets = append(assets, BookAsset{BatchID: book.BatchID, BookID: book.ID, Kind: kind, Name: name, Prompt: prompt, Source: "director", ExtractionPresetID: preset.ID, ExtractionPresetVersion: int64(preset.Version)})
		}
	}
	appendAssets("character", output.Characters, config.Character)
	appendAssets("scene", output.Scenes, config.Scene)
	appendAssets("prop", output.Props, config.Prop)
	return assets
}
