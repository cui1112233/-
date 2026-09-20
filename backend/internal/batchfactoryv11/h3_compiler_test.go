package batchfactoryv11

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestCompileH3VideoSegmentsSeparatesEditableCopyFromSubmittedPrompt(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	input := H3VideoCompileInput{
		TimelineID: "timeline-1",
		Document:   document,
		Timeline:   timeline,
		Preset: H3VideoPreset{
			Key:                 "h3-video-normal",
			Revision:            7,
			Format:              "h3-structured-v1",
			MaxSegmentMS:        10000,
			RequestDurationMode: "ceil-second",
			OutputConstraints:   "9:16 vertical cinematic output",
		},
		Analysis: H3AnalysisSnapshot{
			VisualBaseline: "BASELINE-SAVED-BUT-HIDDEN",
			CharacterSettings: map[string]string{
				"C001": "ASSET-CHILD-DESCRIPTION",
				"C002": "ASSET-LUWANWAN-DESCRIPTION",
			},
			SceneSettings: map[string]string{
				"S001": "ASSET-FOYER-DESCRIPTION",
				"S002": "ASSET-LIVINGROOM-DESCRIPTION",
				"S003": "ASSET-EXTERIOR-DESCRIPTION",
			},
		},
		Switches: H3PromptSwitches{SmartUnified: false, BaseSetup: false},
		EditableCopyOverrides: map[string]H3EditableCopyRevision{
			"SEG001": {Text: "用户可编辑文案：豪门别墅里的三个月。", Revision: 3},
		},
	}

	compilation, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	if compilation.SchemaVersion != "h3-video-compilation/v1" || compilation.CompilerVersion != "h3-video-compiler/v3" {
		t.Fatalf("unexpected compilation contract: %#v", compilation)
	}
	if len(compilation.Segments) != 1 {
		t.Fatalf("segments=%d", len(compilation.Segments))
	}
	segment := compilation.Segments[0]
	if segment.EditableCopy != "用户可编辑文案：豪门别墅里的三个月。" || segment.EditableCopyRevision != 3 {
		t.Fatalf("editable copy lost: %#v", segment)
	}
	if segment.RequestDurationMS != 8000 {
		t.Fatalf("request duration=%d, want deterministic ceil 8000", segment.RequestDurationMS)
	}
	for _, fact := range []string{
		"我", "陆晚晚", "钱袋", "中全景", "缓慢推近", "豪宅玄关", "Soundscape", "五岁的我刚被认回豪门",
	} {
		if !strings.Contains(segment.CompiledPrompt, fact) {
			t.Fatalf("compiled prompt lost storyboard fact %q:\n%s", fact, segment.CompiledPrompt)
		}
	}
	for _, hidden := range []string{"BASELINE-SAVED-BUT-HIDDEN", "ASSET-CHILD-DESCRIPTION", "ASSET-FOYER-DESCRIPTION"} {
		if strings.Contains(segment.CompiledPrompt, hidden) {
			t.Fatalf("disabled injection leaked %q:\n%s", hidden, segment.CompiledPrompt)
		}
	}
	if segment.CompiledPrompt == segment.EditableCopy || segment.CompiledPromptHash == "" {
		t.Fatalf("editable copy is masquerading as compiled prompt: %#v", segment)
	}
	if segment.CompileTrace.EditableCopySource != "user_override" || segment.CompileTrace.EditableCopyRevision != 3 {
		t.Fatalf("override trace lost: %#v", segment.CompileTrace)
	}
	if compilation.Analysis.VisualBaseline != input.Analysis.VisualBaseline || compilation.Analysis.CharacterSettings["C001"] == "" {
		t.Fatalf("background analysis was not retained: %#v", compilation.Analysis)
	}
}

func TestCompileH3VideoSegmentsUsesRealH3SubmissionGrammarInsteadOfTraceDump(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	input := completeH3CompileInput(document, timeline)
	input.Switches = H3PromptSwitches{SmartUnified: true, BaseSetup: true}

	compilation, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	prompt := compilation.Segments[0].CompiledPrompt
	for _, required := range []string{"detailed_description:", "subject_definitions:", "<Subject 1>", "【视听呈现】", "[Scene 1]", "Total duration:", "[Shot 1]", "Audio:", "[Scene 1][Shot 1] Soundscape:", "【H3画面约束】"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("real H3 prompt missing %q:\n%s", required, prompt)
		}
	}
	for _, forbidden := range []string{"H3 FINAL VIDEO", "preset=", "【视频原文切片】", "hash=", "Scene Memory:", "VIDEO Timeline（segment-local）"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("trace/debug field leaked into submitted H3 prompt %q:\n%s", forbidden, prompt)
		}
	}
}

