package batchfactoryv11

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// CompatibilityNotice reports a setting that cannot be applied to the
// current Director/video identity. Notices are read-only: the compiler never
// silently rewrites a user's sparse patch.
type CompatibilityNotice struct {
	Field  string `json:"field"`
	State  string `json:"state"`
	Reason string `json:"reason"`
	Source string `json:"source,omitempty"`
}

type EffectiveSettings struct {
	Values             SettingsPatch         `json:"values"`
	SourceByField      map[string]string     `json:"sourceByField"`
	Compatibility      []CompatibilityNotice `json:"compatibility"`
	SnapshotHash       string                `json:"snapshotHash"`
	DirectorRevisionID string                `json:"directorRevisionId,omitempty"`
}

type PromptComponent struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Content string `json:"content"`
}

type FinalPrompt struct {
	BatchID            string `json:"batchId"`
	BookID             string `json:"bookId"`
	VideoID            string `json:"videoId"`
	DirectorRevisionID string `json:"directorRevisionId"`
	SnapshotHash       string `json:"snapshotHash"`
	// DisplayPrompt is the concise, editable director-card text shown in the
	// workbench. CompiledPrompt is the private submission payload sent to the
	// video provider and may include H3's full visual baseline and safeguards.
	DisplayPrompt string `json:"displayPrompt"`
	// BaseSetupPrompt is the read-only people-and-scenes context displayed with
	// a storyboard card. It is intentionally separate from DisplayPrompt so an
	// edit to a card's VIDEO text cannot overwrite shared asset definitions.
	BaseSetupPrompt       string            `json:"baseSetupPrompt,omitempty"`
	CompiledPrompt        string            `json:"compiledPrompt"`
	Components            []PromptComponent `json:"components"`
	EffectiveSettings     EffectiveSettings `json:"effectiveSettings"`
	DurationSeconds       int               `json:"durationSeconds"`
	ReferenceImageURLs    []string          `json:"referenceImageUrls,omitempty"`
	DowngradedAssetIDs    []string          `json:"downgradedAssetIds,omitempty"`
	CompilationID         string            `json:"compilationId,omitempty"`
	CompilationSegmentKey string            `json:"compilationSegmentKey,omitempty"`
	CompileTrace          *H3CompileTrace   `json:"compileTrace,omitempty"`
	// This is UI metadata only. A placeholder must never enter the VIDEO prompt.
	SmartUnifiedPending bool `json:"smartUnifiedPending,omitempty"`
}

type PromptCompilerService struct{ Store Store }

var systemSettings = SettingsPatch{
	"productionMode":          json.RawMessage(`"original"`),
	"aspectRatio":             json.RawMessage(`"9:16"`),
	"storyboardDurationLimit": json.RawMessage(`10`),
	"maxVideoDuration":        json.RawMessage(`10`),
	"durationMode":            json.RawMessage(`"auto"`),
	"fixedSingleVideo":        json.RawMessage(`false`),
	"prefixMode":              json.RawMessage(`"auto"`),
	"subtitlePolicy":          json.RawMessage(`"forbid-auto-dialogue-subtitle"`),
	"negativeMergeMode":       json.RawMessage(`"append"`),
	"injectBaseSettings":      json.RawMessage(`true`),
	"injectCharacterPrompt":   json.RawMessage(`true`),
	"injectScenePrompt":       json.RawMessage(`true`),
	"injectPropPrompt":        json.RawMessage(`true`),
}

func applyLayer(values SettingsPatch, sources map[string]string, layer SettingsPatch, source string) {
	keys := make([]string, 0, len(layer))
	for key := range layer {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if key == "aiPromptConfig" {
			values[key] = mergePromptConfig(values[key], layer[key])
		} else {
			values[key] = append([]byte(nil), layer[key]...)
		}
		sources[key] = source
	}
}

