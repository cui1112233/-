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
	BatchID            string            `json:"batchId"`
	BookID             string            `json:"bookId"`
	VideoID            string            `json:"videoId"`
	DirectorRevisionID string            `json:"directorRevisionId"`
	SnapshotHash       string            `json:"snapshotHash"`
	CompiledPrompt     string            `json:"compiledPrompt"`
	Components         []PromptComponent `json:"components"`
	EffectiveSettings  EffectiveSettings `json:"effectiveSettings"`
	DurationSeconds    int               `json:"durationSeconds"`
	ReferenceImageURLs []string          `json:"referenceImageUrls,omitempty"`
	DowngradedAssetIDs []string          `json:"downgradedAssetIds,omitempty"`
}

type PromptCompilerService struct{ Store Store }

var systemSettings = SettingsPatch{
	"productionMode":        json.RawMessage(`"original"`),
	"aspectRatio":           json.RawMessage(`"9:16"`),
	"durationMode":          json.RawMessage(`"auto"`),
	"fixedSingleVideo":      json.RawMessage(`false`),
	"prefixMode":            json.RawMessage(`"auto"`),
	"subtitlePolicy":        json.RawMessage(`"forbid-auto-dialogue-subtitle"`),
	"negativeMergeMode":     json.RawMessage(`"append"`),
	"injectBaseSettings":    json.RawMessage(`true`),
	"injectCharacterPrompt": json.RawMessage(`true`),
	"injectScenePrompt":     json.RawMessage(`true`),
	"injectPropPrompt":      json.RawMessage(`true`),
}

func applyLayer(values SettingsPatch, sources map[string]string, layer SettingsPatch, source string) {
	keys := make([]string, 0, len(layer))
	for key := range layer {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		values[key] = append([]byte(nil), layer[key]...)
		sources[key] = source
	}
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
	maxDuration := rawInt(values, "maxVideoDuration", rawInt(values, "modelMaxDuration", 60))
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

func selectedAssets(kind string, names []string, records map[string]compiledAsset, images map[string]string) []compiledAsset {
	selected := make([]compiledAsset, 0, len(names))
	for _, name := range names {
		asset, ok := records[assetKey(kind, name)]
		if !ok || strings.TrimSpace(asset.Prompt) == "" {
			continue
		}
		asset.ImageURL = images[asset.ID]
		selected = append(selected, asset)
	}
	return selected
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
	return s.compile(ctx, owner, batchID, bookID, videoID, -1)
}

// CompileWithReferenceImageLimit is used by production after the concrete
// video model is frozen. Preview compilation keeps the saved per-book limit.
func (s *PromptCompilerService) CompileWithReferenceImageLimit(ctx context.Context, owner, batchID, bookID, videoID string, limit int) (FinalPrompt, error) {
	return s.compile(ctx, owner, batchID, bookID, videoID, limit)
}

func (s *PromptCompilerService) compile(ctx context.Context, owner, batchID, bookID, videoID string, frozenReferenceLimit int) (FinalPrompt, error) {
	effective, book, video, ordinal, err := s.ResolveEffective(ctx, owner, batchID, bookID, videoID)
	if err != nil {
		return FinalPrompt{}, err
	}
	if effective.DirectorRevisionID == "" || book.DirectorRevision == nil || ordinal >= len(book.DirectorRevision.Output.Storyboard) {
		return FinalPrompt{}, fmt.Errorf("%w: active Director revision is required", ErrConflict)
	}
	for _, notice := range effective.Compatibility {
		if notice.State == "incompatible" {
			return FinalPrompt{}, fmt.Errorf("%w: incompatible effective settings", ErrConflict)
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
	characters := selectedAssets("character", characterRefs, records, primaryImages)
	scenes := selectedAssets("scene", sceneRefs, records, primaryImages)
	props := selectedAssets("prop", propRefs, records, primaryImages)
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
	addComponent(&components, "video", "视频提示词", rawString(values, "videoPrompt", video.VideoPrompt))
	// visualPrompt is an image-generation input. It intentionally never enters
	// the final video prompt: image composition and motion/video direction are
	// separate controls, and mixing them makes a regenerated still silently
	// change the video request.
	if rawBool(values, "injectBaseSettings", true) {
		addComponent(&components, "characters", "人物设定", selectResolvedPrompts(characters, included))
		addComponent(&components, "scene", "场景设定", selectResolvedPrompts(scenes, included))
	}
	if rawBool(values, "injectCharacterPrompt", true) {
		addComponent(&components, "characterPrompt", "人物 Prompt", selectResolvedPrompts(characters, included))
	}
	if rawBool(values, "injectScenePrompt", true) {
		addComponent(&components, "scenePrompt", "场景 Prompt", selectResolvedPrompts(scenes, included))
	}
	if rawBool(values, "injectPropPrompt", true) {
		addComponent(&components, "propPrompt", "道具 Prompt", selectResolvedPrompts(props, included))
	}
	prefix := draft.PrefixKey
	if rawBool(values, "prefixEnabled", false) {
		prefix = strings.TrimSpace(strings.Join([]string{prefix, rawString(values, "prefix", "")}, "；"))
	}
	addComponent(&components, "prefix", "画面前缀", prefix)
	if rawBool(values, "qualityEnabled", false) {
		addComponent(&components, "quality", "画质约束", rawString(values, "quality", ""))
	}
	if rawBool(values, "restrictionEnabled", false) {
		addComponent(&components, "restriction", "画面限制", rawString(values, "restriction", ""))
	}
	if rawBool(values, "negativeEnabled", false) {
		addComponent(&components, "negative", "负面提示词", rawString(values, "negative", ""))
	}
	addComponent(&components, "subtitle", "字幕策略", rawString(values, "subtitlePolicy", "forbid-auto-dialogue-subtitle"))
	duration := rawInt(values, "duration", int(video.DurationSeconds))
	addComponent(&components, "spec", "视频规格", fmt.Sprintf("画幅 %s；时长 %d 秒", rawString(values, "aspectRatio", "9:16"), duration))

	lines := make([]string, 0, len(components))
	for _, component := range components {
		lines = append(lines, component.Label+"："+component.Content)
	}
	compiled := strings.Join(lines, "\n")
	return FinalPrompt{BatchID: batchID, BookID: bookID, VideoID: videoID, DirectorRevisionID: effective.DirectorRevisionID, SnapshotHash: effective.SnapshotHash, CompiledPrompt: compiled, Components: components, EffectiveSettings: effective, DurationSeconds: duration, ReferenceImageURLs: referenceImages, DowngradedAssetIDs: downgraded}, nil
}