func TestCompileH3VideoSegmentsBuildsDefaultEditableCopyFromDirectorFacts(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	input := completeH3CompileInput(document, timeline)
	input.EditableCopyOverrides = nil

	compilation, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	segment := compilation.Segments[0]
	rawSource := strings.Join([]string{
		document.DirectorCards[0].SourceText,
		document.DirectorCards[1].SourceText,
		document.DirectorCards[2].SourceText,
	}, "\n")
	if segment.EditableCopy == rawSource {
		t.Fatalf("default editable copy must not fall back to raw source slices: %q", segment.EditableCopy)
	}
	for _, fact := range []string{"画面：", "动作：", "机位：", "运镜：", "[Shot", "我", "陆晚晚"} {
		if !strings.Contains(segment.EditableCopy, fact) {
			t.Fatalf("default editable copy lost director fact %q:\n%s", fact, segment.EditableCopy)
		}
	}
	if segment.CompileTrace.EditableCopySource != "director_compilation" {
		t.Fatalf("editable copy source=%q, want director_compilation", segment.CompileTrace.EditableCopySource)
	}
}

func TestCompileH3VideoSegmentsSwitchesOnlyControlTheirInjectionLayers(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	for _, switches := range []H3PromptSwitches{
		{SmartUnified: false, BaseSetup: false},
		{SmartUnified: true, BaseSetup: false},
		{SmartUnified: false, BaseSetup: true},
		{SmartUnified: true, BaseSetup: true},
	} {
		t.Run(switchName(switches), func(t *testing.T) {
			input := completeH3CompileInput(document, timeline)
			input.Switches = switches
			compilation, err := CompileH3VideoSegments(input)
			if err != nil {
				t.Fatal(err)
			}
			prompt := compilation.Segments[0].CompiledPrompt
			if got := strings.Contains(prompt, "VISUAL-BASELINE-CONTENT"); got != switches.SmartUnified {
				t.Fatalf("smart-unified injection=%v, want %v:\n%s", got, switches.SmartUnified, prompt)
			}
			if got := strings.Contains(prompt, "CHARACTER-ASSET-C001"); got != switches.BaseSetup {
				t.Fatalf("base-setup injection=%v, want %v:\n%s", got, switches.BaseSetup, prompt)
			}
			for _, always := range []string{"C001", "我", "女孩站在玄关", "中全景", "缓慢推近", "别墅", "voice_over"} {
				if !strings.Contains(prompt, always) {
					t.Fatalf("switches %#v removed storyboard fact %q:\n%s", switches, always, prompt)
				}
			}
			trace := compilation.Segments[0].CompileTrace
			if trace.Switches != switches || trace.CompiledPromptHash != compilation.Segments[0].CompiledPromptHash {
				t.Fatalf("trace does not freeze effective switches/hash: %#v", trace)
			}
			if !traceHasLayer(trace, "storyboard_facts", true) || !traceHasLayer(trace, "visual_baseline", switches.SmartUnified) || !traceHasLayer(trace, "asset_settings", switches.BaseSetup) {
				t.Fatalf("trace injection layers do not match switches: %#v", trace)
			}
		})
	}
}

func TestCompileH3VideoSegmentsPresetChangeRecompilesWithoutMutatingDirector(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	before, _ := json.Marshal(document)
	firstInput := completeH3CompileInput(document, timeline)
	first, err := CompileH3VideoSegments(firstInput)
	if err != nil {
		t.Fatal(err)
	}
	secondInput := firstInput
	secondInput.Preset.Key = "h3-video-cinematic"
	secondInput.Preset.Revision = 8
	secondInput.Preset.OutputConstraints = "9:16 high-contrast cinematic output"
	second, err := CompileH3VideoSegments(secondInput)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(document)
	if string(before) != string(after) {
		t.Fatal("video preset recompilation mutated the director document")
	}
	if first.DirectorRevisionID != second.DirectorRevisionID || first.CanonicalTimelineID != second.CanonicalTimelineID {
		t.Fatalf("recompile did not reuse director/timeline: %#v %#v", first, second)
	}
	if first.InputHash == second.InputHash || first.Segments[0].CompiledPromptHash == second.Segments[0].CompiledPromptHash {
		t.Fatal("video preset change did not create a distinct deterministic compilation")
	}
}