// mergePromptConfig keeps the batch-level AI modules when a book only changes
// one module (for example its storyboard composition). Arrays deliberately
// replace as a whole, while nested objects overlay their explicit fields.
func mergePromptConfig(base, override json.RawMessage) json.RawMessage {
	var baseObject, overrideObject map[string]json.RawMessage
	if len(base) == 0 || json.Unmarshal(base, &baseObject) != nil || baseObject == nil || json.Unmarshal(override, &overrideObject) != nil || overrideObject == nil {
		return append([]byte(nil), override...)
	}
	merged := make(map[string]json.RawMessage, len(baseObject)+len(overrideObject))
	for key, value := range baseObject {
		merged[key] = append([]byte(nil), value...)
	}
	for key, value := range overrideObject {
		if existing, found := merged[key]; found {
			merged[key] = mergePromptConfig(existing, value)
			continue
		}
		merged[key] = append([]byte(nil), value...)
	}
	encoded, err := json.Marshal(merged)
	if err != nil {
		return append([]byte(nil), override...)
	}
	return encoded
}

func configPatch(raw json.RawMessage) SettingsPatch {
	var direct SettingsPatch
	if json.Unmarshal(raw, &direct) != nil {
		return SettingsPatch{}
	}
	if nested, ok := direct["settings"]; ok {
		var settings SettingsPatch
		if json.Unmarshal(nested, &settings) == nil {
			return settings
		}
	}
	delete(direct, "source")
	return direct
}

func rawStrings(patch SettingsPatch, key string) []string {
	var values []string
	if raw, ok := patch[key]; ok {
		_ = json.Unmarshal(raw, &values)
	}
	return values
}

func videoFromBook(book Book, videoID string) (Video, int, error) {
	for index, video := range book.Videos {
		if video.ID == videoID && video.CompatibilityState == "active" {
			return video, index, nil
		}
	}
	return Video{}, -1, ErrNotFound
}

