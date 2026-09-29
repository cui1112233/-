package batchfactoryv11

import (
	"fmt"
	"strings"
)

// h3VideoRendererKey is the published-video-preset key that opts a batch into
// the H3 canonical VIDEO renderer.  The key is deliberately stable: preset
// names and bodies can be revised by an administrator without changing the
// persisted renderer contract for an existing batch.
const h3VideoRendererKey = "h3-video-normal"

func usesH3VideoRenderer(selection AIReasoningPromptModule) bool {
	presetID := strings.TrimSpace(selection.ID)
	if presetID != "" {
		return strings.EqualFold(presetID, "batch-video-h3-director")
	}
	return strings.EqualFold(strings.TrimSpace(selection.Key), h3VideoRendererKey)
}

// compileH3VideoPrompt 只产出 H3 骨架（【视听呈现】+【H3视听时间轴】）。
// 画风（智能统一）与【人物定义】不再由这里注入，而是挪到外层由约束开关统一控制，
// 与剧本生成的“程序按开关注入”公式保持一致。characters 仍传入，供时间轴里的
// <Subject N> 指代使用（基础设定开关关闭时外层传 nil，时间轴也就不做指代）。
func compileH3VideoPrompt(draft DirectorVideo, characters, scenes []compiledAsset) string {
	subjects := h3Subjects(characters)
	parts := make([]string, 0, 2)
	parts = append(parts, "【视听呈现】\n视觉层只呈现人物、环境、动作、道具、光影以及原文明确定义的信息载体。\n人物对白通过人物声音与口型表现；旁白、画外音和内心独白只存在于听觉层。\n\nNo on-screen text unless explicitly required by the story.\nSpoken dialogue and voiceover are audio only.")
	if timeline := h3StructuredTimeline(draft, scenes, subjects); timeline != "" {
		parts = append(parts, "【H3视听时间轴】\n"+timeline)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

type h3Subject struct {
	Index  int
	Name   string
	Prompt string
}

func h3Subjects(characters []compiledAsset) []h3Subject {
	out := make([]h3Subject, 0, len(characters))
	for _, character := range characters {
		name := strings.TrimSpace(character.Name)
		if name == "" {
			continue
		}
		out = append(out, h3Subject{Index: len(out) + 1, Name: name, Prompt: strings.TrimSpace(character.Prompt)})
	}
	return out
}

func h3SubjectDefinitions(subjects []h3Subject) string {
	lines := make([]string, 0, len(subjects)+1)
	for _, subject := range subjects {
		row := fmt.Sprintf("<Subject %d> %s", subject.Index, subject.Name)
		if subject.Prompt != "" {
			row += "：" + subject.Prompt
		}
		lines = append(lines, row)
	}
	if len(lines) == 0 {
		return ""
	}
	return "【人物定义】\n" + strings.Join(lines, "\n")
}

func h3StructuredTimeline(draft DirectorVideo, scenes []compiledAsset, subjects []h3Subject) string {
	duration := draft.DurationSec
	if duration <= 0 && len(draft.Shots) > 0 {
		duration = draft.Shots[len(draft.Shots)-1].EndSec
	}
	if duration <= 0 {
		return ""
	}
	lines := []string{fmt.Sprintf("00:00-%s", h3Clock(duration)), "", "【画面】"}
	baseScene := h3SceneDescription(draft.Scene, scenes)
	activeScene := ""
	sceneShotNumber := 0
	sceneHasVisual := false
	audio := make([]string, 0, len(draft.Shots))
	for _, shot := range draft.Shots {
		scene := h3InjectSubjects(h3FirstNonEmpty(shot.VisualContext, baseScene), subjects)
		if scene != "" && scene != activeScene {
			lines = append(lines, "场景："+scene)
			activeScene = scene
			sceneShotNumber = 0
			sceneHasVisual = false
		}
		sceneShotNumber++
		visual := strings.Join(h3NonEmpty(strings.TrimSpace(shot.ShotType), strings.TrimSpace(shot.Camera), h3InjectSubjects(shot.Description, subjects)), "；")
		if lighting := h3InjectSubjects(shot.Lighting, subjects); lighting != "" {
			visual = strings.Join(h3NonEmpty(visual, "光影："+lighting), "；")
		}
		if visual == "" {
			continue
		}
		prefix := fmt.Sprintf("镜头%d", sceneShotNumber)
		if rhythm := strings.TrimSpace(shot.Rhythm); rhythm != "" {
			prefix += "（节奏：" + rhythm + "）"
		}
		prefix += "："
		if !sceneHasVisual {
			prefix = "画面：" + prefix
			sceneHasVisual = true
		}
		lines = append(lines, prefix+visual)
		if value := h3InjectSubjects(shot.Audio, subjects); h3AudioValue(value) != "" {
			audio = append(audio, fmt.Sprintf("镜头%d：%s", sceneShotNumber, h3AudioValue(value)))
		}
	}
	if len(draft.Shots) == 0 && strings.TrimSpace(draft.VideoDesc) != "" {
		lines = append(lines, "画面：镜头1："+h3InjectSubjects(draft.VideoDesc, subjects))
	}
	if len(audio) > 0 {
		lines = append(lines, "", "Audio:")
		lines = append(lines, audio...)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func h3InjectSubjects(value string, subjects []h3Subject) string {
	value = strings.TrimSpace(value)
	for _, subject := range subjects {
		marker := fmt.Sprintf("%s<Subject %d>", subject.Name, subject.Index)
		value = strings.ReplaceAll(value, subject.Name, marker)
		value = strings.ReplaceAll(value, marker+fmt.Sprintf("<Subject %d>", subject.Index), marker)
	}
	return value
}

func h3AudioValue(value string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "", "无", "none", "null", "无音频", "无声音":
		return ""
	default:
		return value
	}
}

func h3SceneDescription(name string, scenes []compiledAsset) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	for _, scene := range scenes {
		if strings.TrimSpace(scene.Name) == name && strings.TrimSpace(scene.Prompt) != "" {
			return name + "：" + strings.TrimSpace(scene.Prompt)
		}
	}
	return name
}

func h3Clock(seconds int) string {
	if seconds < 0 {
		seconds = 0
	}
	return fmt.Sprintf("%02d:%02d", seconds/60, seconds%60)
}

func h3NonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func h3FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
