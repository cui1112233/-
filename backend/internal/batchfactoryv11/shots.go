package batchfactoryv11

import (
	"context"
	"fmt"
)

const (
	ShotStatusPending          = "pending"
	DefaultShotTargetDuration = 6.0
)

func productionShotsFromDirectorVideo(batchID, bookID, videoID string, draft DirectorVideo) []Shot {
	shots := make([]Shot, 0, len(draft.Shots))
	for index, source := range draft.Shots {
		start := float64(source.StartSec)
		end := float64(source.EndSec)
		shots = append(shots, Shot{
			ID:                    fmt.Sprintf("%s:shot:%02d", videoID, index+1),
			BatchID:               batchID,
			BookID:                bookID,
			VideoID:               videoID,
			Order:                 index + 1,
			StartSeconds:          start,
			EndSeconds:            end,
			TargetDurationSeconds: DefaultShotTargetDuration,
			ShotType:              source.ShotType,
			Camera:                source.Camera,
			Description:           source.Description,
			CharacterRefs:         append([]string(nil), draft.Characters...),
			SceneRefs:             singletonString(draft.Scene),
			PropRefs:              append([]string(nil), draft.Props...),
			VideoPrompt:           source.Description,
			VisualImageURL:        source.VisualImageURL,
			Status:                ShotStatusPending,
		})
	}
	return shots
}

func singletonString(value string) []string {
	if value == "" {
		return nil
	}
	return []string{value}
}

func hydrateVideoShotsFromDirector(video *Video, draft DirectorVideo) {
	if video == nil {
		return
	}
	video.VideoPrompt = draft.VideoDesc
	video.Shots = productionShotsFromDirectorVideo(video.BatchID, video.BookID, video.ID, draft)
}

func hydrateVideosFromDirector(videos []Video, output DirectorResult) []Video {
	out := append([]Video(nil), videos...)
	for index := range out {
		if index >= len(output.Storyboard) {
			break
		}
		hydrateVideoShotsFromDirector(&out[index], output.Storyboard[index])
	}
	return out
}

type directorShotReadbackStore interface {
	SaveDirectorShotReadback(context.Context, string, string, string, DirectorRevision) error
}

func (s *MemoryStore) SaveDirectorShotReadback(_ context.Context, owner, batchID, bookID string, revision DirectorRevision) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	owned, ok := s.batches[batchID]
	if !ok || owned.Owner != owner {
		return ErrNotFound
	}
	batch := owned.Value
	bookIndex := -1
	for index := range batch.Books {
		if batch.Books[index].ID == bookID {
			bookIndex = index
			break
		}
	}
	if bookIndex < 0 {
		return ErrNotFound
	}
	batch.Books[bookIndex].Videos = hydrateVideosFromDirector(batch.Books[bookIndex].Videos, revision.Output)
	s.batches[batchID] = memoryOwned[Batch]{Owner: owner, Value: batch}

	key := memoryBookKey(batchID, bookID)
	if revisions := s.directors[key]; len(revisions) > 0 {
		latest := revisions[len(revisions)-1]
		latest.Videos = hydrateVideosFromDirector(latest.Videos, latest.Output)
		s.directors[key][len(revisions)-1] = latest
	}
	return nil
}
