package batchfactoryv11

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestResolveContentWindowUsesFiveLinesByDefault(t *testing.T) {
	preview, used, total, err := ResolveContentWindow("一\n二\n三\n四\n五\n六", 0)
	if err != nil {
		t.Fatal(err)
	}
	if preview != "一\n二\n三\n四\n五" || used != 5 || total != 6 {
		t.Fatalf("preview=%q used=%d total=%d", preview, used, total)
	}
}

func TestResolveContentWindowUsesBookOverrideAndIgnoresVisualWrapping(t *testing.T) {
	text := "第一行很长但仍是一行\r\n\r\n第二行\r\n第三行\r\n第四行\r\n第五行\r\n第六行"
	preview, used, _, err := ResolveContentWindow(text, 6)
	if err != nil {
		t.Fatal(err)
	}
	if used != 6 || strings.Contains(preview, "\r") || strings.Contains(preview, "第七行") {
		t.Fatalf("preview=%q used=%d", preview, used)
	}
}

func TestEffectiveContentLineLimitBookPatchOverridesBatchPatch(t *testing.T) {
	batch := SettingsPatch{"contentLineLimit": json.RawMessage(`5`)}
	book := SettingsPatch{"contentLineLimit": json.RawMessage(`7`)}
	got, err := EffectiveContentLineLimit(batch, book)
	if err != nil || got != 7 {
		t.Fatalf("got=%d err=%v", got, err)
	}
}
