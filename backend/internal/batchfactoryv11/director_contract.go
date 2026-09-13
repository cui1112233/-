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
	ID      string `json:"presetId"`
	Name    string `json:"presetName"`
	Slot    string `json:"presetSlot"`
	Version int    `json:"presetVersion"`
	Body    string `json:"body"`
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
	Selections []PresetSnapshot `json:"selections"`
}

type AIReasoningPromptModule struct {
	AIReasoningScope
	PresetSnapshot
	// Prompt only reads legacy settings saved before typed selection support.
	// The Node bridge no longer accepts or creates it.
	Prompt string `json:"prompt"`
}

type AIReasoningPromptConfig struct {
	Assets      AIReasoningAssetModule      `json:"assets"`
	Constraints AIReasoningConstraintModule `json:"constraints"`
	Video       AIReasoningPromptModule     `json:"video"`
	Visual      AIReasoningPromptModule     `json:"visual"`
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

func (m AIReasoningAssetModule) appliesTo(book Book, selection PresetSnapshot) bool {
	return m.AIReasoningScope.appliesTo(book) && strings.TrimSpace(selection.Body) != ""
}

func (m AIReasoningConstraintModule) appliesTo(book Book) bool {
	return m.AIReasoningScope.appliesTo(book)
}

func BuildHookContract(book Book) PromptContract {
	system := strings.TrimSpace(`你是短剧爆款开头改写导演。生成一段可人工审核的 Hook。
必须在不改变人物身份、因果关系和安全边界的前提下，把原文中的核心冲突提前并放大。
情绪升级必须表现为可见冲突和行为升级（visible conflict / behavior escalation），不能只增加“非常生气”等形容词。
保留能衔接后续原文的信息。只输出 Hook 正文，不要解释。`)
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
func BuildWorkingFrontRewriteContract(book Book) PromptContract {
	system := strings.TrimSpace(`你是短剧爆款开头改写编辑。把当前前贴文本改写为更有冲突、悬念和可视化行动的短剧开头。
不得改变人物身份、关键因果、时间关系或安全边界；不得编造后续不存在的重要设定。
保留与原文后续内容衔接所需的信息。只输出可直接替换的正文，不要标题、说明或 Markdown。`)
	return PromptContract{
		SystemPrompt: system,
		UserPrompt:   "小说标题：" + book.Title + "\n\n当前前贴文本：\n" + book.SourceText,
		Temperature:  0.75,
		MaxTokens:    5000,
	}
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
		durationRule = fmt.Sprintf("只输出一个 VIDEO，duration_sec 必须严格等于 %d；后续未覆盖原文不得展示，并在 source_coverage 标记仍有剩余。", snapshot.ExactDuration)
	}
	system := `你是 Batch Factory V11 的导演。只输出合法 JSON，不要输出 Markdown。
JSON 顶层必须包含 characters、scenes、props、storyboard、source_coverage。
characters/scenes/props 的每项必须包含 name 与 prompt。
storyboard 每项必须包含 duration_sec、characters、props、scene、prefix_key、shots、video_desc。
shots 必须从 0 秒开始连续、无空白无重叠，最后一个 end_sec 必须等于 duration_sec。
人物、场景、道具引用必须来自顶层信息库。prefix_key 只能从指定列表选择。
原文模式按原文顺序完整覆盖；爆款模式以已批准 Hook 开场，并继续覆盖原文。
不得把普通情绪只换成形容词；冲突升级要通过动作、表情、对白和可见行为呈现。
` + durationRule + "\n画幅：" + snapshot.AspectRatio + "\n允许的 prefix_key：" + strings.Join(DirectorPrefixKeys, ", ")
	config := aiReasoningPromptConfig(snapshot.Effective)
	rules := []string{}
	if config.Assets.appliesTo(book, config.Assets.Extraction) {
		rules = append(rules, "人物/场景提取方案：只提取原文实际出现的人物与场景。\n"+strings.TrimSpace(config.Assets.Extraction.Body))
	}
	if config.Assets.appliesTo(book, config.Assets.Character) {
		rules = append(rules, "人物资产规则：以下规则只约束 characters 的 prompt。\n"+strings.TrimSpace(config.Assets.Character.Body))
	}
	if config.Assets.appliesTo(book, config.Assets.Scene) {
		rules = append(rules, "场景资产规则：以下规则只约束 scenes 的 prompt。\n"+strings.TrimSpace(config.Assets.Scene.Body))
	}
	if config.Assets.appliesTo(book, config.Assets.Prop) {
		rules = append(rules, "道具资产规则：以下规则只约束 props 的 prompt。\n"+strings.TrimSpace(config.Assets.Prop.Body))
	}
	if config.Constraints.appliesTo(book) {
		for _, selection := range config.Constraints.Selections {
			if body := strings.TrimSpace(selection.Body); body != "" {
				rules = append(rules, "约束设置：以下规则约束本次所有输出，且必须保持可拍、可见。\n"+body)
			}
		}
	}
	if config.Video.appliesTo(book) {
		rules = append(rules, "视频设置：以下规则只用于 storyboard.video_desc 和镜头动作/运镜。\n"+config.Video.body())
	}
	visualEnabled := config.Visual.appliesTo(book)
	if visualEnabled {
		rules = append(rules, "画面设置：以下规则只用于 storyboard.visual_prompt。每个 storyboard 必须输出非空 visual_prompt，它只服务画面图片生成，绝不写入 video_desc。\n"+config.Visual.body())
	}
	if len(rules) > 0 {
		system += "\n\n当前批量已启用的 AI 推理规则：\n" + strings.Join(rules, "\n\n")
	}
	payload := map[string]any{
		"book_id":     book.ID,
		"title":       book.Title,
		"mode":        mode,
		"source_text": book.SourceText,
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
		MaxTokens:    18000,
		Normalization: DirectorSettings{
			MaxVideoDuration:    snapshot.MaxVideoDuration,
			FixedSingleVideo:    snapshot.FixedSingleVideo,
			ExactDuration:       snapshot.ExactDuration,
			AspectRatio:         snapshot.AspectRatio,
			AllowedPrefixKeys:   append([]string(nil), DirectorPrefixKeys...),
			RequireVisualPrompt: visualEnabled,
		},
	}, nil
}
