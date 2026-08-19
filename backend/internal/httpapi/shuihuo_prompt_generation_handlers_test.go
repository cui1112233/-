package httpapi

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunPromptCandidateJobsLimitsConcurrencyAndPreservesOrder(t *testing.T) {
	started := make(chan int, promptCandidateConcurrency+1)
	release := make(chan struct{})
	var active int32
	var maximum int32

	resultCh := make(chan [][]promptCandidate, 1)
	errorCh := make(chan error, 1)
	go func() {
		results, err := runPromptCandidateJobs(context.Background(), 6, func(_ context.Context, index int) ([]promptCandidate, error) {
			current := atomic.AddInt32(&active, 1)
			for {
				seen := atomic.LoadInt32(&maximum)
				if current <= seen || atomic.CompareAndSwapInt32(&maximum, seen, current) {
					break
				}
			}
			started <- index
			<-release
			atomic.AddInt32(&active, -1)
			return []promptCandidate{{SegmentID: int64(index + 1), Prompt: "prompt"}}, nil
		})
		if err != nil {
			errorCh <- err
			return
		}
		resultCh <- results
	}()

	for i := 0; i < promptCandidateConcurrency; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("expected configured number of concurrent jobs to start")
		}
	}
	select {
	case extra := <-started:
		t.Fatalf("job %d exceeded prompt candidate concurrency", extra)
	case <-time.After(25 * time.Millisecond):
	}
	close(release)

	select {
	case err := <-errorCh:
		t.Fatal(err)
	case results := <-resultCh:
		if maximum != promptCandidateConcurrency {
			t.Fatalf("maximum concurrent jobs = %d, want %d", maximum, promptCandidateConcurrency)
		}
		if len(results) != 6 {
			t.Fatalf("result groups = %d, want 6", len(results))
		}
		for index, candidates := range results {
			if len(candidates) != 1 || candidates[0].SegmentID != int64(index+1) {
				t.Fatalf("result group %d = %#v, want segment %d", index, candidates, index+1)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("prompt candidate jobs did not finish")
	}
}

func TestParsePromptCandidatesAcceptsFeishuImageStoryboard(t *testing.T) {
	candidates, err := parsePromptCandidates(`{
		"storyboard": [
			{"index": 1, "image_prompt": "图片设计：参考图一是林鸢，近景，背景教室走廊"},
			{"id": 2, "segmentId": 12, "image_prompt": "图片设计：参考图一是裴应臣，中景，背景教室走廊"}
		]
	}`, "image")
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 {
		t.Fatalf("candidates length = %d", len(candidates))
	}
	if candidates[0].SegmentID != 0 || candidates[0].Prompt != "图片设计：参考图一是林鸢，近景，背景教室走廊" {
		t.Fatalf("first candidate = %#v", candidates[0])
	}
	if candidates[1].SegmentID != 12 || candidates[1].Prompt != "图片设计：参考图一是裴应臣，中景，背景教室走廊" {
		t.Fatalf("second candidate = %#v", candidates[1])
	}
}

func TestParsePromptCandidatesAcceptsFeishuVideoStoryboard(t *testing.T) {
	candidates, err := parsePromptCandidates(`{
		"storyboard": [
			{"id": 1, "video_desc": "【角色标签】@林鸢,这个人是林鸢\n【地点】教室走廊"},
			{"id": 2, "video_prompt": "女子站在走廊，镜头缓缓推进至上半身特写"}
		]
	}`, "video")
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 {
		t.Fatalf("candidates length = %d", len(candidates))
	}
	if candidates[0].Prompt != "【角色标签】@林鸢,这个人是林鸢\n【地点】教室走廊" {
		t.Fatalf("first prompt = %q", candidates[0].Prompt)
	}
	if candidates[1].Prompt != "女子站在走廊，镜头缓缓推进至上半身特写" {
		t.Fatalf("second prompt = %q", candidates[1].Prompt)
	}
}
