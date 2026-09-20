package batchfactoryv11

import (
	"context"
	"testing"
)

type fixedH3AudioProbe struct {
	durationMS int64
	seen       []byte
}

func (p *fixedH3AudioProbe) DurationMS(_ context.Context, audio []byte) (int64, error) {
	p.seen = append([]byte(nil), audio...)
	return p.durationMS, nil
}

func TestH3KernelMeasuresAudioBytesOnBackendAndBindsActiveSource(t *testing.T) {
	store, batch, book := seedH3DirectorRevision(t)
	document := *book.DirectorRevision.Output.H3Director
	probe := &fixedH3AudioProbe{durationMS: 7420}
	service := &H3KernelService{Store: store, AudioProbe: probe}

	got, err := service.MeasureAudio(context.Background(), "alice", batch.ID, book.ID, []byte("real-audio-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Measurement.DurationMS != 7420 || got.Measurement.VideoSourceRevision != document.VideoSourceRevision || got.Measurement.VideoSourceHash != document.VideoSourceHash {
		t.Fatalf("measurement not bound to active H3 source: %#v", got.Measurement)
	}
	if got.Measurement.AssetID == "" || got.Measurement.ContentHash == "" {
		t.Fatalf("content-addressed audio identity missing: %#v", got.Measurement)
	}
	if string(probe.seen) != "real-audio-bytes" {
		t.Fatalf("probe received %q", probe.seen)
	}
}

func TestH3KernelRejectsEmptyOrUnprobeableAudio(t *testing.T) {
	store, batch, book := seedH3DirectorRevision(t)
	service := &H3KernelService{Store: store, AudioProbe: &fixedH3AudioProbe{durationMS: 0}}
	if _, err := service.MeasureAudio(context.Background(), "alice", batch.ID, book.ID, nil); err == nil {
		t.Fatal("expected empty audio rejection")
	}
	if _, err := service.MeasureAudio(context.Background(), "alice", batch.ID, book.ID, []byte("not-audio")); err == nil {
		t.Fatal("expected zero-duration probe rejection")
	}
}
