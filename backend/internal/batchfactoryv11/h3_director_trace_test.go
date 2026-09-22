package batchfactoryv11

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readH3Fixture(t *testing.T, name string) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read H3 fixture %s: %v", name, err)
	}
	if !json.Valid(raw) {
		t.Fatalf("H3 fixture %s is not valid JSON", name)
	}
	return raw
}

func TestParseH3DirectorDocumentUsesProcessedVideoSourceLines(t *testing.T) {
	raw := readH3Fixture(t, "h3_v12_complete_director_trace.json")
	source := H3VideoSource{
		Revision: "video-source-acceptance001-r1",
		Hash:     "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
		Text: "\n五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n\n" +
			"把我和陆晚晚扔在别墅里大眼瞪小眼。\n" +
			"三个月后，爸妈提前回国，想给我们一个惊喜。\n",
	}

	got, err := ParseH3DirectorDocument(raw, source)
	if err != nil {
		t.Fatal(err)
	}
	if got.VideoSourceNonEmptyLineCount != 3 || len(got.DirectorCards) != 3 {
		t.Fatalf("processed video source/card count = %d/%d", got.VideoSourceNonEmptyLineCount, len(got.DirectorCards))
	}
	if got.DirectorCards[2].CharacterSlotIDs == nil || len(got.DirectorCards[2].CharacterSlotIDs) != 0 {
		t.Fatalf("no-character card must persist explicit []: %#v", got.DirectorCards[2].CharacterSlotIDs)
	}
	if got.DirectorCards[0].Camera.ShotSize == "" || got.DirectorCards[0].Continuity.SceneID == "" {
		t.Fatalf("structured camera/continuity lost: %#v", got.DirectorCards[0])
	}
	if got.VisualBaseline == "" || len(got.CharacterRoster) != 2 {
		t.Fatalf("background visual baseline/character analysis lost: %#v", got)
	}
}

func TestParseH3DirectorDocumentNormalizesAConsistentZeroBasedModelIndex(t *testing.T) {
	value := decodeH3FixtureObject(t, "h3_v12_complete_director_trace.json")
	for index := 0; index < 3; index++ {
		h3FixtureCard(value, index)["source_index"] = index
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}

	document, err := ParseH3DirectorDocument(raw, acceptanceH3VideoSource())
	if err != nil {
		t.Fatalf("consistent 0-based model output should be normalized: %v", err)
	}
	for index, card := range document.DirectorCards {
		if got, want := card.SourceIndex, index+1; got != want {
			t.Fatalf("card %d source index = %d, want deterministic 1-based %d", index, got, want)
		}
	}
}

func TestParseH3DirectorDocumentRejectsStringSceneMemory(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal(readH3Fixture(t, "h3_v12_complete_director_trace.json"), &value); err != nil {
		t.Fatal(err)
	}
	cards := value["director_cards"].([]any)
	cards[0].(map[string]any)["continuity"] = "承接上一镜"
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}

	_, err = ParseH3DirectorDocument(raw, H3VideoSource{
		Revision: "video-source-acceptance001-r1",
		Hash:     "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
		Text: "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n" +
			"把我和陆晚晚扔在别墅里大眼瞪小眼。\n" +
			"三个月后，爸妈提前回国，想给我们一个惊喜。",
	})
	if err == nil {
		t.Fatal("string Scene Memory must be rejected")
	}
}

func TestParseH3DirectorDocumentPreservesMultipleHeldPropsPerCharacter(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal(readH3Fixture(t, "h3_v12_complete_director_trace.json"), &value); err != nil {
		t.Fatal(err)
	}
	card := value["director_cards"].([]any)[0].(map[string]any)
	continuity := card["continuity"].(map[string]any)
	continuity["held_props"] = map[string]any{"C001": []any{"苹果", "病历夹"}}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}

	document, err := ParseH3DirectorDocument(raw, acceptanceH3VideoSource())
	if err != nil {
		t.Fatalf("multiple held props must remain a structured H3 continuity value: %v", err)
	}
	persisted, err := json.Marshal(document.DirectorCards[0].Continuity.HeldProps)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(persisted), `{"C001":["苹果","病历夹"]}`; got != want {
		t.Fatalf("held props = %s, want %s", got, want)
	}
}

