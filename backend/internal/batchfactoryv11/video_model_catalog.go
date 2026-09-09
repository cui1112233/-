package batchfactoryv11

const VideoModelMiniMaxH3 = "minimax-h3"

type VideoModelCatalogItem struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Provider    string `json:"provider"`
	MaxDuration int    `json:"maxDuration"`
}

func VideoModelCatalog() []VideoModelCatalogItem {
	return []VideoModelCatalogItem{
		{ID: DefaultPersonalVideoModel, Label: "YD2.0 Mini", Provider: VideoProviderPersonalAPI, MaxDuration: 15},
		{ID: "doubao-seedance", Label: "豆包 Seedance", Provider: VideoProviderDoubaoLocal, MaxDuration: 15},
		{ID: VideoModelMiniMaxH3, Label: "MiniMax H3", Provider: VideoProviderAutoDLComfyUI, MaxDuration: 15},
	}
}
