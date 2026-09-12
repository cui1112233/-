package batchfactoryv11

import (
	"fmt"
	"math"
	"strings"
)

type ShotMergeMedia struct {
	ProductionJobID string `json:"productionJobId"`
	BookID          string `json:"bookId"`
	VideoID         string `json:"videoId"`
	ShotID          string `json:"shotId"`
	MediaURL        string `json:"mediaUrl"`
	Order           int    `json:"order"`
}

type VideoMergePlan struct {
	BookID  string           `json:"bookId"`
	VideoID string           `json:"videoId"`
	Order   int              `json:"order"`
	Sources []ShotMergeMedia `json:"sources"`
}

type BookMergePlan struct {
	BookID string           `json:"bookId"`
	Videos []VideoMergePlan `json:"videos"`
}

type PlaybackPlan struct {
	SourceDurationSeconds float64 `json:"sourceDurationSeconds"`
	AudioDurationSeconds  float64 `json:"audioDurationSeconds"`
	Speed                 float64 `json:"speed"`
	ManualOverride        bool    `json:"manualOverride"`
	TrimSource            bool    `json:"trimSource"`
}

func latestShotProductionTasks(jobs []ProductionJob, bookID, directorRevisionID string) map[string]productionTaskSelection {
	out := map[string]productionTaskSelection{}
	for _, job := range jobs {
		if job.BookID != bookID || job.DirectorRevisionID != directorRevisionID {
			continue
		}
		for _, task := range job.Tasks {
			shotID := strings.TrimSpace(task.ShotID)
			if shotID == "" {
				continue
			}
			out[shotID] = productionTaskSelection{JobID: job.ID, Task: task}
		}
	}
	return out
}

func BuildBookMergePlan(book Book, directorRevisionID string, jobs []ProductionJob) (BookMergePlan, error) {
	if strings.TrimSpace(book.ID) == "" || strings.TrimSpace(directorRevisionID) == "" {
		return BookMergePlan{}, fmt.Errorf("%w: book and director revision are required", ErrInvalid)
	}
	if len(book.Videos) == 0 {
		return BookMergePlan{}, fmt.Errorf("%w: book has no VIDEO units", ErrConflict)
	}
	selections := latestShotProductionTasks(jobs, book.ID, directorRevisionID)
	plan := BookMergePlan{BookID: book.ID, Videos: make([]VideoMergePlan, 0, len(book.Videos))}
	for videoIndex, video := range book.Videos {
		if len(video.Shots) == 0 {
			return BookMergePlan{}, fmt.Errorf("%w: VIDEO %s has no Shots", ErrConflict, video.ID)
		}
		videoPlan := VideoMergePlan{BookID: book.ID, VideoID: video.ID, Order: videoIndex, Sources: make([]ShotMergeMedia, 0, len(video.Shots))}
		for shotIndex, shot := range video.Shots {
			selection, ok := selections[shot.ID]
			if !ok || selection.Task.VideoID != video.ID || selection.Task.Status != ProductionSucceeded || strings.TrimSpace(selection.Task.MediaURL) == "" {
				return BookMergePlan{}, fmt.Errorf("%w: VIDEO %s Shot %s has no completed media", ErrConflict, video.ID, shot.ID)
			}
			mediaURL := strings.TrimSpace(selection.Task.MediaURL)
			videoPlan.Sources = append(videoPlan.Sources, ShotMergeMedia{
				ProductionJobID: selection.JobID,
				BookID:          book.ID,
				VideoID:         video.ID,
				ShotID:          shot.ID,
				MediaURL:        mediaURL,
				Order:           shotIndex,
			})
		}
		plan.Videos = append(plan.Videos, videoPlan)
	}
	return plan, nil
}

func PlanPlaybackSpeed(sourceDurationSeconds, audioDurationSeconds, manualSpeed float64) (PlaybackPlan, error) {
	if sourceDurationSeconds <= 0 || math.IsNaN(sourceDurationSeconds) || math.IsInf(sourceDurationSeconds, 0) {
		return PlaybackPlan{}, fmt.Errorf("%w: source duration must be positive", ErrInvalid)
	}
	if audioDurationSeconds < 0 || math.IsNaN(audioDurationSeconds) || math.IsInf(audioDurationSeconds, 0) {
		return PlaybackPlan{}, fmt.Errorf("%w: audio duration cannot be negative", ErrInvalid)
	}
	plan := PlaybackPlan{
		SourceDurationSeconds: sourceDurationSeconds,
		AudioDurationSeconds:  audioDurationSeconds,
		Speed:                 1,
		TrimSource:            false,
	}
	if manualSpeed > 0 {
		if manualSpeed < 0.25 || manualSpeed > 4 {
			return PlaybackPlan{}, fmt.Errorf("%w: manual playback speed must be between 0.25 and 4", ErrInvalid)
		}
		plan.Speed = manualSpeed
		plan.ManualOverride = true
		return plan, nil
	}
	if audioDurationSeconds > 0 {
		plan.Speed = sourceDurationSeconds / audioDurationSeconds
		if plan.Speed < 0.25 || plan.Speed > 4 {
			return PlaybackPlan{}, fmt.Errorf("%w: required playback speed %.3fx is outside supported range", ErrConflict, plan.Speed)
		}
	}
	return plan, nil
}
