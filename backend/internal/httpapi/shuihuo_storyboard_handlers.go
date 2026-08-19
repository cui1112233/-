package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

type shuihuoStoryboardInsertRequest struct {
	SourceText   string `json:"sourceText"`
	SubtitleText string `json:"subtitleText"`
}

type shuihuoStoryboardUpdateRequest struct {
	SubtitleText         string `json:"subtitleText"`
	Speaker              string `json:"speaker"`
	ImagePrompt          string `json:"imagePrompt"`
	VideoPrompt          string `json:"videoPrompt"`
	NegativePrompt       string `json:"negativePrompt"`
	ImagePromptLocked    bool   `json:"imagePromptLocked"`
	VideoPromptLocked    bool   `json:"videoPromptLocked"`
	NegativePromptLocked bool   `json:"negativePromptLocked"`
}

type shuihuoStoryboardAssetsRequest struct {
	AssetIDs []int64 `json:"assetIds"`
}

type shuihuoStoryboardOrderRequest struct {
	SegmentIDs []int64 `json:"segmentIds"`
}

func (api *API) handleMergeShuihuoStoryboard(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	segment, err := shuihuostore.NewSourceUnits(api.deps.DB).MergeIntoPrevious(r.Context(), user.ID, segmentID)
	if !api.writeShuihuoStoryboardError(w, err, "合并分镜失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segment.ProjectID, http.StatusOK)
}

func (api *API) handleSplitShuihuoStoryboard(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	segments, err := shuihuostore.NewSourceUnits(api.deps.DB).Split(r.Context(), user.ID, segmentID)
	if !api.writeShuihuoStoryboardError(w, err, "拆分分镜失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segments[0].ProjectID, http.StatusOK)
}

func (api *API) handleInsertShuihuoStoryboard(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	var req shuihuoStoryboardInsertRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if strings.TrimSpace(req.SourceText) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "插入分镜原文不能为空"})
		return
	}
	user, _ := currentUser(r)
	segment, err := shuihuostore.NewSourceUnits(api.deps.DB).InsertAfter(r.Context(), user.ID, segmentID, req.SourceText, req.SubtitleText)
	if !api.writeShuihuoStoryboardError(w, err, "插入分镜失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segment.ProjectID, http.StatusOK)
}

func (api *API) handleUpdateShuihuoStoryboard(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	var req shuihuoStoryboardUpdateRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜编辑请求格式无效"})
		return
	}
	user, _ := currentUser(r)
	segments := shuihuostore.NewSegments(api.deps.DB)
	segment, err := segments.GetSegment(r.Context(), user.ID, segmentID)
	if !api.writeShuihuoStoryboardError(w, err, "读取分镜失败") {
		return
	}
	// Source text and row order are owned by reversible source-unit operations.
	// The workbench can edit only the task-facing fields in this endpoint.
	segment.SubtitleText = req.SubtitleText
	segment.Speaker = strings.TrimSpace(req.Speaker)
	if segment.Speaker == "" {
		segment.Speaker = "旁白"
	}
	segment.ImagePrompt = req.ImagePrompt
	segment.VideoPrompt = req.VideoPrompt
	segment.NegativePrompt = req.NegativePrompt
	segment.ImagePromptLocked = req.ImagePromptLocked
	segment.VideoPromptLocked = req.VideoPromptLocked
	segment.NegativePromptLocked = req.NegativePromptLocked
	segment.ManuallyEdited = true
	if err := segments.Update(r.Context(), user.ID, segment); !api.writeShuihuoStoryboardError(w, err, "保存分镜文案失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segment.ProjectID, http.StatusOK)
}

func (api *API) handleDeleteShuihuoStoryboard(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	segments := shuihuostore.NewSegments(api.deps.DB)
	segment, err := segments.GetSegment(r.Context(), user.ID, segmentID)
	if !api.writeShuihuoStoryboardError(w, err, "读取分镜失败") {
		return
	}
	if err := segments.Delete(r.Context(), user.ID, segmentID); !api.writeShuihuoStoryboardError(w, err, "删除分镜失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segment.ProjectID, http.StatusOK)
}

func (api *API) handleReplaceShuihuoStoryboardAssets(w http.ResponseWriter, r *http.Request) {
	segmentID, ok := api.shuihuoStoryboardSegmentID(w, r)
	if !ok {
		return
	}
	var req shuihuoStoryboardAssetsRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "预设绑定请求格式无效"})
		return
	}
	if !validStoryboardAssetIDs(req.AssetIDs) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "预设绑定参数无效"})
		return
	}
	user, _ := currentUser(r)
	segments := shuihuostore.NewSegments(api.deps.DB)
	segment, err := segments.GetSegment(r.Context(), user.ID, segmentID)
	if !api.writeShuihuoStoryboardError(w, err, "读取分镜失败") {
		return
	}
	if err := shuihuostore.NewAssets(api.deps.DB).ReplaceSegmentAssets(r.Context(), user.ID, segmentID, req.AssetIDs); !api.writeShuihuoStoryboardError(w, err, "保存预设绑定失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, segment.ProjectID, http.StatusOK)
}

func (api *API) handleReorderShuihuoStoryboards(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	var req shuihuoStoryboardOrderRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜排序请求格式无效"})
		return
	}
	if !validStoryboardOrder(req.SegmentIDs) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜排序参数无效"})
		return
	}
	user, _ := currentUser(r)
	if err := shuihuostore.NewSegments(api.deps.DB).Reorder(r.Context(), user.ID, project.ID, req.SegmentIDs); !api.writeShuihuoStoryboardError(w, err, "调整分镜顺序失败") {
		return
	}
	api.writeShuihuoProjectReadModel(w, r, project.ID, http.StatusOK)
}

func validStoryboardAssetIDs(ids []int64) bool {
	if len(ids) > 100 {
		return false
	}
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id < 1 {
			return false
		}
		if _, duplicate := seen[id]; duplicate {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

func validStoryboardOrder(ids []int64) bool {
	if len(ids) == 0 || len(ids) > 500 {
		return false
	}
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id < 1 {
			return false
		}
		if _, duplicate := seen[id]; duplicate {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

func (api *API) shuihuoStoryboardSegmentID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if !api.requireShuihuoDatabase(w) {
		return 0, false
	}
	segmentID, err := parseShuihuoID(r, "segmentId")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的分镜 ID"})
		return 0, false
	}
	return segmentID, true
}

// writeShuihuoStoryboardError returns true only when the mutation succeeded.
func (api *API) writeShuihuoStoryboardError(w http.ResponseWriter, err error, fallback string) bool {
	if err == nil {
		return true
	}
	switch {
	case errors.Is(err, shuihuostore.ErrStoryboardMutationHasActiveTasks):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "存在进行中的生成任务，请先取消或等待完成"})
	case errors.Is(err, shuihuostore.ErrCannotMergeFirstStoryboard):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "第一条分镜不能向上合并"})
	case errors.Is(err, shuihuostore.ErrCannotSplitSingleSource):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "当前分镜只有一个原文单元，无法拆分"})
	case errors.Is(err, shuihuostore.ErrMappedSegmentStructureChange):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "原文与分镜顺序只能通过合并、拆分、插入或排序操作修改"})
	case errors.Is(err, shuihuostore.ErrSegmentAssetUnavailable):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "预设不存在或不属于当前项目"})
	case errors.Is(err, sql.ErrNoRows):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分镜不存在"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fallback})
	}
	return false
}
