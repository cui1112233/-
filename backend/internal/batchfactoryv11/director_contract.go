package batchfactoryv11

import (
	"encoding/json"
	"fmt"
	"strings"
)

var DirectorPrefixKeys = []string{
	"general_anime",
	"modern_conflict",
	"ancient_drama",
	"xuanhuan_action",
	"suspense",
	"era_drama",
}

type TextCompletionRequest struct {
	SystemPrompt string
	UserPrompt   string
	Temperature  float64
	MaxTokens    int
}

type PromptContract struct {
	SystemPrompt  string
	UserPrompt    string
	Temperature   float64
	MaxTokens     int
	Normalization DirectorSettings
}

// AIReasoningPromptConfig is saved with the batch. It is intentionally kept
// in the V11 settings patch so batch, book and VIDEO overrides still resolve
// through the same settings chain. Prompt text is generation guidance only;
// it never bypasses the director output validation.
// PresetSnapshot is resolved by the trusted Node bridge. The browser may only
// choose its ID; the current published body is frozen here with its identity so
// a director revision can always be traced to the actual rule it used.
type PresetSnapshot struct {
	ID                 string `json:"presetId"`
	Name               string `json:"presetName"`
	Slot               string `json:"presetSlot"`
	Version            int    `json:"presetVersion"`
	Key                string `json:"presetKey"`
	Body               string `json:"body"`
	ConstraintCategory string `json:"constraintCategory"`
}

type AIReasoningScope struct {
	Enabled bool     `json:"enabled"`
	Scope   string   `json:"scope"`
	BookIDs []string `json:"bookIds"`
}

type AIReasoningAssetModule struct {
	AIReasoningScope
	Extraction PresetSnapshot `json:"extraction"`
	Character  PresetSnapshot `json:"character"`
	Scene      PresetSnapshot `json:"scene"`
	Prop       PresetSnapshot `json:"prop"`
}

type AIReasoningConstraintModule struct {
	AIReasoningScope
	BaseSetup  AIReasoningBaseSetup `json:"baseSetup"`
	Selections []PresetSnapshot     `json:"selections"`
}

type AIReasoningBaseSetup struct {
	Enabled bool `json:"enabled"`
}

type AIReasoningPromptModule struct {
	AIReasoningScope
	PresetSnapshot
	// Prompt only reads legacy settings saved before typed selection support.
	// The Node bridge no longer accepts or creates it.
	Prompt string `json:"prompt"`
}

// ScriptStoryboardComposition is the trusted snapshot of the normal public
// Script workbench contract. Node resolves these published preset bodies before
// Go receives settings, so Batch Factory never has to call the public chat API.
type ScriptStoryboardComposition struct {
	Segmented         PresetSnapshot `json:"segmented"`
	Shotlist          PresetSnapshot `json:"shotlist"`
	General           PresetSnapshot `json:"general"`
	CharacterFocus    PresetSnapshot `json:"characterFocus"`
	AudioMatch        PresetSnapshot `json:"audioMatch"`
	CardProtocol      PresetSnapshot `json:"cardProtocol"`
	ConstraintWrapper PresetSnapshot `json:"constraintWrapper"`
}

type AIReasoningPromptConfig struct {
	Assets            AIReasoningAssetModule      `json:"assets"`
	Constraints       AIReasoningConstraintModule `json:"constraints"`
	Hook              AIReasoningPromptModule     `json:"hook"`
	OriginalDirector  AIReasoningPromptModule     `json:"originalDirector"`
	ViralDirector     AIReasoningPromptModule     `json:"viralDirector"`
	Video             AIReasoningPromptModule     `json:"video"`
	Visual            AIReasoningPromptModule     `json:"visual"`
	Prefix            AIReasoningPromptModule     `json:"prefix"`
	ScriptComposition ScriptStoryboardComposition `json:"scriptComposition"`
}

const (
	fixedSingleVideoDirectorMaxTokens = 14000
	standardDirectorMaxTokens         = 16000
	audioPlanningDirectorMaxTokens    = 18000
)

// directorOutputTokenBudget keeps the H3 director response proportional to
// the work it has been asked to plan. A single VIDEO still needs enough room
// for the shared asset library and structured shot timeline, while a real
// audio-following run may legitimately need the full long-form budget.
func directorOutputTokenBudget(snapshot DirectorSnapshot) int {
	if snapshot.AudioTargetSeconds > 0 {
		return audioPlanningDirectorMaxTokens
	}
	if snapshot.FixedSingleVideo {
		return fixedSingleVideoDirectorMaxTokens
	}
	return standardDirectorMaxTokens
}

