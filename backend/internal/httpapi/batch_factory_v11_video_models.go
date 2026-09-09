package httpapi

import (
	"net/http"
	"qiantie/backend/internal/batchfactoryv11"
)

func videoModelCatalogHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"videoModels": batchfactoryv11.VideoModelCatalog()})
}
