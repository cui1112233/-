package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/documents"
	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type shuihuoObjectCleanupRecordError struct{ err error }

func (e *shuihuoObjectCleanupRecordError) Error() string { return e.err.Error() }
func (e *shuihuoObjectCleanupRecordError) Unwrap() error { return e.err }

type shuihuoProjectRequest struct {
	Name       string `json:"name"`
	SourceText string `json:"sourceText"`
}
type shuihuoImportProjectRequest struct {
	Name     string `json:"name"`
	Filename string `json:"filename"`
	DataURL  string `json:"dataUrl"`
}
type shuihuoSourceReplacementRequest struct {
	SourceText string `json:"sourceText"`
}
type shuihuoAssetRequest struct {
	Category           string `json:"category"`
	Name               string `json:"name"`
	Prompt             string `json:"prompt"`
	VoiceAssetID       *int64 `json:"voiceAssetId"`
	Source             string `json:"source"`
	ReferenceObjectKey string `json:"referenceObjectKey"`
	ManuallyEdited     bool   `json:"manuallyEdited"`
}

func validShuihuoAssetCategory(category string) bool {
	return category == "character" || category == "scene" || category == "prop" || category == "voice"
}

func (api *API) handleListShuihuoProjects(w http.ResponseWriter, r *http.Request) {
	if api.deps.DB == nil {
		writeJSON(w, http.StatusOK, map[string]any{"projects": []any{}})
		return
	}
	user, _ := currentUser(r)
	projects, err := shuihuostore.NewProjects(api.deps.DB).List(r.Context(), user.ID, 100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取作品失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (api *API) handleCreateShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var req shuihuoProjectRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "作品名称不能为空"})
		return
	}
	user, _ := currentUser(r)
	project, err := shuihuostore.NewProjects(api.deps.DB).Create(r.Context(), user.ID, domain.Project{Name: strings.TrimSpace(req.Name), SourceText: req.SourceText, SegmentationStatus: "draft"})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建作品失败"})
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (api *API) handleListShuihuoProjectFiles(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取作品文件失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hasSourceFile": project.SourceObjectKey != "",
		"media":         media,
	})
}

func (api *API) handleGetShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	projectID, err := parseShuihuoID(r, "id")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	api.writeShuihuoProjectReadModel(w, r, projectID, http.StatusOK)
}

func (api *API) writeShuihuoProjectReadModel(w http.ResponseWriter, r *http.Request, projectID int64, status int) {
	api.writeShuihuoProjectReadModelWithWarning(w, r, projectID, status, "")
}

func (api *API) writeShuihuoProjectReadModelWithWarning(w http.ResponseWriter, r *http.Request, projectID int64, status int, warning string) {
	user, _ := currentUser(r)
	readModel, err := shuihuostore.NewSourceUnits(api.deps.DB).ReadProject(r.Context(), user.ID, projectID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目工作台失败"})
		return
	}
	payload := map[string]any{
		"project":              readModel.Project,
		"segments":             readModel.Segments,
		"sourceUnits":          readModel.SourceUnits,
		"segmentSourceUnitIDs": readModel.SegmentSourceUnitIDs,
		"assets":               readModel.Assets,
		"segmentAssetIDs":      readModel.SegmentAssetIDs,
		"media":                readModel.Media,
	}
	if warning != "" {
		payload["warning"] = warning
	}
	writeJSON(w, status, payload)
}

