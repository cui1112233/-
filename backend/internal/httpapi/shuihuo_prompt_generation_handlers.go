package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/prompts"
	shuihuostore "qiantie/backend/internal/shuihuo/store"

	"github.com/go-chi/chi/v5"
)

const promptCandidateConcurrency = 3

type promptCandidateRequest struct {
	ModelID             int64  `json:"modelId"`
	SystemPrompt        string `json:"systemPrompt"`
	SystemPromptID      string `json:"systemPromptId"`
	SystemPromptVersion int64  `json:"systemPromptVersion"`
}

type promptCandidate struct {
	SegmentID int64  `json:"segmentId"`
	Prompt    string `json:"prompt"`
}

type promptCandidateApplyRequest struct {
	Candidates []promptCandidate `json:"candidates"`
}

type promptCandidateJobError struct {
	message        string
	cause          error
	status         int
	textCompletion bool
}

func (e *promptCandidateJobError) Error() string { return e.message }

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
	configuredModel, completion, configurationErr := api.textCompletionForUser(r.Context(), user.ID, model)
	if configurationErr != nil {
		api.writeTextCompletionError(w, fmt.Errorf("account text configuration: %w", configurationErr))
		return
	}
	segments, err := shuihuostore.NewSegments(api.deps.DB).ListByProject(r.Context(), user.ID, project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取分镜失败"})
		return
	}
	if len(segments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请先确认至少一个分镜"})
		return
	}
	externalPrompt := strings.TrimSpace(req.SystemPrompt)
	service := prompts.NewService(prompts.NewDatabaseRepository(api.deps.DB, purpose), "shuihuo-production")
	assets := shuihuostore.NewAssets(api.deps.DB)
	results, jobsErr := runPromptCandidateJobs(r.Context(), len(segments), func(ctx context.Context, index int) ([]promptCandidate, error) {
		segment := segments[index]
		boundAssets, assetsErr := assets.ListBySegment(ctx, user.ID, segment.ID)
		if assetsErr != nil {
			return nil, &promptCandidateJobError{message: "读取分镜绑定预设失败", cause: assetsErr}
		}
		projectNote := promptProjectNote(boundAssets, purpose)
		var snapshot prompts.PromptSnapshot
		if externalPrompt != "" {
			snapshot = prompts.PromptSnapshot{Rendered: strings.NewReplacer("{{segment_text}}", segment.SourceText, "{{project_note}}", projectNote).Replace(externalPrompt)}
		} else {
			var assembleErr error
			snapshot, assembleErr = service.Assemble(ctx, prompts.Selection{}, prompts.AssembleInput{SegmentText: segment.SourceText, ProjectNote: projectNote})
			if assembleErr != nil {
				return nil, &promptCandidateJobError{message: "读取提示词预设失败", cause: assembleErr}
			}
		}
		raw, completeErr := completion.Complete(ctx, configuredModel, snapshot.Rendered)
		if completeErr != nil {
			return nil, &promptCandidateJobError{message: "文本模型调用失败", cause: completeErr, textCompletion: true}
		}
		parsed, parseErr := parsePromptCandidates(raw, chi.URLParam(r, "kind"))
		if parseErr != nil {
			return nil, &promptCandidateJobError{message: "文本模型返回的提示词格式无效", cause: parseErr, status: http.StatusBadGateway}
		}
		candidates := make([]promptCandidate, 0, len(parsed))
		for _, candidate := range parsed {
			if candidate.SegmentID == 0 {
				candidate.SegmentID = segment.ID
			}
			if candidate.SegmentID == segment.ID {
				candidates = append(candidates, candidate)
			}
		}
		if externalPrompt == "" {
			if _, saveErr := prompts.NewSnapshotStore(api.deps.DB).Save(ctx, user.ID, project.ID, model.ID, model.VersionID, purpose, snapshot); saveErr != nil {
				return nil, &promptCandidateJobError{message: "保存提示词快照失败", cause: saveErr}
			}
		}
		return candidates, nil
	})
	if jobsErr != nil {
		if jobErr, ok := jobsErr.(*promptCandidateJobError); ok {
			if jobErr.textCompletion {
				api.writeTextCompletionError(w, fmt.Errorf("text completion: %w", jobErr.cause))
				return
			}
			status := jobErr.status
			if status == 0 {
				status = http.StatusInternalServerError
			}
			writeJSON(w, status, map[string]string{"error": jobErr.message})
			return
		}
		api.writeTextCompletionError(w, fmt.Errorf("text completion: %w", jobsErr))
		return
	}
	all := make([]promptCandidate, 0, len(segments))
	for _, candidates := range results {
		all = append(all, candidates...)
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": all})
}

