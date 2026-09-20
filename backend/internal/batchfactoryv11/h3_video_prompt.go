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
	return strings.EqualFold(strings.TrimSpace(selection.Key), h3VideoRendererKey)
}

// compileH3VideoPrompt ports H3's final, structured VIDEO output boundary to
// Batch Factory. The director's shot timeline remains authoritative; assets
// provide the stable subject definitions that make the final VIDEO prompt
// usable by reference-image capable video models.
func compileH3VideoPrompt(draft DirectorVideo, characters, scenes []compiledAsset, unifiedStyle string) string {
	parts := make([]string, 0, 5)
	subjects := h3Subjects(characters)
	if style := strings.TrimSpace(unifiedStyle); style != "" {
		parts = append(parts, style)
	}
	if definitions := h3SubjectDefinitions(subjects); definitions != "" {
		parts = append(parts, definitions)
	}
	parts = append(parts, "【视听呈现】\n视觉层只呈现人物、环境、动作、道具、光影以及原文明确定义的信息载体。\n人物对白通过人物声音与口型表现；旁白、画外音和内心独白只存在于听觉层。\n\nNo on-screen text unless explicitly required by the story.\nSpoken dialogue and voiceover are audio only.")
	if timeline := h3StructuredTimeline(draft, scenes, subjects); timeline != "" {
		parts = append(parts, "【H3视听时间轴】\n"+timeline)
	}
	parts = append(parts, h3VisualPolicy())
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

func h3VisualPolicy() string {
	return "【H3画面约束】\n人物身份、年龄、脸型、五官、发型、服装和饰品在连续镜头中保持稳定。运动过程中保持五官结构稳定，避免面部融化、身份漂移、重复人物、多余肢体、肢体融合、手指异常、穿模和明显透视错误。\n皮肤保留真实毛孔、细小绒毛和自然肤色变化；眼睛、睫毛、眉毛和发丝保持自然细节，不过度锐化或塑料化磨皮。布料保持真实纤维与褶皱，木材、玻璃、金属、屏幕等保持符合材质属性的反射与粗糙度。\n人物运动和摄影机运动保持清晰稳定，避免不合理运动模糊、局部拖影和背景结构跳变。高光不过曝，黑位不压死，暗部保留有效纹理。保持干净完整的影视画面，不添加水印、品牌标识或与剧情无关的界面元素。"
}
