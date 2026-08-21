package httpapi

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/documents"
	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type shuihuoMediaUploadRequest struct {
	Filename  string `json:"filename"`
	DataURL   string `json:"dataUrl"`
	Kind      string `json:"kind"`
	SegmentID *int64 `json:"segmentId"`
}
type shuihuoMediaSegmentRequest struct {
	SegmentID int64 `json:"segmentId"`
}

type shuihuoAssetImageUploadRequest struct {
	Filename     string `json:"filename"`
	DataURL      string `json:"dataUrl"`
	Category     string `json:"category"`
	Name         string `json:"name"`
	Prompt       string `json:"prompt"`
	VoiceAssetID *int64 `json:"voiceAssetId"`
}

type shuihuoAssetImageReplaceRequest struct {
	Filename string `json:"filename"`
	DataURL  string `json:"dataUrl"`
}

func (api *API) handleUploadShuihuoAssetImage(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	var req shuihuoAssetImageUploadRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片上传请求格式无效"})
		return
	}
	if strings.TrimSpace(req.Name) == "" || !validShuihuoAssetCategory(req.Category) || strings.TrimSpace(req.Filename) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产名称、类型或文件名无效"})
		return
	}
	contentType, raw, err := decodeShuihuoImportDataURL(req.DataURL)
	if err != nil || len(raw) == 0 || !strings.HasPrefix(contentType, "image/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请上传有效图片"})
		return
	}
	user, _ := currentUser(r)
	key, err := shuihuostorage.ObjectKey(user.ID, project.ID, "asset-images", req.Filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片文件名不安全"})
		return
	}
	if _, err := api.deps.Objects.Put(r.Context(), key, bytes.NewReader(raw), contentType); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存资产图片失败"})
		return
	}
	asset, err := shuihuostore.NewAssets(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Asset{Category: req.Category, Name: strings.TrimSpace(req.Name), Prompt: req.Prompt, VoiceAssetID: req.VoiceAssetID, ReferenceObjectKey: key, Source: "manual_image", ManuallyEdited: true})
	if err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "asset_image_upload_database_failure")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存资产记录失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"asset": asset})
}

func (api *API) handleDownloadShuihuoAssetImage(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	user, _ := currentUser(r)
	asset, err := shuihuostore.NewAssets(api.deps.DB).Get(r.Context(), user.ID, assetID)
	if errors.Is(err, sql.ErrNoRows) || asset.ReferenceObjectKey == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产图片不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产图片失败"})
		return
	}
	body, object, err := api.deps.Objects.Get(r.Context(), asset.ReferenceObjectKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产图片文件不存在"})
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", object.ContentType)
	_, _ = io.Copy(w, body)
}

func (api *API) handleReplaceShuihuoAssetImage(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	var req shuihuoAssetImageReplaceRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片替换请求格式无效"})
		return
	}
	if strings.TrimSpace(req.Filename) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片文件名无效"})
		return
	}
	contentType, raw, err := decodeShuihuoImportDataURL(req.DataURL)
	if err != nil || len(raw) == 0 || !strings.HasPrefix(contentType, "image/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请上传有效图片"})
		return
	}

	user, _ := currentUser(r)
	assets := shuihuostore.NewAssets(api.deps.DB)
	asset, err := assets.Get(r.Context(), user.ID, assetID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产失败"})
		return
	}
	if asset.Category == "voice" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "音色资产不支持图片"})
		return
	}

	if _, err := shuihuostorage.ObjectKey(user.ID, asset.ProjectID, "asset-images", req.Filename); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片文件名不安全"})
		return
	}
	filename := fmt.Sprintf("%d-%d-%s", asset.ID, time.Now().UTC().UnixNano(), path.Base(req.Filename))
	key, err := shuihuostorage.ObjectKey(user.ID, asset.ProjectID, "asset-images", filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产图片文件名不安全"})
		return
	}
	if _, err := api.deps.Objects.Put(r.Context(), key, bytes.NewReader(raw), contentType); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存资产图片失败"})
		return
	}

	oldKey := asset.ReferenceObjectKey
	asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited = key, "manual_image", true
	if err := assets.Update(r.Context(), user.ID, asset); err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "asset_image_replace_database_failure")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新资产图片失败"})
		return
	}
	if oldKey != "" && oldKey != key {
		if err := api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), oldKey, "asset_image_replace"); err != nil {
			writeJSON(w, http.StatusAccepted, map[string]any{"asset": asset, "warning": "资产图片已替换，旧图片清理已加入重试"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"asset": asset})
}

