package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

const assetImageTaskKind = "asset_image"

type shuihuoAssetImageGenerationRequest struct {
	AssetIDs                 []int64 `json:"assetIds"`
	ModelID                  int64   `json:"modelId"`
	AspectRatio              string  `json:"aspectRatio"`
	StylePrompt              string  `json:"stylePrompt"`
	CharacterSheetPresetID   string  `json:"characterSheetPresetId"`
	CharacterSheetPromptBody string  `json:"systemPrompt"`
}

func (api *API) handleCreateShuihuoAssetImageTasks(w http.ResponseWriter, r *http.Request) {
	project, ok := api.shuihuoProjectForRequest(w, r)
	if !ok {
		return
	}
	if api.deps.Queue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "图片任务队列未配置，无法提交 AI 生成"})
		return
	}
	var req shuihuoAssetImageGenerationRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产生图请求格式无效"})
		return
	}
	if len(req.AssetIDs) == 0 || len(req.AssetIDs) > 20 || req.ModelID < 0 || !validAssetGenerationAspectRatio(req.AspectRatio) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择 1 到 20 项资产、图片模型和有效画幅"})
		return
	}
	user, _ := currentUser(r)
	accountImageModel := req.ModelID == accountOpenAICompatibleImageModelID
	var model models.Definition
	if accountImageModel {
		config, configured, err := api.accountOpenAICompatibleImageConfig(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取账号图片配置失败"})
			return
		}
		if !configured {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "请先在设置中完成 OpenAI 兼容生图配置"})
			return
		}
		model = models.Definition{Name: config.Model, Kind: models.KindImage, AdapterKind: models.AdapterAccountOpenAICompatibleImage}
	} else {
		loadedModel, err := shuihuostore.NewModels(api.deps.DB).GetEnabled(r.Context(), req.ModelID)
		if err != nil || loadedModel.Kind != models.KindImage || !loadedModel.AvailableTo(shuihuoModelRole(user), false) || !loadedModel.ProviderConfigured() {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "所选图片模型不可用或尚未完成服务端配置"})
			return
		}
		model = loadedModel
	}
	assets := shuihuostore.NewAssets(api.deps.DB)
	tasks := shuihuostore.NewTasks(api.deps.DB)
	created := make([]domain.PublicTask, 0, len(req.AssetIDs))
	seen := map[int64]bool{}
	for _, assetID := range req.AssetIDs {
		if assetID < 1 || seen[assetID] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "资产选择无效"})
			return
		}
		seen[assetID] = true
		asset, getErr := assets.Get(r.Context(), user.ID, assetID)
		if getErr != nil || asset.ProjectID != project.ID || asset.Category == "voice" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "所选资产不存在或不能生成图片"})
			return
		}
		prompt := strings.TrimSpace(asset.Prompt)
		if prompt == "" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "请先填写所选资产的视觉提示词"})
			return
		}
		if asset.Category == "character" && strings.TrimSpace(req.CharacterSheetPromptBody) != "" {
			prompt += "\n\n角色设定要求：\n" + strings.TrimSpace(req.CharacterSheetPromptBody)
		}
		if stylePrompt := strings.TrimSpace(req.StylePrompt); stylePrompt != "" {
			if len([]rune(stylePrompt)) > 4000 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "风格提示词不能超过 4000 字"})
				return
			}
			prompt += "\n\n统一画面风格：\n" + stylePrompt
		}
		input, _ := json.Marshal(map[string]any{
			"assetId": asset.ID, "assetName": asset.Name, "assetCategory": asset.Category,
			"prompt": prompt, "aspectRatio": req.AspectRatio, "model": model.Name,
			"characterSheetPresetId": req.CharacterSheetPresetID,
		})
		if accountImageModel {
			var snapshot map[string]any
			_ = json.Unmarshal(input, &snapshot)
			snapshot["provider"] = models.AdapterAccountOpenAICompatibleImage
			input, _ = json.Marshal(snapshot)
		}
		taskDefinition := domain.Task{Kind: assetImageTaskKind, Status: domain.TaskDraft, Provider: model.AdapterKind, Input: string(input)}
		if !accountImageModel {
			modelID, versionID := model.ID, model.VersionID
			taskDefinition.ModelID, taskDefinition.ModelVersionID = &modelID, &versionID
		}
		task, createErr := tasks.Create(r.Context(), user.ID, project.ID, taskDefinition)
		if createErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建资产图片任务失败"})
			return
		}
		if transitionErr := tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskDraft, domain.TaskQueued, "已进入图片生成队列"); transitionErr != nil {
			_ = tasks.Delete(r.Context(), user.ID, task.ID)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "图片任务无法进入队列"})
			return
		}
		if enqueueErr := api.deps.Queue.Enqueue(r.Context(), task.ID); enqueueErr != nil {
			_ = tasks.Transition(r.Context(), user.ID, task.ID, domain.TaskQueued, domain.TaskCancelled, "图片任务队列提交失败")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "图片任务队列不可用，未提交生成任务"})
			return
		}
		task.Status = domain.TaskQueued
		created = append(created, domain.ToPublicTask(task))
	}
	writeJSON(w, http.StatusCreated, map[string]any{"tasks": created})
}

func validAssetGenerationAspectRatio(value string) bool {
	return value == "16:9" || value == "9:16" || value == "1:1"
}

func (api *API) handleListShuihuoAssetImages(w http.ResponseWriter, r *http.Request) {
	assetID, ok := parseShuihuoResourceID(w, r, "assetId", "资产")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	items, err := shuihuostore.NewAssetImages(api.deps.DB).ListByAsset(r.Context(), user.ID, assetID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产图片失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": items})
}

func (api *API) handleSetShuihuoAssetImagePrimary(w http.ResponseWriter, r *http.Request) {
	imageID, ok := parseShuihuoResourceID(w, r, "assetImageId", "资产图片")
	if !ok {
		return
	}
	user, _ := currentUser(r)
	image, err := shuihuostore.NewAssetImages(api.deps.DB).SetPrimary(r.Context(), user.ID, imageID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产图片不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "设置资产主图失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"image": image})
}

func (api *API) handleDownloadShuihuoGeneratedAssetImage(w http.ResponseWriter, r *http.Request) {
	imageID, ok := parseShuihuoResourceID(w, r, "assetImageId", "资产图片")
	if !ok {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	user, _ := currentUser(r)
	image, err := shuihuostore.NewAssetImages(api.deps.DB).Get(r.Context(), user.ID, imageID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产图片不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取资产图片失败"})
		return
	}
	body, object, err := api.deps.Objects.Get(r.Context(), image.ObjectKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产图片文件不存在"})
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", object.ContentType)
	_, _ = io.Copy(w, body)
}
