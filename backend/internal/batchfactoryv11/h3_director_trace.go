package batchfactoryv11

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	h3DirectorSchemaV1  = "h3-director/v1"
	h3DirectorWriterV12 = "batch-factory-v12"
)

// H3VideoSource is the frozen, processed video-source revision used by H3.
// It is deliberately separate from a book's unprocessed full novel text.
type H3VideoSource struct {
	Revision string
	Hash     string
	Text     string
}

type H3Character struct {
	AssetID       string   `json:"asset_id,omitempty"`
	AssetRevision int64    `json:"asset_revision,omitempty"`
	SlotID        string   `json:"slot_id"`
	SlotToken     string   `json:"slot_token,omitempty"`
	CanonicalName string   `json:"canonical_name"`
	Aliases       []string `json:"aliases,omitempty"`
	Appearance    string   `json:"appearance,omitempty"`
}

type H3Camera struct {
	ShotSize  string `json:"shot_size"`
	ShotAngle string `json:"shot_angle"`
	Framing   string `json:"framing"`
}

type H3Movement struct {
	CameraMovement  string `json:"camera_movement"`
	SubjectMovement string `json:"subject_movement"`
	Transition      string `json:"transition"`
}

type H3Audio struct {
	Ambient       string   `json:"ambient,omitempty"`
	Foley         string   `json:"foley,omitempty"`
	Mode          string   `json:"mode"`
	SpeakerSlotID string   `json:"speaker_slot_id"`
	Dialogue      string   `json:"dialogue"`
	VoiceOver     string   `json:"voice_over"`
	SoundEffects  []string `json:"sound_effects"`
	Ambience      []string `json:"ambience"`
}

type H3SceneMemory struct {
	TimeWeather       string            `json:"time_weather,omitempty"`
	WardrobeStates    map[string]string `json:"wardrobe_states,omitempty"`
	AppearanceStates  map[string]string `json:"appearance_states,omitempty"`
	EnvironmentStates map[string]string `json:"environment_states,omitempty"`
	EmotionStates     map[string]string `json:"emotion_states,omitempty"`
	SceneID           string            `json:"scene_id"`
	Location          string            `json:"location"`
	Axis              string            `json:"axis"`
	LightDirection    string            `json:"light_direction"`
	Positions         map[string]string `json:"positions"`
	Facings           map[string]string `json:"facings"`
	Gazes             map[string]string `json:"gazes"`
	HeldProps         map[string]string `json:"held_props"`
	ActionEnds        map[string]string `json:"action_ends"`
}

// H3SemanticNumber accepts the two scalar forms commonly emitted by text
// models while keeping the persisted H3 document numeric and deterministic.
type H3SemanticNumber float64

func (number *H3SemanticNumber) UnmarshalJSON(raw []byte) error {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return fmt.Errorf("decode numeric string: %w", err)
		}
		trimmed = strings.TrimSpace(text)
	}
	if trimmed == "" {
		return fmt.Errorf("must be a finite number, got %q", trimmed)
	}
	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("must be a finite number, got %q", trimmed)
	}
	*number = H3SemanticNumber(value)
	return nil
}

type H3Participant struct {
	SlotID   string `json:"slot_id"`
	Position string `json:"position"`
	Facing   string `json:"facing"`
	Gaze     string `json:"gaze"`
	Action   string `json:"action"`
	Reaction string `json:"reaction"`
	EndState string `json:"end_state"`
}

type H3ActionBeats struct {
	Initial     string `json:"initial"`
	Onset       string `json:"onset"`
	Development string `json:"development"`
	Reaction    string `json:"reaction"`
	Result      string `json:"result"`
}

type H3ContextSummary struct {
	Previous  string `json:"previous"`
	Current   string `json:"current"`
	NextSetup string `json:"next_setup"`
}

