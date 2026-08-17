package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/prompts"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

type promptCandidateRequest struct {
	ModelID int64 `json:"modelId"`
}

type promptCandidate struct {
	SegmentID int64  `json:"segmentId"`
	Prompt    string `json:"prompt"`
}

type promptCandidateApplyRequest struct {
	Candidates []promptCandidate `json:"candidates"`
}

func promptPurpose(kind string) (string, bool) {
	if kind == "image" {
		return "image_prompt", true
	}
	if kind == "video" {
		return "video_prompt", true
	}
	return "", false
}

func (api *API) handleGenerateShuihuoPromptCandidates(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	purpose, ok := promptPurpose(chi.URLParam(r, "kind"))
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "提示词类型无效"})
		return
	}
	var req promptCandidateRequest
	if err := readJSON(r, &req); err != nil || req.ModelID < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择文本模型"})
		return
	}
	model, ok := api.shuihuoTextModel(w, r, req.ModelID)
	if !ok {
		return
	}
	user, _ := currentUser(r)
	segments, err := shuihuostore.NewSegments(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分镜失败"})
		return
	}
	if len(segments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请先确认至少一个分镜"})
		return
	}
	projectNote := promptProjectNote(dataAssets(r, api, project.ID), purpose == "image_prompt")
	service := prompts.NewService(prompts.NewDatabaseRepository(api.deps.DB, purpose), "shuihuo-production")
	all := make([]promptCandidate, 0, len(segments))
	for _, segment := range segments {
		snapshot, assembleErr := service.Assemble(r.Context(), prompts.Selection{}, prompts.AssembleInput{SegmentText: segment.SourceText, ProjectNote: projectNote})
		if assembleErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取提示词预设失败"})
			return
		}
		raw, completeErr := api.deps.TextCompletion.Complete(r.Context(), model, snapshot.Rendered)
		if completeErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型调用失败，请检查管理员服务端配置"})
			return
		}
		parsed, parseErr := parsePromptCandidates(raw)
		if parseErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "文本模型返回的提示词格式无效"})
			return
		}
		for _, candidate := range parsed {
			if candidate.SegmentID == 0 {
				candidate.SegmentID = segment.ID
			}
			if candidate.SegmentID == segment.ID {
				all = append(all, candidate)
			}
		}
		if _, saveErr := prompts.NewSnapshotStore(api.deps.DB).Save(r.Context(), user.ID, project.ID, model.ID, model.VersionID, purpose, snapshot); saveErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存提示词快照失败"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": all})
}

func dataAssets(r *http.Request, api *API, projectID int64) []domain.Asset {
	user, _ := currentUser(r)
	assets, err := shuihuostore.NewAssets(api.deps.DB).ListByProject(r.Context(), user.ID, projectID)
	if err != nil {
		return nil
	}
	return assets
}

func promptProjectNote(assets []domain.Asset, image bool) string {
	items := make([]string, 0, len(assets))
	for _, asset := range assets {
		items = append(items, fmt.Sprintf("%s：%s", asset.Name, asset.Prompt))
	}
	if image {
		return "可用资产：" + strings.Join(items, "；")
	}
	return "可用资产与视觉设定：" + strings.Join(items, "；")
}

func parsePromptCandidates(raw string) ([]promptCandidate, error) {
	var candidates []promptCandidate
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &candidates); err != nil {
		return nil, err
	}
	valid := make([]promptCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		candidate.Prompt = strings.TrimSpace(candidate.Prompt)
		if candidate.Prompt != "" {
			valid = append(valid, candidate)
		}
	}
	if len(valid) == 0 {
		return nil, fmt.Errorf("prompt candidates are empty")
	}
	return valid, nil
}

func (api *API) handleApplyShuihuoPromptCandidates(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	kind := chi.URLParam(r, "kind")
	if _, ok := promptPurpose(kind); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "提示词类型无效"})
		return
	}
	var req promptCandidateApplyRequest
	if err := readJSON(r, &req); err != nil || len(req.Candidates) == 0 || len(req.Candidates) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请提交 1 到 100 条提示词候选"})
		return
	}
	user, _ := currentUser(r)
	segments := shuihuostore.NewSegments(api.deps.DB)
	applied := make([]int64, 0, len(req.Candidates))
	skipped := make([]int64, 0)
	for _, candidate := range req.Candidates {
		candidate.Prompt = strings.TrimSpace(candidate.Prompt)
		if candidate.SegmentID < 1 || candidate.Prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "提示词候选格式无效"})
			return
		}
		segment, err := segments.GetSegment(r.Context(), user.ID, candidate.SegmentID)
		if err != nil || segment.ProjectID != project.ID {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "分镜不存在"})
			return
		}
		if kind == "image" && segment.ImagePromptLocked || kind == "video" && segment.VideoPromptLocked {
			skipped = append(skipped, candidate.SegmentID)
			continue
		}
		imagePrompt, videoPrompt := segment.ImagePrompt, segment.VideoPrompt
		if kind == "image" {
			imagePrompt = candidate.Prompt
		} else {
			videoPrompt = candidate.Prompt
		}
		if err := segments.UpdatePrompts(r.Context(), user.ID, candidate.SegmentID, imagePrompt, videoPrompt, segment.ImagePromptLocked, segment.VideoPromptLocked); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "应用提示词失败"})
			return
		}
		applied = append(applied, candidate.SegmentID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"appliedSegmentIds": applied, "skippedLockedSegmentIds": skipped})
}