func TestCompileH3VideoSegmentsRendersEachPromptOnSegmentLocalClock(t *testing.T) {
	document := mustH3DirectorFixture(t)
	document.DirectorCards[0].DurationWeight = 2
	document.DirectorCards[1].DurationWeight = 1
	document.DirectorCards[2].DurationWeight = 1
	timeline := mustH3Timeline(t, document, 30000)
	input := completeH3CompileInput(document, timeline)
	input.Preset.MaxSegmentMS = 15000

	compilation, err := CompileH3VideoSegments(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(compilation.Segments) != 2 {
		t.Fatalf("segments=%d", len(compilation.Segments))
	}
	second := compilation.Segments[1]
	if !strings.Contains(second.CompiledPrompt, "00:00.000-00:07.500") {
		t.Fatalf("second VIDEO prompt does not restart at segment-local zero:\n%s", second.CompiledPrompt)
	}
	if strings.Contains(second.CompiledPrompt, "00:15.000-00:22.500") {
		t.Fatalf("second VIDEO prompt leaked absolute book time:\n%s", second.CompiledPrompt)
	}
	if second.CanonicalStartMS != 15000 || second.CompileTrace.SourceSlices[0].CanonicalStartMS != 15000 {
		t.Fatalf("canonical trace must retain absolute time: %#v", second)
	}
}

func TestCompileH3VideoSegmentsRejectsDuplicateDirectorIdentity(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*H3DirectorDocument)
		want   string
	}{
		{
			name: "duplicate source key",
			mutate: func(document *H3DirectorDocument) {
				document.DirectorCards[1].SourceKey = document.DirectorCards[0].SourceKey
			},
			want: "director_cards[1].source_key duplicates L001",
		},
		{
			name: "duplicate micro shot key",
			mutate: func(document *H3DirectorDocument) {
				document.DirectorCards[0].MicroShots[1].MicroShotKey = document.DirectorCards[0].MicroShots[0].MicroShotKey
			},
			want: "director_cards[0].micro_shots[1].micro_shot_key duplicates L001-M01",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			document := mustH3DirectorFixture(t)
			test.mutate(&document)
			timeline := mustH3Timeline(t, document, 7420)
			_, err := CompileH3VideoSegments(completeH3CompileInput(document, timeline))
			if err == nil || !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("err=%v, want invalid containing %q", err, test.want)
			}
		})
	}
}

func TestCompileH3VideoSegmentsMatchesFrozenPromptGoldenHash(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	compilation, err := CompileH3VideoSegments(completeH3CompileInput(document, timeline))
	if err != nil {
		t.Fatal(err)
	}
	const want = "ec0c0c65bc01eae6afd32ea811dcd9ced337343420e5b47c326fed1be819cdad"
	if got := compilation.Segments[0].CompiledPromptHash; got != want {
		t.Fatalf("compiled prompt golden hash=%s, want %s", got, want)
	}
}

func completeH3CompileInput(document H3DirectorDocument, timeline H3CanonicalTimeline) H3VideoCompileInput {
	return H3VideoCompileInput{
		TimelineID: "timeline-1",
		Document:   document,
		Timeline:   timeline,
		Preset: H3VideoPreset{
			Key:                 "h3-video-normal",
			Revision:            7,
			Format:              "h3-structured-v1",
			MaxSegmentMS:        10000,
			RequestDurationMode: "ceil-second",
			OutputConstraints:   "9:16 vertical cinematic output",
		},
		Analysis: H3AnalysisSnapshot{
			VisualBaseline: "VISUAL-BASELINE-CONTENT",
			CharacterSettings: map[string]string{
				"C001": "CHARACTER-ASSET-C001",
				"C002": "CHARACTER-ASSET-C002",
			},
			SceneSettings: map[string]string{
				"S001": "SCENE-ASSET-S001",
				"S002": "SCENE-ASSET-S002",
				"S003": "SCENE-ASSET-S003",
			},
		},
		Switches: H3PromptSwitches{SmartUnified: true, BaseSetup: true},
	}
}

func switchName(switches H3PromptSwitches) string {
	return "smart=" + boolName(switches.SmartUnified) + "/base=" + boolName(switches.BaseSetup)
}

func boolName(value bool) string {
	if value {
		return "on"
	}
	return "off"
}

func traceHasLayer(trace H3CompileTrace, name string, injected bool) bool {
	values := trace.OmittedLayers
	if injected {
		values = trace.InjectedLayers
	}
	for _, value := range values {
		if value == name {
			return true
		}
	}
	return false
}