func runPromptCandidateJobs(ctx context.Context, count int, work func(context.Context, int) ([]promptCandidate, error)) ([][]promptCandidate, error) {
	if count == 0 {
		return nil, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	workers := promptCandidateConcurrency
	if count < workers {
		workers = count
	}
	results := make([][]promptCandidate, count)
	jobs := make(chan int)
	var firstErr error
	var once sync.Once
	var wait sync.WaitGroup
	setError := func(err error) {
		once.Do(func() {
			firstErr = err
			cancel()
		})
	}

	for worker := 0; worker < workers; worker++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case index, open := <-jobs:
					if !open {
						return
					}
					candidates, err := work(ctx, index)
					if err != nil {
						setError(err)
						return
					}
					results[index] = candidates
				}
			}
		}()
	}

dispatch:
	for index := 0; index < count; index++ {
		select {
		case <-ctx.Done():
			break dispatch
		case jobs <- index:
		}
	}
	close(jobs)
	wait.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func promptProjectNote(assets []domain.Asset, purpose string) string {
	items := make([]string, 0, len(assets))
	for _, asset := range assets {
		if asset.Category == "voice" {
			continue
		}
		items = append(items, fmt.Sprintf("%s：%s", asset.Name, asset.Prompt))
	}
	switch purpose {
	case "image_prompt":
		return "可用资产：" + strings.Join(items, "；")
	default:
		return "可用资产与视觉设定：" + strings.Join(items, "；")
	}
}

func parsePromptCandidates(raw, kind string) ([]promptCandidate, error) {
	var candidates []promptCandidate
	payload := []byte(strings.TrimSpace(raw))
	if err := json.Unmarshal(payload, &candidates); err != nil {
		converted, convertErr := parseStoryboardPromptCandidates(payload, kind)
		if convertErr != nil {
			return nil, err
		}
		candidates = converted
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

func parseStoryboardPromptCandidates(payload []byte, kind string) ([]promptCandidate, error) {
	var document struct {
		Storyboard []struct {
			SegmentID   int64  `json:"segmentId"`
			Prompt      string `json:"prompt"`
			ImagePrompt string `json:"image_prompt"`
			VideoDesc   string `json:"video_desc"`
			VideoPrompt string `json:"video_prompt"`
		} `json:"storyboard"`
	}
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, err
	}
	candidates := make([]promptCandidate, 0, len(document.Storyboard))
	for _, item := range document.Storyboard {
		prompt := strings.TrimSpace(item.Prompt)
		switch kind {
		case "image":
			if prompt == "" {
				prompt = item.ImagePrompt
			}
		case "video":
			if prompt == "" {
				prompt = item.VideoDesc
			}
			if prompt == "" {
				prompt = item.VideoPrompt
			}
		}
		candidates = append(candidates, promptCandidate{SegmentID: item.SegmentID, Prompt: prompt})
	}
	return candidates, nil
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
		if err := segments.UpdatePrompts(r.Context(), user.ID, candidate.SegmentID, imagePrompt, videoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "应用提示词失败"})
			return
		}
		applied = append(applied, candidate.SegmentID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"appliedSegmentIds": applied, "skippedLockedSegmentIds": skipped})
}
