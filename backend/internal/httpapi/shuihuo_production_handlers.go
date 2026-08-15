package httpapi

import (
	"bytes"
	"database/sql"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/shuihuo/assets"
	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	"qiantie/backend/internal/shuihuo/uploads"

	"github.com/go-chi/chi/v5"
)

type shuihuoSegmentRequest struct {
	SourceText        string `json:"sourceText"`
	SubtitleText      string `json:"subtitleText"`
	ImagePrompt       string `json:"imagePrompt"`
	VideoPrompt       string `json:"videoPrompt"`
	ImagePromptLocked bool   `json:"imagePromptLocked"`
	VideoPromptLocked bool   `json:"videoPromptLocked"`
}

type shuihuoAssetUpdateRequest struct {
	Category           string `json:"category"`
	Name               string `json:"name"`
	Prompt             string `json:"prompt"`
	ReferenceObjectKey string `json:"referenceObjectKey"`
}

type shuihuoSegmentAssetsRequest struct {
	AssetIDs []int64 `json:"assetIds"`
}

type shuihuoMediaUploadRequest struct {
	Filename string `json:"filename"`
	DataURL  string `json:"dataUrl"`
	Kind     string `json:"kind"`
}

func (api *API) handleCreateShuihuoSegment(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoSegmentRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.SourceText) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分段原文不能为空"})
		return
	}
	user, _ := currentUser(r)
	segments, err := shuihuostore.NewSegments(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段失败"})
		return
	}
	segment, err := shuihuostore.NewSegments(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Segment{
		SourceText: req.SourceText, SubtitleText: req.SubtitleText, OrderIndex: len(segments) + 1, Confirmed: true, ManuallyEdited: true,
		ImagePrompt: req.ImagePrompt, VideoPrompt: req.VideoPrompt, ImagePromptLocked: req.ImagePromptLocked, VideoPromptLocked: req.VideoPromptLocked,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "新增分段失败"})
		return
	}
	writeJSON(w, http.StatusCreated, segment)
}

func (api *API) handleUpdateShuihuoSegment(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := parseShuihuoResourceID(w, r, "segmentId", "分段")
	if !ok {
		return
	}
	var req shuihuoSegmentRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.SourceText) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分段原文不能为空"})
		return
	}
	user, _ := currentUser(r)
	repo := shuihuostore.NewSegments(api.deps.DB)
	segment, err := repo.GetSegment(r.Context(), user.ID, segmentID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分段不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段失败"})
		return
	}
	segment.SourceText, segment.SubtitleText = req.SourceText, req.SubtitleText
	segment.ImagePrompt, segment.VideoPrompt = req.ImagePrompt, req.VideoPrompt
	segment.ImagePromptLocked, segment.VideoPromptLocked = req.ImagePromptLocked, req.VideoPromptLocked
	segment.ManuallyEdited = true
	if err := repo.Update(r.Context(), user.ID, segment); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存分段失败"})
		return
	}
	segment.ManuallyEdited = true
	writeJSON(w, http.StatusOK, segment)
}

