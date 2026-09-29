package worker

import (
	"strings"
	"testing"
)

func TestDecodeEventAcceptsIdleAfterCompletion(t *testing.T) {
	event, err := DecodeEvent([]byte(`{"type":"idle","jobId":"job-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if event.Type != EventIdle || event.JobID != "job-1" {
		t.Fatalf("event=%+v", event)
	}
}

func TestDecodeEventRejectsProgressFrameText(t *testing.T) {
	if _, err := DecodeEvent([]byte(`{"type":"progress","jobId":"job-1","completed":1,"total":2,"percent":50,"text":"frame text must not cross boundary"}`)); err == nil {
		t.Fatal("expected frame text rejection")
	}
}

func TestEncodeExtractCommandContainsOnlyAllowedMediaFields(t *testing.T) {
	command, err := EncodeExtractCommand(ExtractRequest{JobID: "job-1", VideoURL: "https://material.hnqingyuwen.top/video.mp4", DurationSeconds: 2})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(command), "token") || strings.Contains(string(command), "cookie") {
		t.Fatalf("credential leaked into command: %s", command)
	}
}