func snapshotHash(values SettingsPatch, directorRevisionID string) string {
	payload, _ := json.Marshal(struct {
		Values             SettingsPatch `json:"values"`
		DirectorRevisionID string        `json:"directorRevisionId"`
	}{values, directorRevisionID})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (s *PromptCompilerService) ResolveEffective(ctx context.Context, owner, batchID, bookID, videoID string) (EffectiveSettings, Book, Video, int, error) {
	if s == nil || s.Store == nil {
		return EffectiveSettings{}, Book{}, Video{}, -1, ErrUnavailable
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return EffectiveSettings{}, Book{}, Video{}, -1, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return EffectiveSettings{}, Book{}, Video{}, -1, err
	}
	video, ordinal, err := videoFromBook(book, videoID)
	if err != nil {
		return EffectiveSettings{}, Book{}, Video{}, -1, err
	}

	values, sources := SettingsPatch{}, map[string]string{}
	applyLayer(values, sources, systemSettings, "system")
	versionID := rawString(batch.SettingsState.Patch, "versionConfigId", "")
	if versionID != "" {
		versions, listErr := s.Store.ConfigVersions(ctx, owner)
		if listErr != nil {
			return EffectiveSettings{}, Book{}, Video{}, -1, listErr
		}
		for _, version := range versions {
			if version.ID == versionID {
				applyLayer(values, sources, configPatch(version.Config), "config-version:"+version.ID)
				break
			}
		}
	}
	applyLayer(values, sources, batch.SettingsState.Patch, "batch")
	applyLayer(values, sources, book.SettingsState.Patch, "book")
	applyLayer(values, sources, video.SettingsState.Patch, "video")

	directorID := ""
	if book.DirectorRevision != nil {
		directorID = book.DirectorRevision.ID
	}
	notices := []CompatibilityNotice{}
	if directorID == "" {
		notices = append(notices, CompatibilityNotice{Field: "directorRevisionId", State: "missing", Reason: "当前 VIDEO 没有关联 Director revision"})
	}
	duration := rawInt(values, "duration", int(video.DurationSeconds))
	maxDuration := rawInt(values, "storyboardDurationLimit", 10)
	if duration > 0 && maxDuration > 0 && duration > maxDuration {
		notices = append(notices, CompatibilityNotice{Field: "duration", State: "incompatible", Reason: fmt.Sprintf("VIDEO 时长 %ds 超过当前模型上限 %ds", duration, maxDuration), Source: sources["duration"]})
	}
	aspect := rawString(values, "aspectRatio", "9:16")
	if aspect != "9:16" && aspect != "16:9" {
		notices = append(notices, CompatibilityNotice{Field: "aspectRatio", State: "incompatible", Reason: "当前画幅不受支持", Source: sources["aspectRatio"]})
	}

	effective := EffectiveSettings{Values: values, SourceByField: sources, Compatibility: notices, DirectorRevisionID: directorID}
	effective.SnapshotHash = snapshotHash(values, directorID)
	return effective, book, video, ordinal, nil
}

func namedPromptMap(values []NamedPrompt) map[string]string {
	out := make(map[string]string, len(values))
	for _, value := range values {
		out[value.Name] = value.Prompt
	}
	return out
}

func (s *PromptCompilerService) namedPromptMapWithDrafts(ctx context.Context, owner, batchID, category string, values []NamedPrompt) (map[string]string, error) {
	out := namedPromptMap(values)
	if s == nil || s.Store == nil {
		return out, nil
	}
	for _, value := range values {
		key := "asset:" + category + ":" + value.Name
		draft, err := s.Store.GetDraft(ctx, owner, key, "asset-prompt", batchID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, err
		}
		// A found draft is authoritative even when intentionally blank: the
		// user can clear an inherited asset prompt instead of silently restoring it.
		out[value.Name] = strings.TrimSpace(draft.Content)
	}
	return out, nil
}

func selectPrompts(names []string, library map[string]string) string {
	parts := []string{}
	for _, name := range names {
		if prompt := strings.TrimSpace(library[name]); prompt != "" {
			parts = append(parts, name+"："+prompt)
		}
	}
	return strings.Join(parts, "；")
}

type compiledAsset struct {
	ID       string
	Kind     string
	Name     string
	Prompt   string
	ImageURL string
}

func assetKey(kind, name string) string { return kind + "\x00" + name }

func recordsByKindAndName(book Book, fallback map[string][]NamedPrompt) map[string]compiledAsset {
	records := map[string]compiledAsset{}
	for _, asset := range book.AssetRecords {
		if strings.TrimSpace(asset.Name) == "" || strings.TrimSpace(asset.Kind) == "" {
			continue
		}
		records[assetKey(asset.Kind, asset.Name)] = compiledAsset{ID: asset.ID, Kind: asset.Kind, Name: asset.Name, Prompt: strings.TrimSpace(asset.Prompt)}
	}
	for kind, values := range fallback {
		for _, value := range values {
			key := assetKey(kind, value.Name)
			if _, exists := records[key]; !exists {
				records[key] = compiledAsset{Kind: kind, Name: value.Name, Prompt: strings.TrimSpace(value.Prompt)}
			}
		}
	}
	return records
}

func providerAccessibleImageURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	return parsed.String()
}

func (s *PromptCompilerService) primaryAssetImages(ctx context.Context, owner, batchID, bookID string, records map[string]compiledAsset) (map[string]string, error) {
	images := map[string]string{}
	for _, asset := range records {
		if asset.ID == "" {
			continue
		}
		versions, err := s.Store.ListBookAssetImages(ctx, owner, batchID, bookID, asset.ID)
		if err != nil {
			return nil, err
		}
		for _, version := range versions {
			if version.IsPrimary {
				if imageURL := providerAccessibleImageURL(version.URL); imageURL != "" {
					images[asset.ID] = imageURL
				}
				break
			}
		}
	}
	return images, nil
}