func mediaCategory(kind string) (string, bool) {
	switch kind {
	case "image":
		return "images", true
	case "video":
		return "videos", true
	case "audio":
		return "audio", true
	default:
		return "", false
	}
}

func (api *API) handleUploadShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	var req shuihuoMediaUploadRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "素材上传请求格式无效"})
		return
	}
	category, ok := mediaCategory(req.Kind)
	if !ok || strings.TrimSpace(req.Filename) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "素材类型或文件名无效"})
		return
	}
	contentType, raw, err := decodeShuihuoImportDataURL(req.DataURL)
	if err != nil || len(raw) == 0 || len(raw) > documents.MaxDocumentBytes*4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "素材数据无效或过大"})
		return
	}
	if !mediaContentTypeMatches(req.Kind, contentType) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "素材类型与文件内容不匹配"})
		return
	}
	user, _ := currentUser(r)
	if req.SegmentID != nil {
		segment, err := shuihuostore.NewSegments(api.deps.DB).GetSegment(r.Context(), user.ID, *req.SegmentID)
		if err != nil || segment.ProjectID != project.ID {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "分镜不存在"})
			return
		}
	}
	key, err := shuihuostorage.ObjectKey(user.ID, project.ID, category, req.Filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "素材文件名不安全"})
		return
	}
	if _, err := api.deps.Objects.Put(r.Context(), key, bytes.NewReader(raw), contentType); err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "media_upload_put_failure")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存素材文件失败"})
		return
	}
	mediaStore := shuihuostore.NewMedia(api.deps.DB)
	media, err := mediaStore.Create(r.Context(), user.ID, project.ID, domain.Media{SegmentID: req.SegmentID, Kind: req.Kind, ObjectKey: key, Source: "manual", ManuallyEdited: true})
	if err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "media_upload_database_failure")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存素材记录失败"})
		return
	}
	if req.Kind == "image" && req.SegmentID != nil {
		media, err = mediaStore.SetPrimary(r.Context(), user.ID, media.ID)
		if err != nil {
			_, _ = mediaStore.Delete(r.Context(), user.ID, media.ID)
			_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "media_upload_primary_failure")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "设置素材主图失败"})
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"media": media})
}

func mediaContentTypeMatches(kind, contentType string) bool {
	if kind == "image" {
		return strings.HasPrefix(contentType, "image/")
	}
	if kind == "video" {
		return strings.HasPrefix(contentType, "video/")
	}
	return strings.HasPrefix(contentType, "audio/")
}

func (api *API) handleAttachShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	var req shuihuoMediaSegmentRequest
	if err := readJSON(r, &req); err != nil || req.SegmentID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜绑定参数无效"})
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).AttachSegment(r.Context(), user.ID, mediaID, req.SegmentID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材或分镜不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "绑定素材失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"media": media})
}
func (api *API) handleSetShuihuoPrimaryMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).SetPrimary(r.Context(), user.ID, mediaID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "只有已绑定分镜的图片可设为主图"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"media": media})
}
func (api *API) handleDeleteShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).Delete(r.Context(), user.ID, mediaID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除素材记录失败"})
		return
	}
	if api.deps.Objects != nil {
		if err := api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), media.ObjectKey, "media_delete"); err != nil {
			writeJSON(w, http.StatusAccepted, map[string]string{"warning": "素材记录已删除，文件清理已加入重试"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
func (api *API) handleDownloadShuihuoMedia(w http.ResponseWriter, r *http.Request) {
	mediaID, ok := parseShuihuoResourceID(w, r, "mediaId", "素材")
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
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
	body, object, err := api.deps.Objects.Get(r.Context(), media.ObjectKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "素材文件不存在"})
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", object.ContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+path.Base(media.ObjectKey)+`"`)
	if _, err := io.Copy(w, body); err != nil {
		return
	}
}
