package httpapi

import (
	"errors"
	"net/http"
	"time"

	"qiantie/backend/internal/novelfetchworkshop"
)

func novelFetchRouteNow(now func() time.Time) time.Time {
	if now != nil {
		return now().UTC()
	}
	return time.Now().UTC()
}

func registerNovelFetchCleanupRoutes(mux *http.ServeMux, store novelfetchworkshop.LifecycleStore, now func() time.Time) {
	mux.HandleFunc("GET /api/novel-fetch-workshop/bodies/status", func(w http.ResponseWriter, req *http.Request) {
		identity, _ := BridgeIdentityFromContext(req.Context())
		status, err := store.GetBodyStorageStatus(req.Context(), identity.Username, novelFetchRouteNow(now))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "读取正文容量状态失败"})
			return
		}
		writeJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("POST /api/novel-fetch-workshop/tasks/{bookId}/bodies/{versionId}/release", func(w http.ResponseWriter, req *http.Request) {
		identity, _ := BridgeIdentityFromContext(req.Context())
		bookID, versionID, ok := novelFetchBodyPathValues(w, req)
		if !ok {
			return
		}
		var input struct {
			RetentionDays int `json:"retentionDays"`
		}
		if err := decodeNovelFetchJSON(w, req, &input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "请求内容无效"})
			return
		}
		if input.RetentionDays != 0 && (input.RetentionDays < novelfetchworkshop.MinBodyRetentionDays || input.RetentionDays > novelfetchworkshop.MaxBodyRetentionDays) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "正文保留天数必须为 1～30 天"})
			return
		}
		ref, err := store.MarkBodyReleasable(req.Context(), identity.Username, bookID, versionID, novelFetchRouteNow(now), input.RetentionDays)
		if errors.Is(err, novelfetchworkshop.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "正文不存在"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "更新正文清理状态失败"})
			return
		}
		writeJSON(w, http.StatusOK, ref)
	})

	mux.HandleFunc("POST /api/novel-fetch-workshop/bodies/cleanup", func(w http.ResponseWriter, req *http.Request) {
		identity, _ := BridgeIdentityFromContext(req.Context())
		var input struct {
			Reason novelfetchworkshop.BodyCleanupReason `json:"reason"`
			Limit  int                                  `json:"limit"`
		}
		if err := decodeNovelFetchJSON(w, req, &input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "请求内容无效"})
			return
		}
		if input.Reason != novelfetchworkshop.BodyCleanupReasonExpired && input.Reason != novelfetchworkshop.BodyCleanupReasonCapacity {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "非法的清理原因"})
			return
		}
		if input.Limit < 0 || input.Limit > 1000 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "清理数量必须在 0～1000 之间"})
			return
		}
		result, err := store.CleanupBodies(req.Context(), identity.Username, novelfetchworkshop.BodyCleanupRequest{
			Now:    novelFetchRouteNow(now),
			Reason: input.Reason,
			Limit:  input.Limit,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "清理正文失败"})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