func selectedAssets(kind string, names []string, records map[string]compiledAsset, images map[string]string, selectedIDs map[string]bool, hasSelection bool) []compiledAsset {
	selected := make([]compiledAsset, 0, len(names))
	seen := map[string]bool{}
	for _, name := range names {
		asset, ok := records[assetKey(kind, name)]
		if !ok || (hasSelection && !selectedIDs[asset.ID]) {
			continue
		}
		asset.ImageURL = images[asset.ID]
		if strings.TrimSpace(asset.Prompt) == "" && asset.ImageURL == "" {
			continue
		}
		selected = append(selected, asset)
		seen[asset.ID] = true
	}
	if !hasSelection {
		return selected
	}
	additional := make([]compiledAsset, 0)
	for _, asset := range records {
		if asset.Kind != kind || asset.ID == "" || !selectedIDs[asset.ID] || seen[asset.ID] {
			continue
		}
		asset.ImageURL = images[asset.ID]
		if strings.TrimSpace(asset.Prompt) == "" && asset.ImageURL == "" {
			continue
		}
		additional = append(additional, asset)
	}
	sort.Slice(additional, func(i, j int) bool { return additional[i].Name < additional[j].Name })
	selected = append(selected, additional...)
	return selected
}

func baseSetupEnabled(values SettingsPatch) bool {
	raw, exists := values["aiPromptConfig"]
	if !exists {
		return true
	}
	var config struct {
		Constraints struct {
			Enabled   *bool `json:"enabled"`
			BaseSetup struct {
				Enabled *bool `json:"enabled"`
			} `json:"baseSetup"`
		} `json:"constraints"`
	}
	if json.Unmarshal(raw, &config) != nil {
		return true
	}
	if config.Constraints.Enabled != nil && !*config.Constraints.Enabled {
		return false
	}
	if config.Constraints.BaseSetup.Enabled == nil {
		return true
	}
	return *config.Constraints.BaseSetup.Enabled
}

// constraintsApply is deliberately stricter than the historical per-field
// flags. Once an AI-reasoning constraint module is saved and switched off,
// none of its layers (including base assets) may silently survive in VIDEO
// compilation. Legacy books without that module retain their old settings.
func constraintsApply(values SettingsPatch, config AIReasoningPromptConfig, book Book) bool {
	if _, configured := values["aiPromptConfig"]; !configured {
		return true
	}
	return config.Constraints.appliesTo(book)
}

func constraintCategory(selection PresetSnapshot) string {
	if category := strings.TrimSpace(selection.ConstraintCategory); category != "" {
		return category
	}
	return strings.TrimPrefix(strings.TrimSpace(selection.Slot), "script.constraint.")
}

func selectedConstraintBody(config AIReasoningPromptConfig, book Book, category string) string {
	if !config.Constraints.appliesTo(book) {
		return ""
	}
	for _, selection := range config.Constraints.Selections {
		if constraintCategory(selection) == category {
			return strings.TrimSpace(selection.Body)
		}
	}
	return ""
}

const smartUnifiedPrefixPresetID = "script-constraint-prefix-smart-unified"

func smartUnifiedStyleForRevision(book Book, config AIReasoningPromptConfig) string {
	if !config.Constraints.appliesTo(book) || book.DirectorRevision == nil {
		return ""
	}
	for _, selection := range config.Constraints.Selections {
		if constraintCategory(selection) == "prefix" && selection.ID == smartUnifiedPrefixPresetID {
			return strings.TrimSpace(book.DirectorRevision.Output.SmartUnifiedStyle)
		}
	}
	return ""
}

func smartUnifiedSelectedForRevision(book Book, config AIReasoningPromptConfig) bool {
	if !config.Constraints.appliesTo(book) {
		return false
	}
	for _, selection := range config.Constraints.Selections {
		if constraintCategory(selection) == "prefix" && selection.ID == smartUnifiedPrefixPresetID {
			return true
		}
	}
	return false
}

