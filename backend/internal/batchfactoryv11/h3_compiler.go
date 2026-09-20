package batchfactoryv11

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const (
	h3VideoCompilationSchemaV1 = "h3-video-compilation/v1"
	h3VideoCompilerKey         = "embedded-h3"
	h3VideoCompilerVersionV1   = "h3-video-compiler/v1"
)

type H3VideoPreset struct {
	Key                 string `json:"key"`
	Revision            int64  `json:"revision"`
	Format              string `json:"format"`
	MaxSegmentMS        int64  `json:"max_segment_ms"`
	RequestDurationMode string `json:"request_duration_mode"`
	OutputConstraints   string `json:"output_constraints"`
}

type H3PromptSwitches struct {
	SmartUnified bool `json:"smart_unified"`
	BaseSetup    bool `json:"base_setup"`
}

type H3AnalysisSnapshot struct {
	VisualBaseline    string            `json:"visual_baseline"`
	CharacterSettings map[string]string `json:"character_settings"`
	SceneSettings     map[string]string `json:"scene_settings"`
}

type H3EditableCopyRevision struct {
	Text     string `json:"text"`
	Revision int64  `json:"revision"`
}

type H3VideoCompileInput struct {
	TimelineID            string                            `json:"timeline_id"`
	Document              H3DirectorDocument                `json:"document"`
	Timeline              H3CanonicalTimeline               `json:"timeline"`
	Preset                H3VideoPreset                     `json:"preset"`
	Analysis              H3AnalysisSnapshot                `json:"analysis"`
	Switches              H3PromptSwitches                  `json:"switches"`
	EditableCopyOverrides map[string]H3EditableCopyRevision `json:"editable_copy_overrides,omitempty"`
}

type H3CompileTrace struct {
	CompilerKey          string           `json:"compiler_key"`
	CompilerVersion      string           `json:"compiler_version"`
	VideoPresetKey       string           `json:"video_preset_key"`
	VideoPresetRevision  int64            `json:"video_preset_revision"`
	Switches             H3PromptSwitches `json:"switches"`
	InjectedLayers       []string         `json:"injected_layers"`
	OmittedLayers        []string         `json:"omitted_layers"`
	EditableCopySource   string           `json:"editable_copy_source"`
	EditableCopyRevision int64            `json:"editable_copy_revision"`
	CompiledPromptHash   string           `json:"compiled_prompt_hash"`
	SourceSlices         []H3SourceSlice  `json:"source_slices"`
}

type H3CompiledVideoSegment struct {
	H3VideoSegment
	RequestDurationMS    int64          `json:"request_duration_ms"`
	EditableCopy         string         `json:"editable_copy"`
	EditableCopyRevision int64          `json:"editable_copy_revision"`
	CompiledPrompt       string         `json:"compiled_prompt"`
	CompiledPromptHash   string         `json:"compiled_prompt_hash"`
	CompileTrace         H3CompileTrace `json:"compile_trace"`
}

type H3VideoCompilation struct {
	SchemaVersion       string                   `json:"schema_version"`
	DirectorRevisionID  string                   `json:"director_revision_id"`
	CanonicalTimelineID string                   `json:"canonical_timeline_id"`
	VideoPreset         H3VideoPreset            `json:"video_preset"`
	CompilerKey         string                   `json:"compiler_key"`
	CompilerVersion     string                   `json:"compiler_version"`
	MaxSegmentMS        int64                    `json:"max_segment_ms"`
	InputHash           string                   `json:"input_hash"`
	Analysis            H3AnalysisSnapshot       `json:"analysis"`
	Segments            []H3CompiledVideoSegment `json:"segments"`
}

