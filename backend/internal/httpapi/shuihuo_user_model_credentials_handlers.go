package httpapi

import (
	"net/http"
	"strings"

	"qiantie/backend/internal/shuihuo/models"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

const yadiUserCredentialRef = "user:yadi"

func (api *API) handleGetShuihuoVideoModelCredentials(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	credentials := shuihuostore.NewUserModelCredentials(api.deps.DB, api.deps.TokenSecret)
	configured, err := credentials.Configured(r.Context(), user.ID, yadiUserCredentialRef)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取视频模型密钥状态失败"})
		return
	}
	catalog, err := shuihuostore.NewModels(api.deps.DB).ListEnabled(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取视频模型失败"})
		return
	}
	items := make([]models.PublicModel, 0)
	for _, model := range catalog {
		if model.AdapterKind == models.AdapterYadiVideo && model.PubliclySelectable() {
			items = append(items, models.ToPublic(model))
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":      "yadi",
		"label":         "Yadi 视频生成",
		"credentialRef": yadiUserCredentialRef,
		"configured":    configured,
		"models":        items,
	})
}

func (api *API) handleSaveShuihuoVideoModelCredentials(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	var request struct {
		APIKey string `json:"apiKey"`
	}
	if err := readJSON(r, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" || len(apiKey) > 1024 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请输入有效的 Yadi API Key"})
		return
	}
	// Yadi OpenAPI only accepts API Keys created in token management. Reject
	// obvious cookie/console-token values before they become a confusing queued
	// generation failure, while keeping future sk-yadi-* variants compatible.
	if !strings.HasPrefix(apiKey, "sk-yadi-") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Yadi 视频任务只接受令牌管理中创建的 sk-yadi- API Key"})
		return
	}
	user, _ := currentUser(r)
	credentials := shuihuostore.NewUserModelCredentials(api.deps.DB, api.deps.TokenSecret)
	if err := credentials.Save(r.Context(), user.ID, yadiUserCredentialRef, apiKey); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存 Yadi API Key 失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "configured": true})
}

func (api *API) handleDeleteShuihuoVideoModelCredentials(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	credentials := shuihuostore.NewUserModelCredentials(api.deps.DB, api.deps.TokenSecret)
	if err := credentials.Delete(r.Context(), user.ID, yadiUserCredentialRef); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除 Yadi API Key 失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "configured": false})
}
