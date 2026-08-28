package domain

import "time"

// AssetImage is a generated reference image for one project asset. It is
// separate from storyboard media and cannot replace segment video/image media.
type AssetImage struct {
	ID                    int64     `json:"id"`
	ProjectID             int64     `json:"projectId"`
	AssetID               int64     `json:"assetId"`
	TaskID                *int64    `json:"taskId"`
	ObjectKey             string    `json:"-"`
	IsPrimary             bool      `json:"isPrimary"`
	AssetNameSnapshot     string    `json:"assetNameSnapshot"`
	AssetCategorySnapshot string    `json:"assetCategorySnapshot"`
	AssetPromptSnapshot   string    `json:"assetPromptSnapshot"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}