func allEnabledBookAssets(kind string, records map[string]compiledAsset, excluded map[string]bool) []compiledAsset {
	assets := make([]compiledAsset, 0)
	for _, asset := range records {
		if asset.Kind != kind || asset.ID == "" || excluded[asset.ID] || strings.TrimSpace(asset.Prompt) == "" {
			continue
		}
		assets = append(assets, asset)
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].Name < assets[j].Name })
	return assets
}

func selectResolvedPrompts(assets []compiledAsset, included map[string]bool) string {
	parts := []string{}
	for _, asset := range assets {
		if asset.ID != "" && included[asset.ID] {
			continue
		}
		if prompt := strings.TrimSpace(asset.Prompt); prompt != "" {
			parts = append(parts, asset.Name+"："+prompt)
		}
	}
	return strings.Join(parts, "；")
}

func referenceImageLimit(values SettingsPatch) int {
	limit := rawInt(values, "referenceImageLimit", 3)
	if limit < 0 {
		return 0
	}
	if limit > 16 {
		return 16
	}
	return limit
}

func addComponent(out *[]PromptComponent, key, label, content string) {
	content = strings.TrimSpace(content)
	if content != "" {
		*out = append(*out, PromptComponent{Key: key, Label: label, Content: content})
	}
}

func (s *PromptCompilerService) Compile(ctx context.Context, owner, batchID, bookID, videoID string) (FinalPrompt, error) {
	// Preview is deliberately permissive: an old storyboard that no longer
	// matches a newly selected duration rule must still show its compiled
	// prompt and its compatibility warning in the card. Submission keeps the
	// strict validation path below.
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return FinalPrompt{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return FinalPrompt{}, err
	}
	if book.DirectorRevision != nil && book.DirectorRevision.Output.H3Director != nil {
		repository, ok := s.Store.(H3Repository)
		if !ok {
			return FinalPrompt{}, fmt.Errorf("%w: H3 compilation repository is unavailable", ErrUnavailable)
		}
		latest, latestErr := repository.LatestH3VideoCompilation(ctx, owner, batchID, bookID, book.DirectorRevision.ID)
		if latestErr == nil {
			return s.CompileH3ForProduction(ctx, owner, batchID, bookID, videoID, latest.ID, -1)
		}
		if !errors.Is(latestErr, ErrNotFound) {
			return FinalPrompt{}, latestErr
		}
	}
	return s.compile(ctx, owner, batchID, bookID, videoID, -1, false)
}

// CompileForProduction applies all effective-setting compatibility checks
// before a provider task can be created. It is used by adapters that do not
// expose a concrete reference-image limit.
func (s *PromptCompilerService) CompileForProduction(ctx context.Context, owner, batchID, bookID, videoID string) (FinalPrompt, error) {
	return s.compile(ctx, owner, batchID, bookID, videoID, -1, true)
}

// CompileWithReferenceImageLimit is used by production after the concrete
// video model is frozen. Preview compilation keeps the saved per-book limit.
func (s *PromptCompilerService) CompileWithReferenceImageLimit(ctx context.Context, owner, batchID, bookID, videoID string, limit int) (FinalPrompt, error) {
	return s.compile(ctx, owner, batchID, bookID, videoID, limit, true)
}

