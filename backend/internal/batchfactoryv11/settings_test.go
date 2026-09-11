package batchfactoryv11

import (
	"encoding/json"
	"testing"
)

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func TestSparsePatchPreservesFalseEmptyZero(t *testing.T) {
	current := SettingsPatch{"enabled": raw(true), "prefix": raw("x"), "duration": raw(9)}
	got := ApplySparseUpdate(current, SettingsUpdate{Patch: SettingsPatch{"enabled": raw(false), "prefix": raw(""), "duration": raw(0)}})
	for key, want := range map[string]string{"enabled": "false", "prefix": "\"\"", "duration": "0"} {
		if string(got[key]) != want {
			t.Fatalf("%s=%s want %s", key, got[key], want)
		}
	}
}

func TestRestoreInheritanceRemovesOnlySelectedCurrentScopeKeys(t *testing.T) {
	current := SettingsPatch{"quality": raw("book"), "enabled": raw(false), "duration": raw(0)}
	got := ApplySparseUpdate(current, SettingsUpdate{RestoreKeys: []string{"quality"}})
	if _, ok := got["quality"]; ok {
		t.Fatal("quality should inherit after restore")
	}
	if string(got["enabled"]) != "false" || string(got["duration"]) != "0" {
		t.Fatalf("got=%v", got)
	}
}

func TestResolveSettingsUsesPresenceNotTruthiness(t *testing.T) {
	effective := ResolveSettings(
		SettingsPatch{"enabled": raw(true), "prefix": raw("system"), "duration": raw(10)},
		SettingsPatch{"enabled": raw(false)},
		SettingsPatch{"prefix": raw("")},
		SettingsPatch{"duration": raw(0)},
	)
	if string(effective["enabled"]) != "false" || string(effective["prefix"]) != "\"\"" || string(effective["duration"]) != "0" {
		t.Fatalf("effective=%v", effective)
	}
}