func (api *API) handleDeleteShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	projectID, err := parseShuihuoID(r, "id")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	user, _ := currentUser(r)
	project, err := shuihuostore.NewProjects(api.deps.DB).GetProject(r.Context(), user.ID, projectID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目失败"})
		return
	}
	media, err := shuihuostore.NewMedia(api.deps.DB).ListByProject(r.Context(), user.ID, projectID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取项目素材失败"})
		return
	}
	if err := shuihuostore.NewProjects(api.deps.DB).Delete(r.Context(), user.ID, projectID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "删除项目失败"})
		return
	}
	warning := false
	if project.SourceObjectKey != "" && api.deps.Objects != nil {
		warning = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), project.SourceObjectKey, "project_delete_source") != nil
	}
	if api.deps.Objects != nil {
		for _, item := range media {
			if item.ObjectKey != "" && api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), item.ObjectKey, "project_delete_media") != nil {
				warning = true
			}
		}
	}
	if warning {
		writeJSON(w, http.StatusAccepted, map[string]string{"warning": "项目已删除，部分素材文件清理已加入重试"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleImportShuihuoProject(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "原始文档存储未配置"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, documents.MaxDocumentBytes*2)
	var req shuihuoImportProjectRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入请求格式无效"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "作品名称不能为空"})
		return
	}
	contentType, raw, err := decodeShuihuoImportDataURL(req.DataURL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入文件数据格式无效"})
		return
	}
	sourceText, _, err := documents.ParseUpload(req.Filename, contentType, raw)
	if err != nil {
		api.writeShuihuoDocumentError(w, err)
		return
	}

	user, _ := currentUser(r)
	projects := shuihuostore.NewProjects(api.deps.DB)
	project, err := projects.Create(r.Context(), user.ID, domain.Project{Name: name, SourceText: sourceText, SegmentationStatus: shuihuostore.ImportingSegmentationStatus})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建导入项目失败"})
		return
	}
	objectKey, err := shuihuostorage.ObjectKey(user.ID, project.ID, "source", req.Filename)
	if err != nil {
		_ = api.compensateFailedShuihuoImport(r.Context(), user.ID, project.ID, "", "import_unsafe_filename")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入文件名不安全"})
		return
	}
	if _, err := api.deps.Objects.Put(r.Context(), objectKey, bytes.NewReader(raw), contentType); err != nil {
		cleanupErr := api.compensateFailedShuihuoImport(r.Context(), user.ID, project.ID, objectKey, "import_put_compensation")
		api.writeShuihuoImportFailure(w, "保存原始导入文件失败", cleanupErr)
		return
	}
	if err := projects.SetSourceObjectKey(r.Context(), user.ID, project.ID, objectKey); err != nil {
		cleanupErr := api.compensateFailedShuihuoImport(r.Context(), user.ID, project.ID, objectKey, "import_source_key_compensation")
		api.writeShuihuoImportFailure(w, "保存导入项目来源失败", cleanupErr)
		return
	}
	api.writeShuihuoProjectReadModel(w, r, project.ID, http.StatusCreated)
}

func (api *API) handleReplaceShuihuoSource(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	projectID, err := parseShuihuoID(r, "id")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的项目 ID"})
		return
	}
	var req shuihuoSourceReplacementRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	_, oldObjectKey, err := shuihuostore.NewProjects(api.deps.DB).ReplaceSource(r.Context(), user.ID, projectID, req.SourceText)
	if errors.Is(err, shuihuostore.ErrEmptySourceText) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "原文不能为空"})
		return
	}
	if errors.Is(err, shuihuostore.ErrSourceReplacementHasActiveTasks) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "存在进行中的生成任务，请先取消或等待完成"})
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "替换原文失败"})
		return
	}
	warning := ""
	if oldObjectKey != "" && api.deps.Objects != nil {
		if err := api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), oldObjectKey, "pasted_source_replacement"); err != nil {
			// The database replacement has committed. Do not roll it back or make
			// clients retry it; disclose the cleanup failure with the successful
			// workbench response instead.
			warning = "原始导入文件清理未完成，请联系管理员处理"
		}
	}
	api.writeShuihuoProjectReadModelWithWarning(w, r, projectID, http.StatusOK, warning)
}

// deleteShuihuoObjectWithDeferredCleanup records intent before calling object
// storage. A failed delete therefore leaves a durable, administrator-runnable
// record even when the related project has already been removed.
func (api *API) deleteShuihuoObjectWithDeferredCleanup(ctx context.Context, objectKey, reason string) error {
	if api.deps.Objects == nil {
		return errors.New("object storage is not configured")
	}
	cleanups := shuihuostore.NewObjectCleanups(api.deps.DB)
	if err := cleanups.Schedule(ctx, objectKey, reason); err != nil {
		return &shuihuoObjectCleanupRecordError{err: fmt.Errorf("schedule object cleanup: %w", err)}
	}
	token, err := newShuihuoCleanupLeaseToken()
	if err != nil {
		return err
	}
	claimed, err := cleanups.ClaimKey(ctx, objectKey, token, time.Now(), shuihuoObjectCleanupLeaseDuration)
	if err != nil {
		return &shuihuoObjectCleanupRecordError{err: fmt.Errorf("claim object cleanup: %w", err)}
	}
	if !claimed {
		return nil
	}
	deleteCtx, cancel := context.WithTimeout(ctx, shuihuoObjectCleanupDeleteTimeout)
	deleteErr := api.deps.Objects.Delete(deleteCtx, objectKey)
	cancel()
	if deleteErr != nil {
		owned, recordErr := cleanups.RecordClaimFailure(ctx, objectKey, token, deleteErr)
		if recordErr != nil {
			return &shuihuoObjectCleanupRecordError{err: fmt.Errorf("delete object: %w; record cleanup failure: %v", deleteErr, recordErr)}
		}
		if !owned {
			return errShuihuoObjectCleanupLeaseLost
		}
		return fmt.Errorf("delete object: %w", deleteErr)
	}
	removed, err := cleanups.RemoveClaimed(ctx, objectKey, token)
	if err != nil {
		return fmt.Errorf("clear successful object cleanup: %w", err)
	}
	if !removed {
		return errShuihuoObjectCleanupLeaseLost
	}
	return nil
}