type H3MicroShot struct {
	ShotSize         string           `json:"shot_size,omitempty"`
	CameraAngle      string           `json:"camera_angle,omitempty"`
	Composition      string           `json:"composition,omitempty"`
	CameraMovement   string           `json:"camera_movement,omitempty"`
	Participants     []H3Participant  `json:"participants,omitempty"`
	ActionBeats      *H3ActionBeats   `json:"action_beats,omitempty"`
	PropChanges      string           `json:"prop_changes,omitempty"`
	Lighting         string           `json:"lighting,omitempty"`
	EndState         string           `json:"end_state,omitempty"`
	ContinuityIn     *H3SceneMemory   `json:"continuity_in,omitempty"`
	ContinuityOut    *H3SceneMemory   `json:"continuity_out,omitempty"`
	MicroShotKey     string           `json:"micro_shot_key"`
	Weight           H3SemanticNumber `json:"weight"`
	ShotTask         string           `json:"shot_task"`
	Visual           string           `json:"visual"`
	Action           string           `json:"action"`
	CharacterSlotIDs []string         `json:"character_slot_ids"`
	Camera           H3Camera         `json:"camera"`
	Movement         H3Movement       `json:"movement"`
	Rhythm           string           `json:"rhythm"`
	Audio            H3Audio          `json:"audio"`
}

type H3DirectorCard struct {
	SceneDescription      string            `json:"scene_description,omitempty"`
	Duration              H3SemanticNumber  `json:"duration,omitempty"`
	TemporaryCharacterIDs []string          `json:"temporary_character_ids"`
	ContextSummary        *H3ContextSummary `json:"context_summary,omitempty"`
	ContinuityIn          *H3SceneMemory    `json:"continuity_in,omitempty"`
	ContinuityOut         *H3SceneMemory    `json:"continuity_out,omitempty"`
	SourceIndex           int               `json:"source_index"`
	SourceKey             string            `json:"source_key"`
	SourceText            string            `json:"source_text"`
	SourceTextHash        string            `json:"source_text_hash"`
	VisualContext         string            `json:"visual_context"`
	PreferredDuration     H3SemanticNumber  `json:"preferred_duration"`
	DurationWeight        H3SemanticNumber  `json:"duration_weight"`
	CharacterSlotIDs      []string          `json:"character_slot_ids"`
	Action                string            `json:"action"`
	Camera                H3Camera          `json:"camera"`
	Movement              H3Movement        `json:"movement"`
	Rhythm                string            `json:"rhythm"`
	Audio                 H3Audio           `json:"audio"`
	Continuity            H3SceneMemory     `json:"continuity"`
	MicroShots            []H3MicroShot     `json:"micro_shots"`
}

type H3DirectorDocument struct {
	SchemaVersion                string           `json:"schema_version"`
	Writer                       string           `json:"writer"`
	VideoSourceRevision          string           `json:"video_source_revision"`
	VideoSourceHash              string           `json:"video_source_hash"`
	VideoSourceNonEmptyLineCount int              `json:"video_source_non_empty_line_count"`
	DirectorPresetKey            string           `json:"director_preset_key"`
	DirectorPresetRevision       int64            `json:"director_preset_revision"`
	VisualBaseline               any              `json:"visual_baseline"`
	CharacterRoster              []H3Character    `json:"character_roster"`
	DirectorCards                []H3DirectorCard `json:"director_cards"`
}

func h3VisualBaselineText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case nil:
		return ""
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(encoded))
	}
}

