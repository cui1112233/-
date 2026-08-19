package httpapi

import (
	"context"
	"io"
	"mime"
	"net/http"
	"strings"

	shuihuoexport "qiantie/backend/internal/shuihuo/export"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

// handleExportShuihuoProject returns only the caller's persisted workbench
// state. The archive service deliberately excludes object keys and raw task
// snapshots from the user-facing manifest.
func (api *API) handleExportShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置，无法导出"})
		return
	}
	projectID, err := parseShuihuoID(r, "id")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	user, _ := currentUser(r)
	readModel, err := shuihuostore.NewSourceUnits(api.deps.DB).ReadProject(r.Context(), user.ID, projectID)
	if isNotFound(err) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目工作台失败"})
		return
	}
	body, err := shuihuoexport.BuildZIP(r.Context(), objectExportReader{objects: api.deps.Objects}, readModel.Project, readModel.Segments, readModel.SegmentSourceUnitIDs, readModel.SegmentAssetIDs, readModel.Assets, readModel.Media)
	if err != nil {
		if strings.Contains(err.Error(), "no confirmed storyboards") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "请先确认至少一个分镜后再导出"})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "读取项目素材失败，暂时无法导出"})
		return
	}
	filename := strings.TrimSpace(readModel.Project.Name)
	if filename == "" {
		filename = "漫剧解说"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename + "-漫剧解说.zip"}))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

type objectExportReader struct{ objects shuihuostorage.ObjectStorage }

func (r objectExportReader) Get(ctx context.Context, key string) (io.ReadCloser, shuihuoexport.Object, error) {
	body, object, err := r.objects.Get(ctx, key)
	if err != nil {
		return nil, shuihuoexport.Object{}, err
	}
	return body, shuihuoexport.Object{Key: object.Key, ContentType: object.ContentType}, nil
}