func (s *PromptCompilerService) compile(ctx context.Context, owner, batchID, bookID, videoID string, frozenReferenceLimit int, strict bool) (FinalPrompt, error) {
	effective, book, video, ordinal, err := s.ResolveEffective(ctx, owner, batchID, bookID, videoID)
	if err != nil {
		return FinalPrompt{}, err
	}
	if effective.DirectorRevisionID == "" || book.DirectorRevision == nil || ordinal >= len(book.DirectorRevision.Output.Storyboard) {
		return FinalPrompt{}, fmt.Errorf("%w: active Director revision is required", ErrConflict)
	}
	if strict {
		for _, notice := range effective.Compatibility {
			if notice.State == "incompatible" {
				return FinalPrompt{}, fmt.Errorf("%w: incompatible effective settings", ErrConflict)
			}
		}
	}
	draft := book.DirectorRevision.Output.Storyboard[ordinal]
	values := effective.Values
	characterRefs := rawStrings(values, "characterRefs")
	if len(characterRefs) == 0 {
		characterRefs = draft.Characters
	}
	sceneRefs := rawStrings(values, "sceneRefs")
	if len(sceneRefs) == 0 && draft.Scene != "" {
		sceneRefs = []string{draft.Scene}
	}
	propRefs := rawStrings(values, "propRefs")
	if len(propRefs) == 0 {
		propRefs = draft.Props
	}

	records := recordsByKindAndName(book, map[string][]NamedPrompt{
		"character": book.Assets.Characters,
		"scene":     book.Assets.Scenes,
		"prop":      book.Assets.Props,
	})
	primaryImages, err := s.primaryAssetImages(ctx, owner, batchID, bookID, records)
	if err != nil {
		return FinalPrompt{}, err
	}
	selection, hasSelection := decodeVideoAssetSelection(video.SettingsState.Patch)
	selectedIDs := selection.effectiveAssetIDSet()
	characters := selectedAssets("character", characterRefs, records, primaryImages, selectedIDs, hasSelection)
	scenes := selectedAssets("scene", sceneRefs, records, primaryImages, selectedIDs, hasSelection)
	props := selectedAssets("prop", propRefs, records, primaryImages, selectedIDs, hasSelection)
	limit := referenceImageLimit(values)
	if frozenReferenceLimit >= 0 {
		limit = frozenReferenceLimit
	}
	referenceImages := []string{}
	for _, visualImage := range append(rawStrings(values, "imageUrls"), rawStrings(values, "referenceImages")...) {
		if url := providerAccessibleImageURL(visualImage); url != "" && len(referenceImages) < limit {
			referenceImages = append(referenceImages, url)
		}
	}
	included := map[string]bool{}
	downgraded := []string{}
	for _, asset := range append(append(characters, scenes...), props...) {
		if asset.ImageURL == "" {
			continue
		}
		if len(referenceImages) < limit {
			referenceImages = append(referenceImages, asset.ImageURL)
			included[asset.ID] = true
		} else if asset.ID != "" {
			downgraded = append(downgraded, asset.ID)
		}
	}
	components := []PromptComponent{}
	// visualPrompt is an image-generation input. It intentionally never enters
	// the final video prompt: image composition and motion/video direction are
	// separate controls, and mixing them makes a regenerated still silently
	// change the video request.
	// Base setup controls text fallback for assets that have no usable image.
	// Existing asset images remain reference inputs regardless of this switch.
	// prefix_key was emitted by the retired video-style-prefix flow. Ignore it
	// for both new and historical director revisions; the active picture-prefix
	// constraint below remains the sole prefix source for VIDEO compilation.
	config := aiReasoningPromptConfig(values)
	h3Renderer := usesH3VideoRenderer(config.Video)
	h3Style := smartUnifiedStyleForRevision(book, config)
	constraintsActive := constraintsApply(values, config, book)
	constraintBody := func(category, legacyEnabledKey, legacyValueKey string) string {
		if category == "prefix" && smartUnifiedSelectedForRevision(book, config) {
			// "智能统一" is a meta prompt that asks the model to analyse the
			// whole book. Its own body is never a VIDEO prefix. Until a director
			// generation produces the analysis, leave this component empty and
			// report SmartUnifiedPending to the UI instead of falling back to it.
			return smartUnifiedStyleForRevision(book, config)
		}
		if constraintsActive {
			if body := selectedConstraintBody(config, book, category); body != "" {
				return body
			}
		}
		if constraintsActive && rawBool(values, legacyEnabledKey, false) {
			return strings.TrimSpace(rawString(values, legacyValueKey, ""))
		}
		return ""
	}
	// The final VIDEO request has one stable, user-visible sequence. Transport
	// fields such as duration and subtitle policy are passed separately to the
	// provider and must not masquerade as prompt content.
	// H3 puts the user-requested smart-unified baseline inside its canonical
	// upload prompt. Keeping it as a standalone prefix would duplicate it.
	if !(h3Renderer && h3Style != "") {
		addComponent(&components, "prefix", "画面前缀", constraintBody("prefix", "prefixEnabled", "prefix"))
	}
	// Base setup is its own user switch. A batch may choose an H3 VIDEO preset
	// before opening the constraint editor; that must retain the legacy default
	// of including asset definitions rather than treating an absent module as off.
	baseSetupActive := baseSetupEnabled(values) && rawBool(values, "injectBaseSettings", true)
	baseSetupPrompt := ""
	if baseSetupActive {
		base := []string{}
		if value := selectResolvedPrompts(characters, included); value != "" {
			base = append(base, "人物："+value)
		}
		if value := selectResolvedPrompts(scenes, included); value != "" {
			base = append(base, "场景："+value)
		}
		baseSetupPrompt = strings.Join(base, "\n")
		if value := selectResolvedPrompts(props, included); value != "" {
			base = append(base, "道具："+value)
		}
		// H3 has its own canonical subject and timeline grammar. Its selected
		// character/scene definitions are already compiled into that grammar, so
		// never prepend the generic base-setup wrapper to an H3 provider prompt.
		if !h3Renderer {
			addComponent(&components, "baseSetup", "基础设定", strings.Join(base, "\n"))
		}
	}
	addComponent(&components, "quality", "画面约束提示词", constraintBody("quality", "qualityEnabled", "quality"))
	displayPrompt := storyboardVideoPrompt(draft)
	videoPrompt := displayPrompt
	if h3Renderer {
		// Base setup owns asset-definition injection only. The director's own
		// role names, actions and shot context stay in the timeline regardless.
		h3Characters, h3Scenes := characters, scenes
		if !baseSetupActive {
			h3Characters, h3Scenes = nil, nil
		}
		videoPrompt = compileH3VideoPrompt(draft, h3Characters, h3Scenes, h3Style)
	}
	// A video-scope edit is the sole exception: it is an intentional user
	// replacement for this one card.  Stored pre-fix video_desc summaries are
	// not overrides and must never win over the director's verified timeline.
	if override, ok := optionalPromptValue(video.SettingsState.Patch, "videoPrompt"); ok {
		videoPrompt = override
		displayPrompt = override
	}
	videoLabel := "视频提示词"
	if h3Renderer {
		// H3's canonical output already has a top-level grammar. Adding the V11
		// card label would make the provider receive a wrapper H3 never used.
		videoLabel = ""
	}
	addComponent(&components, "video", videoLabel, videoPrompt)
	addComponent(&components, "restriction", "画面限制", constraintBody("restriction", "restrictionEnabled", "restriction"))
	addComponent(&components, "negative", "负面提示词", constraintBody("negative", "negativeEnabled", "negative"))
	duration := rawInt(values, "duration", int(video.DurationSeconds))

	lines := make([]string, 0, len(components))
	for _, component := range components {
		if component.Label == "" {
			lines = append(lines, component.Content)
			continue
		}
		lines = append(lines, component.Label+"："+component.Content)
	}
	compiled := strings.Join(lines, "\n")
	return FinalPrompt{BatchID: batchID, BookID: bookID, VideoID: videoID, DirectorRevisionID: effective.DirectorRevisionID, SnapshotHash: effective.SnapshotHash, DisplayPrompt: displayPrompt, BaseSetupPrompt: baseSetupPrompt, CompiledPrompt: compiled, Components: components, EffectiveSettings: effective, DurationSeconds: duration, ReferenceImageURLs: referenceImages, DowngradedAssetIDs: downgraded, SmartUnifiedPending: smartUnifiedSelectedForRevision(book, config) && smartUnifiedStyleForRevision(book, config) == ""}, nil
}
