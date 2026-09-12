package mergeworker

import (
	"context"
	"math"
	"os"
	"testing"
	"time"
)

type durationAwareFakeMerger struct {
	duration float64
	speed    float64
	called   bool
}

func (f *durationAwareFakeMerger) TotalDuration(_ context.Context, _ []string) (float64, error) {
	return f.duration, nil
}

func (f *durationAwareFakeMerger) Merge(_ context.Context, _ []string, output string, speed float64) error {
	f.called = true
	f.speed = speed
	return os.WriteFile(output, []byte("merged"), 0o600)
}

func TestWorkerAudioTimingUsesMeasuredDurationToSpeedUp(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	job, err := store.Create(ctx, Job{
		ID:                   "merge-task-audio-fast",
		BatchID:              "batch-1",
		Status:               StateQueued,
		Sources:              []Source{{ProductionJobID: "p1", VideoID: "v1", MediaURL: "https://media.example/1.mp4", Order: 0}},
		TimingMode:           "audio",
		Speed:                0,
		AudioDurationSeconds: 6,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := queue.Enqueue(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	merger := &durationAwareFakeMerger{duration: 10}
	worker := &Worker{Store: store, Queue: queue, Downloader: &fakeDownloader{}, Merger: merger, Output: &fakeObjectStore{url: "https://cdn.example.com/fast.mp4"}, WorkRoot: t.TempDir()}
	if err := worker.ProcessOne(ctx, time.Second); err != nil {
		t.Fatal(err)
	}
	if !merger.called || math.Abs(merger.speed-(10.0/6.0)) > 0.0001 {
		t.Fatalf("called=%v speed=%f", merger.called, merger.speed)
	}
}

func TestWorkerAudioTimingUsesMeasuredDurationToSlowDown(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	job, err := store.Create(ctx, Job{
		ID:                   "merge-task-audio-slow",
		BatchID:              "batch-1",
		Status:               StateQueued,
		Sources:              []Source{{ProductionJobID: "p1", VideoID: "v1", MediaURL: "https://media.example/1.mp4", Order: 0}},
		TimingMode:           "audio",
		Speed:                0,
		AudioDurationSeconds: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := queue.Enqueue(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	merger := &durationAwareFakeMerger{duration: 6}
	worker := &Worker{Store: store, Queue: queue, Downloader: &fakeDownloader{}, Merger: merger, Output: &fakeObjectStore{url: "https://cdn.example.com/slow.mp4"}, WorkRoot: t.TempDir()}
	if err := worker.ProcessOne(ctx, time.Second); err != nil {
		t.Fatal(err)
	}
	if !merger.called || math.Abs(merger.speed-0.6) > 0.0001 {
		t.Fatalf("called=%v speed=%f", merger.called, merger.speed)
	}
}

func TestWorkerManualSpeedOverridesAudioTiming(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	queue := NewMemoryQueue()
	job, err := store.Create(ctx, Job{
		ID:                   "merge-task-audio-manual",
		BatchID:              "batch-1",
		Status:               StateQueued,
		Sources:              []Source{{ProductionJobID: "p1", VideoID: "v1", MediaURL: "https://media.example/1.mp4", Order: 0}},
		TimingMode:           "audio",
		Speed:                1.25,
		AudioDurationSeconds: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := queue.Enqueue(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	merger := &durationAwareFakeMerger{duration: 6}
	worker := &Worker{Store: store, Queue: queue, Downloader: &fakeDownloader{}, Merger: merger, Output: &fakeObjectStore{url: "https://cdn.example.com/manual.mp4"}, WorkRoot: t.TempDir()}
	if err := worker.ProcessOne(ctx, time.Second); err != nil {
		t.Fatal(err)
	}
	if !merger.called || math.Abs(merger.speed-1.25) > 0.0001 {
		t.Fatalf("called=%v speed=%f", merger.called, merger.speed)
	}
}
