package httpapi

import (
	"net/http"

	"qiantie/backend/internal/batchfactoryv11"
)

func registerBookAssetRoutes(mux *http.ServeMux, store batchfactoryv11.Store) {
	const collection = "/api/batch-factory/v11/batches/{batchId}/books/{bookId}/assets"
	mux.HandleFunc("GET "+collection, func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		assets, err := store.ListBookAssets(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
	})
	mux.HandleFunc("POST "+collection, func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.CreateBookAssetInput
		if !decodeJSON(w, r, &input) {
			return
		}
		asset, err := store.CreateBookAsset(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"asset": asset})
	})
	mux.HandleFunc("PATCH "+collection+"/{assetId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var input batchfactoryv11.UpdateBookAssetInput
		if !decodeJSON(w, r, &input) {
			return
		}
		asset, err := store.UpdateBookAsset(r.Context(), owner, r.PathValue("batchId"), r.PathValue("bookId"), r.PathValue("assetId"), input)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"asset": asset})
	})
}
