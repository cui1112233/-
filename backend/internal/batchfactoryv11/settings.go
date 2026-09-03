package batchfactoryv11

import "sort"

func clonePatch(input SettingsPatch) SettingsPatch {
	out := SettingsPatch{}
	for k, v := range input {
		out[k] = append([]byte(nil), v...)
	}
	return out
}

func ApplySparseUpdate(current SettingsPatch, update SettingsUpdate) SettingsPatch {
	out := clonePatch(current)
	for _, key := range update.RestoreKeys {
		delete(out, key)
	}
	for key, value := range update.Patch {
		out[key] = append([]byte(nil), value...)
	}
	return out
}

func ResolveSettings(layers ...SettingsPatch) SettingsPatch {
	out := SettingsPatch{}
	for _, layer := range layers {
		for key, value := range layer {
			out[key] = append([]byte(nil), value...)
		}
	}
	return out
}

func ChangedKeys(update SettingsUpdate) []string {
	set := map[string]struct{}{}
	for k := range update.Patch {
		set[k] = struct{}{}
	}
	for _, k := range update.RestoreKeys {
		set[k] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
