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
	h3VideoCompilerVersion     = "h3-video-compiler/v3"
)

const h3DefaultAudiovisualPresentation = `[AUDIOVISUAL PRESENTATION]
Render every Scene and Shot strictly in the listed order.
Complete the current Scene and its visible result before the next Scene begins.
Never preview or borrow any action, location, prop state, character reveal, or story result belonging to a later Scene.
Once a later story beat begins, never return to an unfinished earlier beat.
Use a clean hard cut at Scene or Shot boundaries unless the current Shot explicitly defines one continuous action in the same physical space.
Character emotion and relationships are primarily expressed through gaze, gesture, body movement, blocking, props, and visible environmental results.
Visible characters maintain a natural closed-mouth state.`

type H3VideoPreset struct {
	Key                 string `json:"key"`
	Revision            int64  `json:"revision"`
	Format              string `json:"format"`
	MaxSegmentMS        int64  `json:"max_segment_ms"`
	RequestDurationMode string `json:"request_duration_mode"`
	PromptTemplate      string `json:"prompt_template,omitempty"`
	OutputConstraints   string `json:"output_constraints"`
}

type H3PromptSwitches struct {
	SmartUnified      bool `json:"smart_unified"`
	BaseSetup         bool `json:"base_setup"`
	VisualRestriction bool `json:"visual_restriction"`
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
	FinalPromptOverrides  map[string]H3EditableCopyRevision `json:"final_prompt_overrides,omitempty"`
	TimelineID            string                            `json:"timeline_id"`
	Document              H3DirectorDocument                `json:"document"`
	Timeline              H3CanonicalTimeline               `json:"timeline"`
	Preset                H3VideoPreset                     `json:"preset"`
	Analysis              H3AnalysisSnapshot                `json:"analysis"`
	VisualRestrictionText string                            `json:"visual_restriction_text,omitempty"`
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
	for key := range input.FinalPromptOverrides {
		found := false
		for _, segment := range segments {
			if segment.SegmentKey == key {
				found = true
			}
		}
		if !found {
			return compilation, fmt.Errorf("%w: final prompt references unknown segment %s", ErrInvalid, key)
		}
		if _, mixed := input.EditableCopyOverrides[key]; mixed {
			return compilation, fmt.Errorf("%w: conflicting prompt override modes", ErrInvalid)
		}
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
		VisualRestrictionText string                            `json:"visual_restriction_text,omitempty"`
		Switches              H3PromptSwitches                  `json:"switches"`
		EditableCopyOverrides map[string]H3EditableCopyRevision `json:"editable_copy_overrides,omitempty"`
		FinalPromptOverrides  map[string]H3EditableCopyRevision `json:"final_prompt_overrides,omitempty"`
		CompilerVersion       string                            `json:"compiler_version"`
	}{input.TimelineID, input.Document, input.Timeline, input.Preset, input.Analysis, input.VisualRestrictionText, input.Switches, input.EditableCopyOverrides, input.FinalPromptOverrides, h3VideoCompilerVersion})
	if err != nil {
		return compilation, fmt.Errorf("hash H3 compilation input: %w", err)
	}
	compilation = H3VideoCompilation{
		SchemaVersion:       h3VideoCompilationSchemaV1,
		DirectorRevisionID:  input.Timeline.DirectorRevisionID,
		CanonicalTimelineID: strings.TrimSpace(input.TimelineID),
		VideoPreset:         input.Preset,
		CompilerKey:         h3VideoCompilerKey,
		CompilerVersion:     h3VideoCompilerVersion,
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
			editableSource = "director_compilation"
		} else if editableCopy == "" || copyRevision.Revision < 1 {
			return H3VideoCompilation{}, fmt.Errorf("%w: %s editable copy text and positive revision are required", ErrInvalid, segment.SegmentKey)
		}
		prompt := compileH3CanonicalSegmentPrompt(input, segment, editableCopy, overridden)
		if final, ok := input.FinalPromptOverrides[segment.SegmentKey]; ok {
			if strings.TrimSpace(final.Text) == "" || final.Revision < 1 {
				return H3VideoCompilation{}, fmt.Errorf("%w: final prompt text and revision required", ErrInvalid)
			}
			prompt, editableCopy, copyRevision, editableSource = final.Text, final.Text, final, "user_final_prompt"
		} else if !overridden {
			editableCopy = prompt
		}
		promptHash := fmt.Sprintf("%x", sha256.Sum256([]byte(prompt)))
		trace := H3CompileTrace{
			CompilerKey:          h3VideoCompilerKey,
			CompilerVersion:      h3VideoCompilerVersion,
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
		if input.Switches.VisualRestriction {
			trace.InjectedLayers = append(trace.InjectedLayers, "visual_restriction")
		} else {
			trace.OmittedLayers = append(trace.OmittedLayers, "visual_restriction")
		}
		if editableSource == "user_final_prompt" {
			// The user replaced the entire output. The saved switch settings
			// are context, not evidence that any automatic layer survived.
			trace.InjectedLayers = []string{}
			trace.OmittedLayers = []string{"storyboard_facts", "output_constraints", "editable_copy_override", "visual_baseline", "asset_settings", "visual_restriction"}
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
	visualBaseline := ""
	if input.Switches.SmartUnified {
		visualBaseline = "detailed_description:\n" + strings.TrimSpace(input.Analysis.VisualBaseline)
	}
	assetDefinitions := ""
	if input.Switches.BaseSetup {
		assetDefinitions = "subject_definitions:\n" + h3CanonicalSubjectDefinitions(input.Document, input.Analysis, segment)
	}
	storyboard := h3CanonicalPresentation(input.Document, segment)
	visualRestriction := ""
	if input.Switches.VisualRestriction {
		visualRestriction = strings.TrimSpace(input.VisualRestrictionText)
		if visualRestriction == "" {
			// Read-only compatibility for compilations created before the H3
			// visual-restriction preset existed. New callers freeze preset text.
			visualRestriction = h3VisualPolicy()
		}
	}
	if template := strings.TrimSpace(input.Preset.PromptTemplate); template != "" {
		rendered := renderH3PromptTemplate(template, map[string]string{
			"visual_baseline":    visualBaseline,
			"asset_definitions":  assetDefinitions,
			"storyboard":         storyboard,
			"visual_restriction": visualRestriction,
			"output_constraints": strings.TrimSpace(input.Preset.OutputConstraints),
		})
		// A video preset owns only its director skeleton. Style, asset settings
		// and visual limits are independent switch-controlled injection layers;
		// legacy templates that place their placeholders explicitly keep their
		// historical layout, while storyboard-only templates receive the layers
		// around the editable skeleton.
		parts := make([]string, 0, 4)
		if visualBaseline != "" && !strings.Contains(template, "{{visual_baseline}}") {
			parts = append(parts, visualBaseline)
		}
		if assetDefinitions != "" && !strings.Contains(template, "{{asset_definitions}}") {
			parts = append(parts, assetDefinitions)
		}
		parts = append(parts, rendered)
		if visualRestriction != "" && !strings.Contains(template, "{{visual_restriction}}") {
			parts = append(parts, visualRestriction)
		}
		return strings.TrimSpace(strings.Join(parts, "\n\n"))
	}
	parts := []string{}
	if visualBaseline != "" {
		parts = append(parts, visualBaseline)
	}
	if assetDefinitions != "" {
		parts = append(parts, assetDefinitions)
	}
	if overridden {
		parts = append(parts, "editable_story_direction:\n"+strings.TrimSpace(editableCopy))
	}
	parts = append(parts, h3DefaultAudiovisualPresentation+"\n\n"+storyboard)
	if visualRestriction != "" {
		parts = append(parts, visualRestriction)
	}
	parts = append(parts, strings.TrimSpace(input.Preset.OutputConstraints))
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func renderH3PromptTemplate(template string, values map[string]string) string {
	result := strings.TrimSpace(template)
	for key, value := range values {
		result = strings.ReplaceAll(result, "{{"+key+"}}", strings.TrimSpace(value))
	}
	for strings.Contains(result, "\n\n\n") {
		result = strings.ReplaceAll(result, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(result)
}

func h3CanonicalSubjectDefinitions(document H3DirectorDocument, analysis H3AnalysisSnapshot, segment H3VideoSegment) string {
	used := map[string]bool{}
	for _, reference := range segment.MicroShots {
		card, ok := h3DirectorCardBySourceKey(document, reference.SourceKey)
		if !ok {
			continue
		}
		shot, ok := h3MicroShotByKey(card, reference.MicroShotKey)
		if !ok {
			continue
		}
		for _, slotID := range shot.CharacterSlotIDs {
			used[slotID] = true
		}
	}
	lines := []string{}
	index := 0
	for _, character := range document.CharacterRoster {
		if !used[character.SlotID] {
			continue
		}
		index++
		lines = append(lines, fmt.Sprintf("<Subject %d> %s：%s", index, character.CanonicalName, strings.TrimSpace(analysis.CharacterSettings[character.SlotID])))
	}
	return strings.Join(lines, "\n")
}

func h3CanonicalPresentation(document H3DirectorDocument, segment H3VideoSegment) string {
	visualLines := []string{}
	audioLines := []string{}
	sceneNumber := 0
	for _, slice := range segment.SourceSlices {
		card, ok := h3DirectorCardBySourceKey(document, slice.SourceKey)
		if !ok {
			continue
		}
		references := []H3SegmentMicroShot{}
		for _, reference := range segment.MicroShots {
			if reference.SourceKey == card.SourceKey {
				references = append(references, reference)
			}
		}
		if len(references) == 0 {
			continue
		}
		sceneNumber++
		duration := float64(references[len(references)-1].SegmentEndMS-references[0].SegmentStartMS) / 1000
		visualLines = append(visualLines,
			fmt.Sprintf("[Scene %d] %s", sceneNumber, strings.TrimSpace(card.Continuity.Location)),
			fmt.Sprintf("Event: %s", strings.TrimSpace(card.Action)),
			fmt.Sprintf("导演调度：%s，%s，%s；摄影机%s，主体%s，以%s衔接。", card.Camera.ShotSize, card.Camera.ShotAngle, card.Camera.Framing, card.Movement.CameraMovement, card.Movement.SubjectMovement, card.Movement.Transition),
			fmt.Sprintf("Total duration: %.3f seconds.", duration),
		)
		for shotIndex, reference := range references {
			shot, found := h3MicroShotByKey(card, reference.MicroShotKey)
			if !found {
				continue
			}
			visualLines = append(visualLines,
				fmt.Sprintf("[Shot %d] %s-%s", shotIndex+1, h3MillisClock(reference.SegmentStartMS), h3MillisClock(reference.SegmentEndMS)),
				fmt.Sprintf("%s。人物：%s。画面：%s。动作：%s。机位：%s，%s，%s。运镜：%s；主体运动：%s；转场：%s。节奏：%s。连续性：轴线%s，光线%s，镜头结束时%s。",
					strings.TrimSpace(shot.ShotTask), h3SlotNames(document, shot.CharacterSlotIDs), strings.TrimSpace(shot.Visual), strings.TrimSpace(shot.Action),
					shot.Camera.ShotSize, shot.Camera.ShotAngle, shot.Camera.Framing, shot.Movement.CameraMovement, shot.Movement.SubjectMovement, shot.Movement.Transition,
					shot.Rhythm, card.Continuity.Axis, card.Continuity.LightDirection, h3ActionEndsSummary(card.Continuity.ActionEnds)),
			)
			if soundscape := h3AudioValue(h3AudioText(shot.Audio)); soundscape != "" {
				audioLines = append(audioLines, fmt.Sprintf("[Scene %d][Shot %d] Soundscape: %s", sceneNumber, shotIndex+1, soundscape))
			}
		}
	}
	if len(audioLines) > 0 {
		visualLines = append(visualLines, "", "Audio:")
		visualLines = append(visualLines, audioLines...)
	}
	return strings.Join(visualLines, "\n")
}

func h3ActionEndsSummary(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if value := strings.TrimSpace(values[key]); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "、")
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
	sections := make([]string, 0, len(segment.SourceSlices))
	for _, slice := range segment.SourceSlices {
		card, ok := h3DirectorCardBySourceKey(document, slice.SourceKey)
		if !ok {
			continue
		}
		lines := []string{
			fmt.Sprintf("原文：%s", card.SourceText),
			fmt.Sprintf("画面：%s", card.VisualContext),
			fmt.Sprintf("人物：%s", h3SlotNames(document, card.CharacterSlotIDs)),
			fmt.Sprintf("动作：%s", card.Action),
			fmt.Sprintf("机位：%s · %s · %s", card.Camera.ShotSize, card.Camera.ShotAngle, card.Camera.Framing),
			fmt.Sprintf("运镜：%s · %s · %s", card.Movement.CameraMovement, card.Movement.SubjectMovement, card.Movement.Transition),
			fmt.Sprintf("节奏：%s", card.Rhythm),
		}
		shotNumber := 0
		for _, reference := range segment.MicroShots {
			if reference.SourceKey != card.SourceKey {
				continue
			}
			shot, found := h3MicroShotByKey(card, reference.MicroShotKey)
			if !found {
				continue
			}
			shotNumber++
			lines = append(lines, fmt.Sprintf(
				"微镜头%d（%s-%s）：%s；画面：%s；动作：%s；机位：%s · %s · %s；运镜：%s · %s · %s",
				shotNumber, h3MillisClock(reference.SegmentStartMS), h3MillisClock(reference.SegmentEndMS),
				shot.ShotTask, shot.Visual, shot.Action,
				shot.Camera.ShotSize, shot.Camera.ShotAngle, shot.Camera.Framing,
				shot.Movement.CameraMovement, shot.Movement.SubjectMovement, shot.Movement.Transition,
			))
		}
		sections = append(sections, strings.Join(lines, "\n"))
	}
	return strings.Join(sections, "\n\n")
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