func CompileH3VideoSegments(input H3VideoCompileInput) (H3VideoCompilation, error) {
	var compilation H3VideoCompilation
	if err := validateH3CompileInput(input); err != nil {
		return compilation, err
	}
	segments, err := SegmentH3CanonicalTimeline(input.Document, input.Timeline, input.Preset.MaxSegmentMS)
	if err != nil {
		return compilation, err
	}
	for key := range input.EditableCopyOverrides {
		found := false
		for _, segment := range segments {
			if segment.SegmentKey == key {
				found = true
				break
			}
		}
		if !found {
			return compilation, fmt.Errorf("%w: editable copy override references unknown segment %s", ErrInvalid, key)
		}
	}

	hashInput, err := json.Marshal(struct {
		TimelineID            string                            `json:"timeline_id"`
		Document              H3DirectorDocument                `json:"document"`
		Timeline              H3CanonicalTimeline               `json:"timeline"`
		Preset                H3VideoPreset                     `json:"preset"`
		Analysis              H3AnalysisSnapshot                `json:"analysis"`
		Switches              H3PromptSwitches                  `json:"switches"`
		EditableCopyOverrides map[string]H3EditableCopyRevision `json:"editable_copy_overrides,omitempty"`
		CompilerVersion       string                            `json:"compiler_version"`
	}{input.TimelineID, input.Document, input.Timeline, input.Preset, input.Analysis, input.Switches, input.EditableCopyOverrides, h3VideoCompilerVersionV1})
	if err != nil {
		return compilation, fmt.Errorf("hash H3 compilation input: %w", err)
	}
	compilation = H3VideoCompilation{
		SchemaVersion:       h3VideoCompilationSchemaV1,
		DirectorRevisionID:  input.Timeline.DirectorRevisionID,
		CanonicalTimelineID: strings.TrimSpace(input.TimelineID),
		VideoPreset:         input.Preset,
		CompilerKey:         h3VideoCompilerKey,
		CompilerVersion:     h3VideoCompilerVersionV1,
		MaxSegmentMS:        input.Preset.MaxSegmentMS,
		InputHash:           fmt.Sprintf("%x", sha256.Sum256(hashInput)),
		Analysis:            cloneH3Analysis(input.Analysis),
		Segments:            make([]H3CompiledVideoSegment, 0, len(segments)),
	}
	for _, segment := range segments {
		copyRevision, overridden := input.EditableCopyOverrides[segment.SegmentKey]
		editableCopy := strings.TrimSpace(copyRevision.Text)
		editableSource := "user_override"
		if !overridden {
			editableCopy = h3DefaultEditableCopy(input.Document, segment)
			copyRevision.Revision = 1
			editableSource = "source_slice"
		} else if editableCopy == "" || copyRevision.Revision < 1 {
			return H3VideoCompilation{}, fmt.Errorf("%w: %s editable copy text and positive revision are required", ErrInvalid, segment.SegmentKey)
		}
		prompt := compileH3CanonicalSegmentPrompt(input, segment, editableCopy, overridden)
		promptHash := fmt.Sprintf("%x", sha256.Sum256([]byte(prompt)))
		trace := H3CompileTrace{
			CompilerKey:          h3VideoCompilerKey,
			CompilerVersion:      h3VideoCompilerVersionV1,
			VideoPresetKey:       input.Preset.Key,
			VideoPresetRevision:  input.Preset.Revision,
			Switches:             input.Switches,
			InjectedLayers:       []string{"storyboard_facts", "output_constraints"},
			OmittedLayers:        []string{},
			EditableCopySource:   editableSource,
			EditableCopyRevision: copyRevision.Revision,
			CompiledPromptHash:   promptHash,
			SourceSlices:         append([]H3SourceSlice(nil), segment.SourceSlices...),
		}
		if overridden {
			trace.InjectedLayers = append(trace.InjectedLayers, "editable_copy_override")
		} else {
			trace.OmittedLayers = append(trace.OmittedLayers, "editable_copy_override")
		}
		if input.Switches.SmartUnified {
			trace.InjectedLayers = append(trace.InjectedLayers, "visual_baseline")
		} else {
			trace.OmittedLayers = append(trace.OmittedLayers, "visual_baseline")
		}
		if input.Switches.BaseSetup {
			trace.InjectedLayers = append(trace.InjectedLayers, "asset_settings")
		} else {
			trace.OmittedLayers = append(trace.OmittedLayers, "asset_settings")
		}
		requestDuration, err := h3RequestDuration(segment.CanonicalDurationMS, input.Preset)
		if err != nil {
			return H3VideoCompilation{}, err
		}
		compilation.Segments = append(compilation.Segments, H3CompiledVideoSegment{
			H3VideoSegment:       segment,
			RequestDurationMS:    requestDuration,
			EditableCopy:         editableCopy,
			EditableCopyRevision: copyRevision.Revision,
			CompiledPrompt:       prompt,
			CompiledPromptHash:   promptHash,
			CompileTrace:         trace,
		})
	}
	return compilation, nil
}