func ParseH3DirectorDocument(raw json.RawMessage, source H3VideoSource) (H3DirectorDocument, error) {
	var document H3DirectorDocument
	if len(raw) == 0 {
		return document, fmt.Errorf("%w: H3 director document is empty", ErrInvalid)
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return document, fmt.Errorf("%w: decode H3 director document: %v", ErrInvalid, err)
	}
	if document.SchemaVersion != h3DirectorSchemaV1 {
		return document, fmt.Errorf("%w: schema_version must be %s", ErrInvalid, h3DirectorSchemaV1)
	}
	if document.Writer != h3DirectorWriterV12 {
		return document, fmt.Errorf("%w: writer must be %s", ErrInvalid, h3DirectorWriterV12)
	}
	if strings.TrimSpace(source.Revision) == "" || document.VideoSourceRevision != source.Revision {
		return document, fmt.Errorf("%w: video_source_revision does not match frozen source", ErrInvalid)
	}
	if strings.TrimSpace(source.Hash) == "" || document.VideoSourceHash != source.Hash {
		return document, fmt.Errorf("%w: video_source_hash does not match frozen source", ErrInvalid)
	}

	lines := h3NonEmptyVideoSourceLines(source.Text)
	if len(lines) == 0 {
		return document, fmt.Errorf("%w: processed video source has no non-empty lines", ErrInvalid)
	}
	if len(document.DirectorCards) != len(lines) {
		return document, fmt.Errorf("%w: director card count %d does not match processed video source line count %d", ErrInvalid, len(document.DirectorCards), len(lines))
	}
	for index := range lines {
		card := document.DirectorCards[index]
		if card.SourceIndex != index+1 {
			return document, fmt.Errorf("%w: director_cards[%d].source_index must be %d", ErrInvalid, index, index+1)
		}
		if strings.TrimSpace(card.SourceKey) == "" {
			return document, fmt.Errorf("%w: director_cards[%d].source_key is required", ErrInvalid, index)
		}
		if card.SourceText != lines[index] {
			return document, fmt.Errorf("%w: director_cards[%d].source_text does not match processed video source line %d", ErrInvalid, index, index+1)
		}
		document.DirectorCards[index].SourceTextHash = fmt.Sprintf("%x", sha256.Sum256([]byte(lines[index])))
	}
	document.VideoSourceNonEmptyLineCount = len(lines)
	if err := validateH3DirectorDocument(raw, document); err != nil {
		return H3DirectorDocument{}, err
	}
	return document, nil
}