func TestParseH3DirectorDocumentRejectsInvalidStructure(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
		want   string
	}{
		{
			name: "missing card character_slot_ids",
			mutate: func(value map[string]any) {
				delete(h3FixtureCard(value, 0), "character_slot_ids")
			},
			want: "director_cards[0].character_slot_ids is required",
		},
		{
			name: "unknown card character slot",
			mutate: func(value map[string]any) {
				h3FixtureCard(value, 0)["character_slot_ids"] = []any{"C999"}
			},
			want: "director_cards[0].character_slot_ids[0] unknown slot C999",
		},
		{
			name: "missing canonical character name",
			mutate: func(value map[string]any) {
				value["character_roster"].([]any)[0].(map[string]any)["canonical_name"] = ""
			},
			want: "character_roster[0].canonical_name is required",
		},
		{
			name: "missing character appearance analysis",
			mutate: func(value map[string]any) {
				value["character_roster"].([]any)[0].(map[string]any)["appearance"] = ""
			},
			want: "character_roster[0].appearance is required",
		},
		{
			name: "missing micro shot character_slot_ids",
			mutate: func(value map[string]any) {
				delete(h3FixtureMicroShot(value, 0, 0), "character_slot_ids")
			},
			want: "director_cards[0].micro_shots[0].character_slot_ids is required",
		},
		{
			name: "zero duration weight",
			mutate: func(value map[string]any) {
				h3FixtureCard(value, 0)["duration_weight"] = 0
			},
			want: "director_cards[0].duration_weight must be greater than zero",
		},
		{
			name: "missing structured camera field",
			mutate: func(value map[string]any) {
				h3FixtureCard(value, 0)["camera"].(map[string]any)["shot_size"] = ""
			},
			want: "director_cards[0].camera.shot_size is required",
		},
		{
			name: "missing micro shot action",
			mutate: func(value map[string]any) {
				h3FixtureMicroShot(value, 0, 0)["action"] = ""
			},
			want: "director_cards[0].micro_shots[0].action is required",
		},
		{
			name: "duplicate source key",
			mutate: func(value map[string]any) {
				h3FixtureCard(value, 1)["source_key"] = h3FixtureCard(value, 0)["source_key"]
			},
			want: "director_cards[1].source_key duplicates L001",
		},
		{
			name: "duplicate micro shot key",
			mutate: func(value map[string]any) {
				h3FixtureMicroShot(value, 0, 1)["micro_shot_key"] = h3FixtureMicroShot(value, 0, 0)["micro_shot_key"]
			},
			want: "director_cards[0].micro_shots[1].micro_shot_key duplicates L001-M01",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := decodeH3FixtureObject(t, "h3_v12_complete_director_trace.json")
			test.mutate(value)
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			_, err = ParseH3DirectorDocument(raw, acceptanceH3VideoSource())
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func TestParseH3DirectorDocumentDerivesSourceTextHashFromFrozenLine(t *testing.T) {
	value := decodeH3FixtureObject(t, "h3_v12_complete_director_trace.json")
	h3FixtureCard(value, 0)["source_text_hash"] = "model-cannot-compute-sha256"
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	document, err := ParseH3DirectorDocument(raw, acceptanceH3VideoSource())
	if err != nil {
		t.Fatal(err)
	}
	want := "456e286d68205dde197ac14ddfe941584d99b5b254f4d784ec7c9c1e7ae9edb9"
	if document.DirectorCards[0].SourceTextHash != want {
		t.Fatalf("source_text_hash = %q, want backend-derived %q", document.DirectorCards[0].SourceTextHash, want)
	}
}

func TestParseH3DirectorDocumentPreservesCompleteDirectorData(t *testing.T) {
	document, err := ParseH3DirectorDocument(
		readH3Fixture(t, "h3_v12_complete_director_trace.json"),
		acceptanceH3VideoSource(),
	)
	if err != nil {
		t.Fatal(err)
	}
	card := document.DirectorCards[0]
	if card.Action == "" || card.Camera.ShotAngle == "" || card.Movement.CameraMovement == "" || card.Continuity.Positions["C001"] == "" {
		t.Fatalf("complete card data lost: %#v", card)
	}
	if len(card.MicroShots) != 2 || card.MicroShots[0].Action == "" || card.MicroShots[0].Camera.Framing == "" || card.MicroShots[0].Movement.Transition == "" {
		t.Fatalf("complete micro-shot data lost: %#v", card.MicroShots)
	}
}

func TestParseH3DirectorDocumentPreservesStructuredVisualBaseline(t *testing.T) {
	raw := strings.Replace(string(readH3Fixture(t, "h3_v12_complete_director_trace.json")), `"visual_baseline": "现代高质感实拍短剧，无暗角，自然对比度。"`, `"visual_baseline": {"medium":"现代实拍","color":"自然对比度","camera_language":["克制推轨"]}`, 1)
	document, err := ParseH3DirectorDocument(json.RawMessage(raw), acceptanceH3VideoSource())
	if err != nil {
		t.Fatal(err)
	}
	baseline, ok := document.VisualBaseline.(map[string]any)
	if !ok || baseline["medium"] != "现代实拍" {
		t.Fatalf("structured visual baseline was not preserved: %#v", document.VisualBaseline)
	}
	rendered := h3VisualBaselineText(document.VisualBaseline)
	for _, want := range []string{"现代实拍", "自然对比度", "克制推轨"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered baseline missing %q: %s", want, rendered)
		}
	}
}

func TestParseH3DirectorDocumentNormalizesNumericStringWeights(t *testing.T) {
	value := decodeH3FixtureObject(t, "h3_v12_complete_director_trace.json")
	card := h3FixtureCard(value, 0)
	card["preferred_duration"] = "3"
	card["duration_weight"] = "2.5"
	h3FixtureMicroShot(value, 0, 0)["weight"] = "1.25"
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}

	document, err := ParseH3DirectorDocument(raw, acceptanceH3VideoSource())
	if err != nil {
		t.Fatal(err)
	}
	if document.DirectorCards[0].PreferredDuration != 3 || document.DirectorCards[0].DurationWeight != 2.5 {
		t.Fatalf("card numeric strings were not normalized: %#v", document.DirectorCards[0])
	}
	if document.DirectorCards[0].MicroShots[0].Weight != 1.25 {
		t.Fatalf("micro-shot numeric string was not normalized: %#v", document.DirectorCards[0].MicroShots[0])
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"preferred_duration":"3"`) || strings.Contains(string(encoded), `"duration_weight":"2.5"`) || strings.Contains(string(encoded), `"weight":"1.25"`) {
		t.Fatalf("normalized numeric values must persist as JSON numbers: %s", encoded)
	}
}

func TestDirectorResultRoundTripsValidatedH3Document(t *testing.T) {
	document := mustParseCompleteH3Fixture(t)
	input := DirectorResult{H3Director: &document}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var got DirectorResult
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.H3Director == nil {
		t.Fatal("validated H3 director document was not persisted")
	}
	if got.H3Director.DirectorCards[2].CharacterSlotIDs == nil || len(got.H3Director.DirectorCards[2].CharacterSlotIDs) != 0 {
		t.Fatalf("explicit no-character [] was lost: %#v", got.H3Director.DirectorCards[2].CharacterSlotIDs)
	}
}

func TestDirectorResultKeepsLegacyOutputReadable(t *testing.T) {
	var got DirectorResult
	if err := json.Unmarshal([]byte(validDirectorJSON()), &got); err != nil {
		t.Fatal(err)
	}
	if got.H3Director != nil {
		t.Fatalf("legacy output must not be synthesized into H3: %#v", got.H3Director)
	}
	if len(got.Storyboard) != 1 || got.Storyboard[0].VideoDesc == "" {
		t.Fatalf("legacy storyboard was not preserved: %#v", got.Storyboard)
	}
}

func mustParseCompleteH3Fixture(t *testing.T) H3DirectorDocument {
	t.Helper()
	document, err := ParseH3DirectorDocument(
		readH3Fixture(t, "h3_v12_complete_director_trace.json"),
		acceptanceH3VideoSource(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return document
}

func acceptanceH3VideoSource() H3VideoSource {
	return H3VideoSource{
		Revision: "video-source-acceptance001-r1",
		Hash:     "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
		Text: "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n" +
			"把我和陆晚晚扔在别墅里大眼瞪小眼。\n" +
			"三个月后，爸妈提前回国，想给我们一个惊喜。",
	}
}

func decodeH3FixtureObject(t *testing.T, name string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(readH3Fixture(t, name), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func h3FixtureCard(value map[string]any, index int) map[string]any {
	return value["director_cards"].([]any)[index].(map[string]any)
}

func h3FixtureMicroShot(value map[string]any, cardIndex, shotIndex int) map[string]any {
	return h3FixtureCard(value, cardIndex)["micro_shots"].([]any)[shotIndex].(map[string]any)
}