func aiReasoningPromptConfig(patch SettingsPatch) AIReasoningPromptConfig {
	raw, ok := patch["aiPromptConfig"]
	if !ok {
		return AIReasoningPromptConfig{}
	}
	var config AIReasoningPromptConfig
	if json.Unmarshal(raw, &config) != nil {
		return AIReasoningPromptConfig{}
	}
	// Character and scene output are separately selectable V12 renderers. Props
	// remain on the combined extraction contract.
	config.Assets.Prop = PresetSnapshot{}
	return config
}

func (m AIReasoningScope) appliesTo(book Book) bool {
	if !m.Enabled {
		return false
	}
	if m.Scope != "custom" {
		return true
	}
	for _, id := range m.BookIDs {
		if id == book.ID {
			return true
		}
	}
	return false
}

func (m AIReasoningPromptModule) body() string {
	if body := strings.TrimSpace(m.Body); body != "" {
		return body
	}
	return strings.TrimSpace(m.Prompt)
}

func (m AIReasoningPromptModule) appliesTo(book Book) bool {
	return m.AIReasoningScope.appliesTo(book) && m.body() != ""
}

// videoAppliesTo deliberately ignores Enabled. Video prompting is the required
// director input; Enabled was an old UI-only switch and persisted false values
// must not make a selected video preset disappear from a later run.
func (m AIReasoningPromptModule) videoAppliesTo(book Book) bool {
	if m.body() == "" {
		return false
	}
	if m.Scope != "custom" {
		return true
	}
	for _, id := range m.BookIDs {
		if id == book.ID {
			return true
		}
	}
	return false
}

func (m AIReasoningAssetModule) appliesTo(book Book, selection PresetSnapshot) bool {
	return m.AIReasoningScope.appliesTo(book) && strings.TrimSpace(selection.Body) != ""
}

func storyboardDurationLabel(seconds int) string {
	if seconds == 15 {
		return "15s"
	}
	return "10s"
}

func interpolateStoryboardPreset(body string, duration int) string {
	seconds := storyboardDurationLabel(duration)
	limit := "10"
	end := "00:10"
	if duration == 15 {
		limit, end = "15", "00:15"
	}
	replacer := strings.NewReplacer(
		"{10s或15s}", seconds,
		"{X}", limit,
		"{2X}", fmt.Sprintf("%d", duration*2),
		"{duration}", seconds,
		"{结束时间}", end,
	)
	return replacer.Replace(strings.TrimSpace(body))
}

func storyboardFocusNames(values SettingsPatch) []string {
	names := rawStrings(values, "starredCharacterNames")
	seen := map[string]bool{}
	out := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func appendPublicStoryboardComposition(rules []string, config AIReasoningPromptConfig, snapshot DirectorSnapshot) []string {
	composition := config.ScriptComposition
	for _, preset := range []PresetSnapshot{composition.Segmented, composition.General, composition.Shotlist} {
		if body := interpolateStoryboardPreset(preset.Body, snapshot.MaxVideoDuration); body != "" {
			rules = append(rules, body)
		}
	}
	if names := storyboardFocusNames(snapshot.Effective); len(names) > 0 {
		body := strings.NewReplacer(
			"{focusCharacters}", strings.Join(names, "、"),
			"{focusCount}", fmt.Sprintf("%d", len(names)),
		).Replace(strings.TrimSpace(composition.CharacterFocus.Body))
		if body != "" {
			rules = append(rules, body)
		}
	}
	if snapshot.AudioTargetSeconds > 0 {
		duration := snapshot.AudioDurationSeconds
		if duration <= 0 {
			duration = float64(snapshot.AudioTargetSeconds)
		}
		body := strings.NewReplacer(
			"{audioDurationSec}", fmt.Sprintf("%g", duration),
			"{unitMaxSec}", fmt.Sprintf("%d", snapshot.MaxVideoDuration),
			"{duration}", storyboardDurationLabel(snapshot.MaxVideoDuration),
		).Replace(strings.TrimSpace(composition.AudioMatch.Body))
		if body != "" {
			rules = append(rules, body)
		}
	}
	return rules
}

func (m AIReasoningConstraintModule) appliesTo(book Book) bool {
	return m.AIReasoningScope.appliesTo(book)
}

func BuildHookContract(book Book, snapshot DirectorSnapshot) PromptContract {
	system := strings.TrimSpace(`你是短剧爆款开头改写导演。生成一段可人工审核的 Hook。
必须在不改变人物身份、因果关系和安全边界的前提下，把原文中的核心冲突提前并放大。
情绪升级必须表现为可见冲突和行为升级（visible conflict / behavior escalation），不能只增加“非常生气”等形容词。
保留能衔接后续原文的信息。只输出 Hook 正文，不要解释。`)
	if config := aiReasoningPromptConfig(snapshot.Effective); config.Hook.appliesTo(book) {
		system += "\n\n当前爆款开头改编规则：\n" + config.Hook.body()
	}
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   "小说标题：" + book.Title + "\n\n原文：\n" + book.SourceText,
		Temperature:  0.75,
		MaxTokens:    5000,
	}
}

