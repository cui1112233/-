package tasks

import (
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

func TestRequestFromTaskRestoresBatchVideoDurationAndAspectRatio(t *testing.T) {
	request, err := requestFromTask(domain.Task{Input: `{"prompt":"完整编译后的视频提示词","duration":13,"aspectRatio":"9:16"}`})
	if err != nil {
		t.Fatalf("requestFromTask() error = %v", err)
	}
	if got, want := request.Prompt, "完整编译后的视频提示词"; got != want {
		t.Fatalf("prompt = %q, want %q", got, want)
	}
	if got, want := request.Duration, "13"; got != want {
		t.Fatalf("duration = %q, want %q", got, want)
	}
	if got, want := request.AspectRatio, "9:16"; got != want {
		t.Fatalf("aspect ratio = %q, want %q", got, want)
	}
}

func TestRequestFromTaskKeepsLegacyVideoTasksCompatible(t *testing.T) {
	request, err := requestFromTask(domain.Task{Input: `{"prompt":"旧视频任务"}`})
	if err != nil {
		t.Fatalf("requestFromTask() error = %v", err)
	}
	if request.Duration != "" || request.AspectRatio != "" {
		t.Fatalf("legacy task unexpectedly received duration/aspect: %#v", request)
	}
}

func TestRequestFromTaskRejectsInvalidVideoMetadata(t *testing.T) {
	if _, err := requestFromTask(domain.Task{Input: `{"prompt":"x","duration":13,"aspectRatio":"1:1"}`}); err == nil {
		t.Fatal("requestFromTask() accepted unsupported aspect ratio")
	}
	if _, err := requestFromTask(domain.Task{Input: `{"prompt":"x","duration":61,"aspectRatio":"9:16"}`}); err == nil {
		t.Fatal("requestFromTask() accepted excessive duration")
	}
}