func (api *API) handleDeleteShuihuoSegment(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := parseShuihuoResourceID(w, r, "segmentId", "分段")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).Delete(r.Context(), user.ID, segmentID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "分段不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除分段失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) handleReorderShuihuoSegments(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		SegmentIDs []int64 `json:"segmentIds"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).Reorder(r.Context(), user.ID, project.ID, req.SegmentIDs); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分段排序无效"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleListShuihuoSegmentAssets(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := parseShuihuoResourceID(w, r, "segmentId", "分段")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	assetIDs, err := shuihuostore.NewSegmentAssets(api.deps.DB).ListAssetIDs(r.Context(), user.ID, segmentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分段资产失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assetIds": assetIDs})
}

func (api *API) handleReplaceShuihuoSegmentAssets(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := parseShuihuoResourceID(w, r, "segmentId", "分段")
	if !ok {
		return
	}
	var req shuihuoSegmentAssetsRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegmentAssets(api.deps.DB).Replace(r.Context(), user.ID, segmentID, req.AssetIDs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "分段不存在"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产必须属于当前作品"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleUpdateShuihuoAsset(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	var req shuihuoAssetUpdateRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产名称不能为空"})
		return
	}
	user, _ := currentUser(r)
	repo := shuihuostore.NewAssets(api.deps.DB)
	asset, err := repo.Get(r.Context(), user.ID, assetID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产失败"})
		return
	}
	category, err := assets.NormalizeCategory(req.Category)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产类型无效"})
		return
	}
	asset.Category, asset.Name, asset.Prompt, asset.ReferenceObjectKey = category, strings.TrimSpace(req.Name), req.Prompt, req.ReferenceObjectKey
	asset.ManuallyEdited, asset.Source = true, "manual"
	if err := repo.Update(r.Context(), user.ID, asset); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存资产失败"})
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (api *API) handleDeleteShuihuoAsset(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewAssets(api.deps.DB).Delete(r.Context(), user.ID, assetID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除资产失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) handleUploadShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "对象存储未配置"})
		return
	}
	var req shuihuoMediaUploadRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	decoded, err := uploads.DecodeDataURL(req.DataURL, req.Filename, req.Kind)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "文件格式不受支持"})
		return
	}
	user, _ := currentUser(r)
	key, err := shuihuostorage.ObjectKey(user.ID, project.ID, decoded.Category, decoded.Filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "文件名无效"})
		return
	}
	if _, err := api.deps.Objects.Put(r.Context(), key, bytes.NewReader(decoded.Body), decoded.ContentType); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "上传文件失败"})
		return
	}
	media, err := shuihuostore.NewMedia(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Media{Kind: req.Kind, ObjectKey: key, Source: "manual", ManuallyEdited: true})
	if err != nil {
		_ = api.deps.Objects.Delete(r.Context(), key)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存素材失败"})
		return
	}
	writeJSON(w, http.StatusCreated, api.shuihuoMediaResponse(r, media))
}

func (api *API) handleAttachShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	var req struct {
		SegmentID int64 `json:"segmentId"`
	}
	if err := readJSON(r, &req); err != nil || req.SegmentID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择分段"})
		return
	}
	user, _ := currentUser(r)
	segments := shuihuostore.NewSegments(api.deps.DB)
	segment, err := segments.GetSegment(r.Context(), user.ID, req.SegmentID)
	if err != nil || !segment.Confirmed {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "只能绑定已确认分段"})
		return
	}
	mediaRepo := shuihuostore.NewMedia(api.deps.DB)
	media, err := mediaRepo.Get(r.Context(), user.ID, mediaID)
	if errors.Is(err, sql.ErrNoRows) || media.ProjectID != segment.ProjectID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取素材失败"})
		return
	}
	media.SegmentID = &segment.ID
	if err := mediaRepo.Update(r.Context(), user.ID, media); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "绑定素材失败"})
		return
	}
	writeJSON(w, http.StatusOK, api.shuihuoMediaResponse(r, media))
}

func (api *API) handleSetShuihuoPrimaryMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewMedia(api.deps.DB).SetPrimary(r.Context(), user.ID, mediaID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "只能将已绑定分段的素材设为主素材"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleDeleteShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	repo := shuihuostore.NewMedia(api.deps.DB)
	media, err := repo.Get(r.Context(), user.ID, mediaID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取素材失败"})
		return
	}
	if err := repo.Delete(r.Context(), user.ID, mediaID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除素材失败"})
		return
	}
	if api.deps.Objects != nil {
		_ = api.deps.Objects.Delete(r.Context(), media.ObjectKey)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) handleDownloadShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "对象存储未配置"})
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).Get(r.Context(), user.ID, mediaID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取素材失败"})
		return
	}
	body, _, err := api.deps.Objects.Get(r.Context(), media.ObjectKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材文件不存在"})
		return
	}
	defer body.Close()
	if contentType := mime.TypeByExtension(extensionForObjectKey(media.ObjectKey)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Content-Disposition", "inline")
	_, _ = io.Copy(w, body)
}

func (api *API) shuihuoMediaResponse(r *http.Request, media domain.Media) map[string]any {
	return map[string]any{
		"media": media,
		"url":   "/api/shuihuo-production/media/" + strconv.FormatInt(media.ID, 10) + "/download",
	}
}

func parseShuihuoResourceID(w http.ResponseWriter, r *http.Request, name, label string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的" + label + " ID"})
		return 0, false
	}
	return id, true
}

func extensionForObjectKey(key string) string {
	index := strings.LastIndex(key, ".")
	if index < 0 {
		return ""
	}
	return key[index:]
}