// BuildWorkingFrontRewriteContract creates a reviewable replacement candidate
// for the current book's working front. It deliberately returns prose rather
// than a Hook revision: accepting it is a separate, explicit user action.
func BuildWorkingFrontRewriteContract(book Book, opening PresetSnapshot) PromptContract {
	system := strings.TrimSpace(`你是短剧爆款开头改写编辑。把当前前贴文本改写为更有冲突、悬念和可视化行动的短剧开头。
不得改变人物身份、关键因果、时间关系或安全边界；不得编造后续不存在的重要设定。
保留与原文后续内容衔接所需的信息。只输出可直接替换的正文，不要标题、说明或 Markdown。`)
	if body := strings.TrimSpace(opening.Body); body != "" {
		system += "\n\n当前衍生开篇规则：\n" + body
	}
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   "小说标题：" + book.Title + "\n\n当前前贴文本：\n" + book.SourceText,
		Temperature:  0.75,
		MaxTokens:    5000,
	}
}

// BuildAssetExtractionContract intentionally asks for assets only. It is used
// by the asset modal's regeneration action and must never create or replace
// storyboard/VIDEO records.
func BuildAssetExtractionContract(book Book, snapshot DirectorSnapshot) (PromptContract, error) {
	if strings.TrimSpace(book.SourceText) == "" {
		return PromptContract{}, fmt.Errorf("%w: source text is required", ErrInvalid)
	}
	system := strings.TrimSpace(`你是短剧制作资产提取器。只从小说原文提取实际出现的人物、场景与关键道具，并为每项写可追溯的中文资产事实与可见依据。
不要生成分镜、镜头、VIDEO、改写正文或解释。不要杜撰原文没有出现的重要资产。
只输出一个合法 JSON 对象，格式严格为：
{"characters":[{"name":"人物名","prompt":"身份关系、年龄性别线索、原文明确外形等事实依据"}],"scenes":[{"name":"场景名","prompt":"空间、时段、陈设、氛围等可见特征"}],"props":[{"name":"道具名","prompt":"材质、外观、状态等可见特征"}]}
每个数组可以为空；每个元素必须同时有非空 name 与 prompt。`)
	config := aiReasoningPromptConfig(snapshot.Effective)
	if config.Assets.appliesTo(book, config.Assets.Character) && usesH3CharacterRenderer(config.Assets.Character) {
		system += `

当前选中了 H3 人物提示词。人物处理严格分为两次模型调用：
第一步（当前调用）只锁定每位人物的姓名、身份与关系、性别年龄线索、原文明确外貌、时代与场景依据。characters.prompt 必须是可追溯的事实摘要，不得写最终的完整人物外形提示词。
第二步由 H3 人物提示词预设接收本次全部人物、场景和道具，只调用一次，为每位人物生成完整外形提示词。`
	}
	if config.Assets.appliesTo(book, config.Assets.Extraction) {
		system += "\n\n当前人物场景道具提取规则：\n" + strings.TrimSpace(config.Assets.Extraction.Body)
	}
	if config.Assets.appliesTo(book, config.Assets.Character) && !usesH3CharacterRenderer(config.Assets.Character) {
		system += "\n\n当前人物提示词输出规则：\n" + strings.TrimSpace(config.Assets.Character.Body)
	}
	if config.Assets.appliesTo(book, config.Assets.Scene) && !usesH3SceneRenderer(config.Assets.Scene) {
		system += "\n\n当前场景提示词输出规则：\n" + strings.TrimSpace(config.Assets.Scene.Body)
	}
	payload, err := json.MarshalIndent(map[string]any{"book_id": book.ID, "title": book.Title, "source_text": book.SourceText}, "", "  ")
	if err != nil {
		return PromptContract{}, err
	}
	return PromptContract{SystemPrompt: system, UserPrompt: string(payload), Temperature: 0.2, MaxTokens: 4000}, nil
}