func validateH3DirectorDocument(raw json.RawMessage, document H3DirectorDocument) error {
	if err := validateH3DirectorIdentityUniqueness(document); err != nil {
		return err
	}
	roster := make(map[string]struct{}, len(document.CharacterRoster))
	for index, character := range document.CharacterRoster {
		slotID := strings.TrimSpace(character.SlotID)
		if slotID == "" {
			return fmt.Errorf("%w: character_roster[%d].slot_id is required", ErrInvalid, index)
		}
		if strings.TrimSpace(character.CanonicalName) == "" {
			return fmt.Errorf("%w: character_roster[%d].canonical_name is required", ErrInvalid, index)
		}
		if strings.TrimSpace(character.Appearance) == "" {
			return fmt.Errorf("%w: character_roster[%d].appearance is required", ErrInvalid, index)
		}
		if _, exists := roster[slotID]; exists {
			return fmt.Errorf("%w: character_roster[%d].slot_id duplicates %s", ErrInvalid, index, slotID)
		}
		roster[slotID] = struct{}{}
	}

	var envelope struct {
		DirectorCards []json.RawMessage `json:"director_cards"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("%w: decode H3 director card envelope: %v", ErrInvalid, err)
	}
	if len(envelope.DirectorCards) != len(document.DirectorCards) {
		return fmt.Errorf("%w: director_cards raw/decoded count mismatch", ErrInvalid)
	}
	for index, card := range document.DirectorCards {
		path := fmt.Sprintf("director_cards[%d]", index)
		rawCard, err := h3RawObject(envelope.DirectorCards[index], path)
		if err != nil {
			return err
		}
		if err := h3RequireArrayField(rawCard, "character_slot_ids", path+".character_slot_ids"); err != nil {
			return err
		}
		if err := h3ValidateSlots(card.CharacterSlotIDs, roster, path+".character_slot_ids"); err != nil {
			return err
		}
		if card.PreferredDuration <= 0 {
			return fmt.Errorf("%w: %s.preferred_duration must be greater than zero", ErrInvalid, path)
		}
		if card.DurationWeight <= 0 {
			return fmt.Errorf("%w: %s.duration_weight must be greater than zero", ErrInvalid, path)
		}
		if err := h3ValidateCardFields(card, roster, path); err != nil {
			return err
		}

		var cardEnvelope struct {
			MicroShots []json.RawMessage `json:"micro_shots"`
		}
		if err := json.Unmarshal(envelope.DirectorCards[index], &cardEnvelope); err != nil {
			return fmt.Errorf("%w: decode %s.micro_shots: %v", ErrInvalid, path, err)
		}
		if len(cardEnvelope.MicroShots) != len(card.MicroShots) {
			return fmt.Errorf("%w: %s.micro_shots raw/decoded count mismatch", ErrInvalid, path)
		}
		for shotIndex, shot := range card.MicroShots {
			shotPath := fmt.Sprintf("%s.micro_shots[%d]", path, shotIndex)
			rawShot, err := h3RawObject(cardEnvelope.MicroShots[shotIndex], shotPath)
			if err != nil {
				return err
			}
			if err := h3RequireArrayField(rawShot, "character_slot_ids", shotPath+".character_slot_ids"); err != nil {
				return err
			}
			if err := h3ValidateSlots(shot.CharacterSlotIDs, roster, shotPath+".character_slot_ids"); err != nil {
				return err
			}
			for participantIndex, participant := range shot.Participants {
				if _, exists := roster[participant.SlotID]; !exists {
					return fmt.Errorf("%w: %s.participants[%d] unknown slot %s", ErrInvalid, shotPath, participantIndex, participant.SlotID)
				}
			}
			if err := h3ValidateMicroShot(shot, shotPath); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateH3DirectorIdentityUniqueness(document H3DirectorDocument) error {
	sourceKeys := make(map[string]struct{}, len(document.DirectorCards))
	for cardIndex, card := range document.DirectorCards {
		cardPath := fmt.Sprintf("director_cards[%d]", cardIndex)
		sourceKey := strings.TrimSpace(card.SourceKey)
		if sourceKey == "" {
			return fmt.Errorf("%w: %s.source_key is required", ErrInvalid, cardPath)
		}
		if _, exists := sourceKeys[sourceKey]; exists {
			return fmt.Errorf("%w: %s.source_key duplicates %s", ErrInvalid, cardPath, sourceKey)
		}
		sourceKeys[sourceKey] = struct{}{}
		microShotKeys := make(map[string]struct{}, len(card.MicroShots))
		for shotIndex, shot := range card.MicroShots {
			shotPath := fmt.Sprintf("%s.micro_shots[%d]", cardPath, shotIndex)
			microShotKey := strings.TrimSpace(shot.MicroShotKey)
			if microShotKey == "" {
				return fmt.Errorf("%w: %s.micro_shot_key is required", ErrInvalid, shotPath)
			}
			if _, exists := microShotKeys[microShotKey]; exists {
				return fmt.Errorf("%w: %s.micro_shot_key duplicates %s", ErrInvalid, shotPath, microShotKey)
			}
			microShotKeys[microShotKey] = struct{}{}
		}
	}
	return nil
}

func h3ValidateCardFields(card H3DirectorCard, roster map[string]struct{}, path string) error {
	for field, value := range map[string]string{
		"visual_context":             card.VisualContext,
		"action":                     card.Action,
		"camera.shot_size":           card.Camera.ShotSize,
		"camera.shot_angle":          card.Camera.ShotAngle,
		"camera.framing":             card.Camera.Framing,
		"movement.camera_movement":   card.Movement.CameraMovement,
		"movement.subject_movement":  card.Movement.SubjectMovement,
		"movement.transition":        card.Movement.Transition,
		"rhythm":                     card.Rhythm,
		"audio.mode":                 card.Audio.Mode,
		"continuity.scene_id":        card.Continuity.SceneID,
		"continuity.location":        card.Continuity.Location,
		"continuity.axis":            card.Continuity.Axis,
		"continuity.light_direction": card.Continuity.LightDirection,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s.%s is required", ErrInvalid, path, field)
		}
	}
	for field, values := range map[string]map[string]string{
		"positions":   card.Continuity.Positions,
		"facings":     card.Continuity.Facings,
		"gazes":       card.Continuity.Gazes,
		"held_props":  card.Continuity.HeldProps,
		"action_ends": card.Continuity.ActionEnds,
	} {
		if values == nil {
			return fmt.Errorf("%w: %s.continuity.%s is required", ErrInvalid, path, field)
		}
		for slotID := range values {
			if _, exists := roster[slotID]; !exists {
				return fmt.Errorf("%w: %s.continuity.%s unknown slot %s", ErrInvalid, path, field, slotID)
			}
		}
	}
	if card.Audio.SoundEffects == nil || card.Audio.Ambience == nil {
		return fmt.Errorf("%w: %s.audio sound_effects and ambience are required", ErrInvalid, path)
	}
	if len(card.MicroShots) == 0 {
		return fmt.Errorf("%w: %s.micro_shots must contain at least one item", ErrInvalid, path)
	}
	return nil
}

func h3ValidateMicroShot(shot H3MicroShot, path string) error {
	if shot.Weight <= 0 {
		return fmt.Errorf("%w: %s.weight must be greater than zero", ErrInvalid, path)
	}
	for field, value := range map[string]string{
		"micro_shot_key":            shot.MicroShotKey,
		"shot_task":                 shot.ShotTask,
		"visual":                    shot.Visual,
		"action":                    shot.Action,
		"camera.shot_size":          shot.Camera.ShotSize,
		"camera.shot_angle":         shot.Camera.ShotAngle,
		"camera.framing":            shot.Camera.Framing,
		"movement.camera_movement":  shot.Movement.CameraMovement,
		"movement.subject_movement": shot.Movement.SubjectMovement,
		"movement.transition":       shot.Movement.Transition,
		"rhythm":                    shot.Rhythm,
		"audio.mode":                shot.Audio.Mode,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%w: %s.%s is required", ErrInvalid, path, field)
		}
	}
	if shot.Audio.SoundEffects == nil || shot.Audio.Ambience == nil {
		return fmt.Errorf("%w: %s.audio sound_effects and ambience are required", ErrInvalid, path)
	}
	return nil
}

func h3ValidateSlots(values []string, roster map[string]struct{}, path string) error {
	for index, slotID := range values {
		slotID = strings.TrimSpace(slotID)
		if slotID == "" {
			return fmt.Errorf("%w: %s[%d] must not be empty", ErrInvalid, path, index)
		}
		if _, exists := roster[slotID]; !exists {
			return fmt.Errorf("%w: %s[%d] unknown slot %s", ErrInvalid, path, index, slotID)
		}
	}
	return nil
}

func h3RawObject(raw json.RawMessage, path string) (map[string]json.RawMessage, error) {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fmt.Errorf("%w: %s must be an object", ErrInvalid, path)
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("%w: decode %s: %v", ErrInvalid, path, err)
	}
	return value, nil
}

func h3RequireArrayField(object map[string]json.RawMessage, field, path string) error {
	raw, exists := object[field]
	if !exists {
		return fmt.Errorf("%w: %s is required", ErrInvalid, path)
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return fmt.Errorf("%w: %s must be an array", ErrInvalid, path)
	}
	return nil
}

func h3NonEmptyVideoSourceLines(text string) []string {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	parts := strings.Split(normalized, "\n")
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		if line := strings.TrimSpace(part); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