// compensateFailedShuihuoImport keeps the project in its hidden importing
// state until it can be deleted. The persistent record lets an owner retry a
// failed database deletion without exposing the partial project to the user.
func (api *API) compensateFailedShuihuoImport(ctx context.Context, userID, projectID int64, objectKey, reason string) error {
	imports := shuihuostore.NewImportCleanups(api.deps.DB)
	if err := imports.Schedule(ctx, domain.ImportCleanup{ProjectID: projectID, UserID: userID, ObjectKey: objectKey, Reason: reason}); err != nil {
		return fmt.Errorf("schedule import compensation: %w", err)
	}
	var cleanupErr error
	if objectKey != "" {
		cleanupErr = api.deleteShuihuoObjectWithDeferredCleanup(ctx, objectKey, reason)
	}
	if err := shuihuostore.NewProjects(api.deps.DB).Delete(ctx, userID, projectID); err != nil {
		if recordErr := imports.RecordAttemptFailure(ctx, projectID, err); recordErr != nil {
			return fmt.Errorf("delete import project: %w; record compensation failure: %v", err, recordErr)
		}
		return fmt.Errorf("delete import project: %w", err)
	}
	if cleanupErr == nil {
		if err := imports.Remove(ctx, projectID); err != nil {
			return fmt.Errorf("clear import compensation: %w", err)
		}
	}
	return cleanupErr
}

func (api *API) writeShuihuoImportFailure(w http.ResponseWriter, message string, cleanupErr error) {
	if cleanupErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": message + "；导入残留已隔离并加入重试，请联系管理员处理"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": message})
}

func decodeShuihuoImportDataURL(dataURL string) (string, []byte, error) {
	if !strings.HasPrefix(dataURL, "data:") {
		return "", nil, errors.New("not a data URL")
	}
	header, encoded, found := strings.Cut(strings.TrimPrefix(dataURL, "data:"), ",")
	if !found || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", nil, errors.New("data URL must be base64")
	}
	contentType, _, err := mime.ParseMediaType(header[:len(header)-len(";base64")])
	if err != nil || contentType == "" {
		return "", nil, errors.New("invalid data URL media type")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, err
	}
	return strings.ToLower(contentType), raw, nil
}

func (api *API) writeShuihuoDocumentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, documents.ErrUnsupportedDocument):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "仅支持 TXT、SRT 或 DOCX 文档"})
	case errors.Is(err, documents.ErrUnsafeFilename):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入文件名不安全"})
	case errors.Is(err, documents.ErrInvalidMIMEType):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "文件类型与扩展名不匹配"})
	case errors.Is(err, documents.ErrDocumentTooLarge):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入文件不能超过 5 MiB"})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "导入内容不能为空或格式无效"})
	}
}

func (api *API) handleListShuihuoAssets(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	assets, err := shuihuostore.NewAssets(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
}

func (api *API) handleCreateShuihuoAsset(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoAssetRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.Name) == "" || !validShuihuoAssetCategory(req.Category) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产名称不能为空"})
		return
	}
	user, _ := currentUser(r)
	asset, err := shuihuostore.NewAssets(api.deps.DB).Create(r.Context(), user.ID, project.ID, domain.Asset{Category: req.Category, Name: strings.TrimSpace(req.Name), Prompt: req.Prompt, VoiceAssetID: req.VoiceAssetID, Source: firstNonEmpty(req.Source, "manual"), ReferenceObjectKey: req.ReferenceObjectKey, ManuallyEdited: req.ManuallyEdited})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建资产失败"})
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (api *API) handleUpdateShuihuoAsset(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	var req shuihuoAssetRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产编辑请求格式无效"})
		return
	}
	if strings.TrimSpace(req.Name) == "" || !validShuihuoAssetCategory(req.Category) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产名称或类型无效"})
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
	asset.Category, asset.Name, asset.Prompt, asset.VoiceAssetID, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited = req.Category, strings.TrimSpace(req.Name), req.Prompt, req.VoiceAssetID, req.ReferenceObjectKey, firstNonEmpty(req.Source, "manual"), req.ManuallyEdited
	if err := assets.Update(r.Context(), user.ID, asset); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新资产失败"})
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
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除资产失败"})
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) requireShuihuoDatabase(w http.ResponseWriter) bool {
	if api.deps.DB != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "水货生产数据库未连接"})
	return false
}

func parseShuihuoID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id < 1 {
		return 0, sql.ErrNoRows
	}
	return id, nil
}

func isNotFound(err error) bool { return errors.Is(err, sql.ErrNoRows) }

func (api *API) handleListAdminModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}