func BuildDirectorContract(book Book, hook HookRevision, snapshot DirectorSnapshot) (PromptContract, error) {
	mode := snapshot.Mode
	if mode != "original" && mode != "viral" {
		return PromptContract{}, fmt.Errorf("%w: unsupported director mode", ErrInvalid)
	}
	if mode == "viral" && (hook.ID == "" || hook.Status != "approved") {
		return PromptContract{}, fmt.Errorf("%w: viral mode requires approved Hook", ErrConflict)
	}
	durationRule := fmt.Sprintf("每个 VIDEO 的 duration_sec 必须为 1-%d 的整数。", snapshot.MaxVideoDuration)
	if snapshot.FixedSingleVideo {
		durationRule = fmt.Sprintf("固定开头已开启：只生产 VIDEO01；其 duration_sec 必须为 1-%d 的整数。其他 storyboard 仍需按原文完整分析并保留，但不会进入视频生产。", snapshot.MaxVideoDuration)
	}
	if rawBool(snapshot.Effective, "audioPlanningEnabled", false) {
		audioSeconds := snapshot.AudioTargetSeconds
		if audioSeconds > 0 {
			minimumVideos := audioMinimumVideoCount(audioSeconds, snapshot.MaxVideoDuration)
			durationRule += fmt.Sprintf(" 分镜规划跟随配音已开启：当前书真实配音约 %.2f 秒，规划整数目标为 %d 秒；至少规划 %d 个 VIDEO，全部 VIDEO 的 duration_sec 总和必须严格等于 %d 秒。按剧情节点、对白/旁白密度和情绪节奏分配各段时长，不要机械平均；不得用重复动作、空镜或静止画面凑时长。", snapshot.AudioDurationSeconds, audioSeconds, minimumVideos, audioSeconds)
		}
	}
	config := aiReasoningPromptConfig(snapshot.Effective)
	requireH3Metadata := usesH3VideoRenderer(config.Video)
	// Video style prefixes are retired. Keep the legacy snapshot field readable
	// for existing books, but never let it constrain a new director revision.
	allowedPrefixKeys := append([]string(nil), DirectorPrefixKeys...)
	system := `你是 Batch Factory V11 的导演。只输出合法 JSON，不要输出 Markdown。
JSON 顶层必须包含 characters、scenes、props、storyboard、source_coverage。
characters/scenes/props 的每项必须包含 name 与 prompt。
storyboard 每项必须包含 duration_sec、characters、props、scene、prefix_key、shots、video_desc。
shots 中的每一项必须包含 start_sec、end_sec、shot_type、camera、description；description 是该镜头可拍、可见的画面动作描述，不能为空。不要把它改写成 shot_description、画面描述或其它字段名。
shots 必须从 0 秒开始连续、无空白无重叠，最后一个 end_sec 必须等于 duration_sec。
人物、场景、道具引用必须来自顶层信息库。prefix_key 只能从指定列表选择。
原文模式按原文顺序完整覆盖；爆款模式以已批准 Hook 开场，并继续覆盖原文。
不得把普通情绪只换成形容词；冲突升级要通过动作、表情、对白和可见行为呈现。
` + durationRule + "\n画幅：" + snapshot.AspectRatio + "\n允许的 prefix_key：" + strings.Join(allowedPrefixKeys, ", ")
	rules := appendPublicStoryboardComposition(nil, config, snapshot)
	if config.Assets.appliesTo(book, config.Assets.Extraction) {
		rules = append(rules, "人物/场景/道具统一提取方案：一次提取原文实际出现的人物、场景与关键道具。\n"+strings.TrimSpace(config.Assets.Extraction.Body))
	}
	if config.Constraints.appliesTo(book) {
		constraintBodies := []string{}
		if config.Constraints.BaseSetup.Enabled {
			constraintBodies = append(constraintBodies, "基础设定：每个 storyboard 必须带入当前情节出现的人物与场景；人物与场景只能引用本次输出的顶层信息库，不能省略场景，也不能凭空新增资产。")
		}
		for _, selection := range config.Constraints.Selections {
			if body := strings.TrimSpace(selection.Body); body != "" {
				constraintBodies = append(constraintBodies, body)
			}
		}
		if len(constraintBodies) > 0 {
			wrapper := interpolateStoryboardPreset(config.ScriptComposition.ConstraintWrapper.Body, snapshot.MaxVideoDuration)
			if wrapper != "" {
				rules = append(rules, wrapper)
			}
			rules = append(rules, "约束设置：以下规则约束本次所有输出，且必须保持可拍、可见。\n"+strings.Join(constraintBodies, "\n"))
		}
	}
	if config.Video.videoAppliesTo(book) {
		rules = append(rules, "视频提示词：以下规则约束本次 VIDEO 分镜规划、镜头、动作、运镜与 storyboard.video_desc。\n"+config.Video.body())
	}
	if requireH3Metadata {
		rules = append(rules, `H3 canonical director metadata（最高优先级）：
每个 storyboard 必须额外输出非空 scene_memory，记录承接上一 VIDEO 的人物位置、服装/道具状态、空间轴线、动作结果和未完成动作；首个 VIDEO 也要写明初始状态。
		每个 shots 项必须额外输出非空 visual_context（该镜头可见的空间、时段、陈设、天气或环境状态）、lighting（具体光源、方向、色温、对比和材质/暗部表现）、rhythm（镜头节奏，例如“克制铺陈”“骤然加速”）和 audio（该镜头的对白、旁白、环境声或“无”）。不得省略字段；没有声音时 audio 必须明确写为“无”。
		scene_memory、visual_context、lighting、rhythm、audio 是后端 H3 VIDEO 编译器的结构化输入，不是展示性说明，必须与 description 的人物、动作、时间线保持一致。`)
	}
	if cardProtocol := interpolateStoryboardPreset(config.ScriptComposition.CardProtocol.Body, snapshot.MaxVideoDuration); cardProtocol != "" {
		rules = append(rules, cardProtocol)
	}
	if len(rules) > 0 {
		system += "\n\n当前批量已启用的 AI 推理规则：\n" + strings.Join(rules, "\n\n")
	}
	// The public workbench persists Markdown cards. V11 preserves the same
	// boundaries and duration semantics, but its durable director output is JSON.
	// This final instruction resolves the transport difference without changing
	// the published public prompt bodies above.
	system += "\n\nV11 JSON 存储适配（最高优先级）：公网协议中的每一张 `### 分镜N` 对应 storyboard 数组中的一个对象；保留其独立卡片边界、剧情连续性与时长规则。不得输出任何 Markdown 标题、前言、分隔线或 JSON 以外的文字，只输出前述合法 JSON。"
	payload := map[string]any{
		"book_id":     book.ID,
		"title":       book.Title,
		"mode":        mode,
		"source_text": book.SourceText,
	}
	if snapshot.AudioTargetSeconds > 0 {
		payload["audio_planning"] = map[string]any{
			"enabled":             true,
			"measured_seconds":    snapshot.AudioDurationSeconds,
			"target_seconds":      snapshot.AudioTargetSeconds,
			"unit_max_seconds":    snapshot.MaxVideoDuration,
			"minimum_video_count": audioMinimumVideoCount(snapshot.AudioTargetSeconds, snapshot.MaxVideoDuration),
		}
	}
	if mode == "viral" {
		payload["approved_hook"] = hook.Text
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return PromptContract{}, err
	}
	temperature := 0.35
	if mode == "viral" {
		temperature = 0.65
	}
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   string(encoded),
		Temperature:  temperature,
		MaxTokens:    directorOutputTokenBudget(snapshot),
		Normalization: DirectorSettings{
			MaxVideoDuration:   snapshot.MaxVideoDuration,
			AudioTargetSeconds: snapshot.AudioTargetSeconds,
			FixedSingleVideo:   snapshot.FixedSingleVideo,
			AspectRatio:        snapshot.AspectRatio,
			AllowedPrefixKeys:  allowedPrefixKeys,
			// 画面提示词必须在已有分镜卡后单独提取，导演阶段只生成
			// 公网“生成剧本”对应的分镜视频提示词与镜头结构。
			RequireVisualPrompt: false,
			RequireH3Metadata:   requireH3Metadata,
		},
	}, nil
}