func validateH3CompileInput(input H3VideoCompileInput) error {
	if strings.TrimSpace(input.TimelineID) == "" {
		return fmt.Errorf("%w: timeline_id is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Preset.Key) == "" || input.Preset.Revision < 1 {
		return fmt.Errorf("%w: video preset key and positive revision are required", ErrInvalid)
	}
	if input.Preset.Format != "h3-structured-v1" {
		return fmt.Errorf("%w: video preset format must be h3-structured-v1", ErrInvalid)
	}
	if input.Preset.MaxSegmentMS != 10000 && input.Preset.MaxSegmentMS != 15000 {
		return fmt.Errorf("%w: video preset max_segment_ms must be 10000 or 15000", ErrInvalid)
	}
	if input.Preset.RequestDurationMode != "ceil-second" && input.Preset.RequestDurationMode != "fixed-max" {
		return fmt.Errorf("%w: unsupported request duration mode", ErrInvalid)
	}
	if strings.TrimSpace(input.Preset.OutputConstraints) == "" {
		return fmt.Errorf("%w: video preset output_constraints are required", ErrInvalid)
	}
	if strings.TrimSpace(input.Analysis.VisualBaseline) == "" {
		return fmt.Errorf("%w: saved H3 visual baseline is required", ErrInvalid)
	}
	if input.Analysis.CharacterSettings == nil || input.Analysis.SceneSettings == nil {
		return fmt.Errorf("%w: saved H3 character and scene analysis are required", ErrInvalid)
	}
	for _, character := range input.Document.CharacterRoster {
		if strings.TrimSpace(input.Analysis.CharacterSettings[character.SlotID]) == "" {
			return fmt.Errorf("%w: saved H3 character analysis missing slot %s", ErrInvalid, character.SlotID)
		}
	}
	seenScenes := map[string]struct{}{}
	for _, card := range input.Document.DirectorCards {
		if _, seen := seenScenes[card.Continuity.SceneID]; seen {
			continue
		}
		seenScenes[card.Continuity.SceneID] = struct{}{}
		if strings.TrimSpace(input.Analysis.SceneSettings[card.Continuity.SceneID]) == "" {
			return fmt.Errorf("%w: saved H3 scene analysis missing scene %s", ErrInvalid, card.Continuity.SceneID)
		}
	}
	return nil
}

func h3RequestDuration(canonicalMS int64, preset H3VideoPreset) (int64, error) {
	var result int64
	switch preset.RequestDurationMode {
	case "ceil-second":
		result = ((canonicalMS + 999) / 1000) * 1000
	case "fixed-max":
		result = preset.MaxSegmentMS
	default:
		return 0, fmt.Errorf("%w: unsupported request duration mode", ErrInvalid)
	}
	if result <= 0 || result > preset.MaxSegmentMS {
		return 0, fmt.Errorf("%w: request duration %dms exceeds preset maximum %dms", ErrInvalid, result, preset.MaxSegmentMS)
	}
	return result, nil
}

func compileH3CanonicalSegmentPrompt(input H3VideoCompileInput, segment H3VideoSegment, editableCopy string, overridden bool) string {
	parts := []string{
		"【H3 FINAL VIDEO】",
		fmt.Sprintf("preset=%s@%d | format=%s | segment=%s | canonical=%s-%s | duration=%dms", input.Preset.Key, input.Preset.Revision, input.Preset.Format, segment.SegmentKey, h3MillisClock(segment.CanonicalStartMS), h3MillisClock(segment.CanonicalEndMS), segment.CanonicalDurationMS),
		"【人物绑定】\n" + h3RosterText(input.Document.CharacterRoster),
		"【视频原文切片】\n" + h3SourceSliceText(input.Document, segment),
	}
	if input.Switches.SmartUnified {
		parts = append(parts, "【H3视觉基线】\n"+strings.TrimSpace(input.Analysis.VisualBaseline))
	}
	if input.Switches.BaseSetup {
		parts = append(parts, "【基础资产设定】\n"+h3AssetSettingsText(input.Document, input.Analysis, segment))
	}
	if overridden {
		parts = append(parts, "【用户文案约束】\n"+strings.TrimSpace(editableCopy))
	}
	parts = append(parts,
		"【VIDEO Timeline（segment-local）】\n"+h3SegmentFactsText(input.Document, segment),
		"【输出约束】\n"+strings.TrimSpace(input.Preset.OutputConstraints),
	)
	return strings.Join(parts, "\n\n")
}

func h3RosterText(roster []H3Character) string {
	lines := make([]string, 0, len(roster))
	for _, character := range roster {
		lines = append(lines, fmt.Sprintf("%s=%s", character.SlotID, character.CanonicalName))
	}
	if len(lines) == 0 {
		return "[]"
	}
	return strings.Join(lines, "\n")
}

func h3SourceSliceText(document H3DirectorDocument, segment H3VideoSegment) string {
	lines := make([]string, 0, len(segment.SourceSlices))
	for _, slice := range segment.SourceSlices {
		card, _ := h3DirectorCardBySourceKey(document, slice.SourceKey)
		lines = append(lines, fmt.Sprintf("%s[%d] hash=%s | %s", slice.SourceKey, slice.SourceIndex, slice.SourceTextHash, card.SourceText))
	}
	return strings.Join(lines, "\n")
}

func h3AssetSettingsText(document H3DirectorDocument, analysis H3AnalysisSnapshot, segment H3VideoSegment) string {
	lines := make([]string, 0)
	usedSlots := map[string]struct{}{}
	usedScenes := map[string]struct{}{}
	for _, slice := range segment.SourceSlices {
		card, ok := h3DirectorCardBySourceKey(document, slice.SourceKey)
		if !ok {
			continue
		}
		usedScenes[card.Continuity.SceneID] = struct{}{}
		for _, slotID := range card.CharacterSlotIDs {
			usedSlots[slotID] = struct{}{}
		}
	}
	for _, character := range document.CharacterRoster {
		if _, used := usedSlots[character.SlotID]; used {
			lines = append(lines, fmt.Sprintf("人物 %s %s：%s", character.SlotID, character.CanonicalName, analysis.CharacterSettings[character.SlotID]))
		}
	}
	scenes := make([]string, 0, len(usedScenes))
	for sceneID := range usedScenes {
		scenes = append(scenes, sceneID)
	}
	sort.Strings(scenes)
	for _, sceneID := range scenes {
		lines = append(lines, fmt.Sprintf("场景 %s：%s", sceneID, analysis.SceneSettings[sceneID]))
	}
	return strings.Join(lines, "\n")
}

func h3SegmentFactsText(document H3DirectorDocument, segment H3VideoSegment) string {
	lines := make([]string, 0)
	seenCards := map[string]struct{}{}
	for _, reference := range segment.MicroShots {
		card, cardOK := h3DirectorCardBySourceKey(document, reference.SourceKey)
		if !cardOK {
			continue
		}
		if _, seen := seenCards[card.SourceKey]; !seen {
			seenCards[card.SourceKey] = struct{}{}
			lines = append(lines,
				fmt.Sprintf("%s 原文=%s", card.SourceKey, card.SourceText),
				fmt.Sprintf("人物=%s | 场景=%s | 动作=%s | 机位=%s/%s/%s | 运镜=%s/%s/%s | 节奏=%s", h3SlotNames(document, card.CharacterSlotIDs), card.VisualContext, card.Action, card.Camera.ShotSize, card.Camera.ShotAngle, card.Camera.Framing, card.Movement.CameraMovement, card.Movement.SubjectMovement, card.Movement.Transition, card.Rhythm),
				"Scene Memory: "+h3SceneMemoryText(card.Continuity),
				"Audio: "+h3AudioText(card.Audio),
			)
		}
		shot, shotOK := h3MicroShotByKey(card, reference.MicroShotKey)
		if !shotOK {
			continue
		}
		lines = append(lines, fmt.Sprintf(
			"%s-%s | %s | 人物=%s | task=%s | visual=%s | action=%s | camera=%s/%s/%s | movement=%s/%s/%s | rhythm=%s | Audio=%s",
			h3MillisClock(reference.SegmentStartMS), h3MillisClock(reference.SegmentEndMS), shot.MicroShotKey,
			h3SlotNames(document, shot.CharacterSlotIDs), shot.ShotTask, shot.Visual, shot.Action,
			shot.Camera.ShotSize, shot.Camera.ShotAngle, shot.Camera.Framing,
			shot.Movement.CameraMovement, shot.Movement.SubjectMovement, shot.Movement.Transition,
			shot.Rhythm, h3AudioText(shot.Audio),
		))
	}
	return strings.Join(lines, "\n")
}

func h3SceneMemoryText(memory H3SceneMemory) string {
	positions, _ := json.Marshal(memory.Positions)
	facings, _ := json.Marshal(memory.Facings)
	gazes, _ := json.Marshal(memory.Gazes)
	heldProps, _ := json.Marshal(memory.HeldProps)
	actionEnds, _ := json.Marshal(memory.ActionEnds)
	return fmt.Sprintf("scene_id=%s | location=%s | axis=%s | light_direction=%s | positions=%s | facings=%s | gazes=%s | held_props=%s | action_ends=%s", memory.SceneID, memory.Location, memory.Axis, memory.LightDirection, positions, facings, gazes, heldProps, actionEnds)
}

func h3AudioText(audio H3Audio) string {
	return fmt.Sprintf("mode=%s | speaker=%s | dialogue=%s | voice_over=%s | sound_effects=%s | ambience=%s", audio.Mode, audio.SpeakerSlotID, audio.Dialogue, audio.VoiceOver, strings.Join(audio.SoundEffects, "、"), strings.Join(audio.Ambience, "、"))
}

func h3SlotNames(document H3DirectorDocument, slots []string) string {
	if len(slots) == 0 {
		return "[]"
	}
	values := make([]string, 0, len(slots))
	for _, slotID := range slots {
		name := ""
		for _, character := range document.CharacterRoster {
			if character.SlotID == slotID {
				name = character.CanonicalName
				break
			}
		}
		values = append(values, fmt.Sprintf("%s(%s)", slotID, name))
	}
	return strings.Join(values, ",")
}

func h3DirectorCardBySourceKey(document H3DirectorDocument, sourceKey string) (H3DirectorCard, bool) {
	for _, card := range document.DirectorCards {
		if card.SourceKey == sourceKey {
			return card, true
		}
	}
	return H3DirectorCard{}, false
}

func h3MicroShotByKey(card H3DirectorCard, key string) (H3MicroShot, bool) {
	for _, shot := range card.MicroShots {
		if shot.MicroShotKey == key {
			return shot, true
		}
	}
	return H3MicroShot{}, false
}

func h3DefaultEditableCopy(document H3DirectorDocument, segment H3VideoSegment) string {
	lines := make([]string, 0, len(segment.SourceSlices))
	for _, slice := range segment.SourceSlices {
		if card, ok := h3DirectorCardBySourceKey(document, slice.SourceKey); ok {
			lines = append(lines, card.SourceText)
		}
	}
	return strings.Join(lines, "\n")
}

func h3MillisClock(milliseconds int64) string {
	if milliseconds < 0 {
		milliseconds = 0
	}
	minutes := milliseconds / 60000
	seconds := (milliseconds % 60000) / 1000
	millis := milliseconds % 1000
	return fmt.Sprintf("%02d:%02d.%03d", minutes, seconds, millis)
}

func cloneH3Analysis(input H3AnalysisSnapshot) H3AnalysisSnapshot {
	clone := H3AnalysisSnapshot{
		VisualBaseline:    input.VisualBaseline,
		CharacterSettings: make(map[string]string, len(input.CharacterSettings)),
		SceneSettings:     make(map[string]string, len(input.SceneSettings)),
	}
	for key, value := range input.CharacterSettings {
		clone.CharacterSettings[key] = value
	}
	for key, value := range input.SceneSettings {
		clone.SceneSettings[key] = value
	}
	return clone
}
