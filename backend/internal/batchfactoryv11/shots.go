package batchfactoryv11

import "fmt"

const ShotStatusPending = "pending"

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
			TargetDurationSeconds: end - start,
			ShotType:              source.ShotType,
			Camera:                source.Camera,
			Description:           source.Description,
			CharacterRefs:         append([]string(nil), draft.Characters...),
			SceneRefs:             singletonString(draft.Scene),
			PropRefs:              append([]string(nil), draft.Props...),
			VideoPrompt:           source.Description,
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
