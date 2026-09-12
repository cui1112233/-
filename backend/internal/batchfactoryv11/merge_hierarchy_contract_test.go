package batchfactoryv11

import (
	"math"
	"testing"
)

func TestBuildBookMergePlanGroupsShotsIntoVideosInDirectorOrder(t *testing.T) {
	book := Book{ID: "book-1", Videos: []Video{
		{ID: "video-1", Shots: []Shot{{ID: "shot-1", Order: 1}, {ID: "shot-2", Order: 2}}},
		{ID: "video-2", Shots: []Shot{{ID: "shot-3", Order: 1}}},
	}}
	jobs := []ProductionJob{{
		ID: "job-1", BookID: "book-1", DirectorRevisionID: "director-1",
		Tasks: []ProductionTask{
			{VideoID: "video-1", ShotID: "shot-2", Status: ProductionSucceeded, MediaURL: "https://media.example/shot-2.mp4"},
			{VideoID: "video-2", ShotID: "shot-3", Status: ProductionSucceeded, MediaURL: "https://media.example/shot-3.mp4"},
			{VideoID: "video-1", ShotID: "shot-1", Status: ProductionSucceeded, MediaURL: "https://media.example/shot-1.mp4"},
		},
	}}
	plan, err := BuildBookMergePlan(book, "director-1", jobs)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Videos) != 2 {
		t.Fatalf("plan=%+v", plan)
	}
	if got := plan.Videos[0].Sources; len(got) != 2 || got[0].ShotID != "shot-1" || got[1].ShotID != "shot-2" {
		t.Fatalf("video-1 sources must follow Shot order: %+v", got)
	}
	if got := plan.Videos[1].Sources; len(got) != 1 || got[0].ShotID != "shot-3" {
		t.Fatalf("video-2 sources=%+v", got)
	}
	if plan.Videos[0].Order != 0 || plan.Videos[1].Order != 1 {
		t.Fatalf("VIDEO order lost: %+v", plan.Videos)
	}
}

func TestBuildBookMergePlanRejectsMissingOrFailedShotInsteadOfPartialMerge(t *testing.T) {
	book := Book{ID: "book-1", Videos: []Video{{ID: "video-1", Shots: []Shot{{ID: "shot-1", Order: 1}, {ID: "shot-2", Order: 2}}}}}
	jobs := []ProductionJob{{
		ID: "job-1", BookID: "book-1", DirectorRevisionID: "director-1",
		Tasks: []ProductionTask{{VideoID: "video-1", ShotID: "shot-1", Status: ProductionSucceeded, MediaURL: "https://media.example/shot-1.mp4"}},
	}}
	if _, err := BuildBookMergePlan(book, "director-1", jobs); err == nil {
		t.Fatal("expected missing shot media to block VIDEO merge")
	}
}

func TestPlanPlaybackSpeedSupportsFastAndSlowWithoutTrimmingRawMedia(t *testing.T) {
	fast, err := PlanPlaybackSpeed(10, 6, 0)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(fast.Speed-(10.0/6.0)) > 0.0001 || fast.TrimSource {
		t.Fatalf("10s video to 6s audio must speed up without trim: %+v", fast)
	}

	slow, err := PlanPlaybackSpeed(6, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(slow.Speed-0.6) > 0.0001 || slow.TrimSource {
		t.Fatalf("6s video to 10s audio must slow down without trim: %+v", slow)
	}

	manual, err := PlanPlaybackSpeed(10, 6, 1.25)
	if err != nil {
		t.Fatal(err)
	}
	if manual.Speed != 1.25 || !manual.ManualOverride || manual.TrimSource {
		t.Fatalf("manual speed must override auto timing without trimming: %+v", manual)
	}
}
