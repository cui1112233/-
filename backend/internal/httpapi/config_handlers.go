package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/store"
)

type ConfigStore interface {
	Get(ctx context.Context, userID int64) (store.APIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.APIConfig) error
}

type ImageConfigStore interface {
	Get(ctx context.Context, userID int64) (store.ImageAPIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.ImageAPIConfig) error
}

type VideoConfigStore interface {
	Get(ctx context.Context, userID int64) (store.VideoAPIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.VideoAPIConfig) error
}

type imageConfigRequest struct {
	Provider    string `json:"provider"`
	DisplayName string `json:"displayName"`
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	APIKey      string `json:"apiKey"`
}

type configRequest struct {
	Provider string              `json:"provider"`
	BaseURL  string              `json:"baseUrl"`
	Model    string              `json:"model"`
	APIKey   string              `json:"apiKey"`
	Image    *imageConfigRequest `json:"image"`
	Video    *videoConfigRequest `json:"video"`
}

type videoConfigRequest struct {
	APIKey string `json:"apiKey"`
}

func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	cfg, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	image, err := api.imageConfig(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read image config failed"})
		return
	}
	video, err := api.videoConfig(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read video config failed"})
		return
	}
	writePublicConfig(w, cfg, image, video)
}

func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	oldConfig, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	var req configRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	video, err := api.saveVideoConfig(r.Context(), user.ID, req.Video)
	if err != nil {
		writeVideoConfigError(w, err)
		return
	}
	next := store.APIConfig{
		Provider:         firstNonEmpty(req.Provider, oldConfig.Provider, "openai"),
		BaseURL:          firstNonEmpty(req.BaseURL, oldConfig.BaseURL, "https://api.openai.com/v1"),
		Model:            firstNonEmpty(req.Model, oldConfig.Model, "gpt-4o-mini"),
		APIKeyCiphertext: firstNonEmpty(req.APIKey, oldConfig.APIKeyCiphertext, ""),
	}
	if err := api.deps.Configs.Save(r.Context(), user.ID, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save config failed"})
		return
	}
	image, err := api.saveImageConfig(r.Context(), user.ID, req.Image)
	if err != nil {
		writeImageConfigError(w, err)
		return
	}
	writePublicConfig(w, next, image, video)
}

// handleSaveBridgeAccountAIConfig accepts a signed Node gateway request. The
// credential remains server-side and is never included in the response.
func (api *API) handleSaveBridgeAccountAIConfig(w http.ResponseWriter, r *http.Request) {
	if api.deps.Configs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "AI 配置服务未就绪"})
		return
	}
	var req configRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	textProvided := strings.TrimSpace(req.Provider) != "" || strings.TrimSpace(req.BaseURL) != "" || strings.TrimSpace(req.Model) != "" || strings.TrimSpace(req.APIKey) != ""
	var textConfig store.APIConfig
	if textProvided {
		textConfig = store.APIConfig{
			Provider:         strings.TrimSpace(req.Provider),
			BaseURL:          strings.TrimSpace(req.BaseURL),
			Model:            strings.TrimSpace(req.Model),
			APIKeyCiphertext: strings.TrimSpace(req.APIKey),
		}
		if textConfig.Provider == "" {
			textConfig.Provider = "custom"
		}
		if textConfig.BaseURL == "" || textConfig.Model == "" || textConfig.APIKeyCiphertext == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "API 地址、模型名和密钥不能为空"})
			return
		}
		if err := api.deps.Configs.Save(r.Context(), user.ID, textConfig); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存 AI 配置失败"})
			return
		}
	}
	image, err := api.saveImageConfig(r.Context(), user.ID, req.Image)
	if err != nil {
		writeImageConfigError(w, err)
		return
	}
	if !textProvided && req.Image == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "至少需要一项完整的 AI 配置"})
		return
	}
	writePublicConfig(w, textConfig, image, store.VideoAPIConfig{Provider: store.YDVideoProvider})
}

func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Config endpoint is reachable"})
}

func (api *API) imageConfig(ctx context.Context, userID int64) (store.ImageAPIConfig, error) {
	if api.deps.ImageConfigs == nil {
		return store.ImageAPIConfig{}, nil
	}
	return api.deps.ImageConfigs.Get(ctx, userID)
}

func (api *API) videoConfig(ctx context.Context, userID int64) (store.VideoAPIConfig, error) {
	if api.deps.VideoConfigs == nil {
		return store.VideoAPIConfig{Provider: store.YDVideoProvider}, nil
	}
	return api.deps.VideoConfigs.Get(ctx, userID)
}

func (api *API) saveVideoConfig(ctx context.Context, userID int64, req *videoConfigRequest) (store.VideoAPIConfig, error) {
	if req == nil || strings.TrimSpace(req.APIKey) == "" {
		return api.videoConfig(ctx, userID)
	}
	if api.deps.VideoConfigs == nil || api.deps.CredentialCipher == nil {
		return store.VideoAPIConfig{}, errVideoConfigUnavailable
	}
	ciphertext, err := api.deps.CredentialCipher.Encrypt(req.APIKey)
	if err != nil {
		return store.VideoAPIConfig{}, errVideoConfigUnavailable
	}
	next := store.VideoAPIConfig{Provider: store.YDVideoProvider, APIKeyCiphertext: ciphertext}
	if err := api.deps.VideoConfigs.Save(ctx, userID, next); err != nil {
		return store.VideoAPIConfig{}, err
	}
	return next, nil
}

func (api *API) saveImageConfig(ctx context.Context, userID int64, req *imageConfigRequest) (store.ImageAPIConfig, error) {
	current, err := api.imageConfig(ctx, userID)
	if err != nil || req == nil {
		return current, err
	}
	if strings.TrimSpace(req.Provider) != store.OpenAICompatibleImageProvider {
		return store.ImageAPIConfig{}, errInvalidImageConfig
	}
	next := store.ImageAPIConfig{
		Provider:         store.OpenAICompatibleImageProvider,
		DisplayName:      strings.TrimSpace(req.DisplayName),
		BaseURL:          strings.TrimSpace(req.BaseURL),
		Model:            strings.TrimSpace(req.Model),
		APIKeyCiphertext: firstNonEmpty(strings.TrimSpace(req.APIKey), current.APIKeyCiphertext),
	}
	if !next.Configured() {
		return store.ImageAPIConfig{}, errInvalidImageConfig
	}
	if api.deps.ImageConfigs == nil {
		return store.ImageAPIConfig{}, errImageConfigUnavailable
	}
	if err := api.deps.ImageConfigs.Save(ctx, userID, next); err != nil {
		return store.ImageAPIConfig{}, err
	}
	return next, nil
}

var (
	errInvalidImageConfig     = errors.New("图片服务需要 OpenAI 兼容供应商、API 地址、模型名和密钥")
	errImageConfigUnavailable = errors.New("图片配置服务未就绪")
	errVideoConfigUnavailable = errors.New("视频配置服务未就绪")
)

func writeVideoConfigError(w http.ResponseWriter, err error) {
	if errors.Is(err, errVideoConfigUnavailable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "视频配置服务暂不可用"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存视频配置失败"})
}

func writeImageConfigError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInvalidImageConfig):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, errImageConfigUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存图片配置失败"})
	}
}

func writePublicConfig(w http.ResponseWriter, cfg store.APIConfig, image store.ImageAPIConfig, video store.VideoAPIConfig) {
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":  cfg.Provider,
		"baseUrl":   cfg.BaseURL,
		"model":     cfg.Model,
		"hasApiKey": cfg.APIKeyCiphertext != "",
		"image": map[string]any{
			"provider":    image.Provider,
			"displayName": image.DisplayName,
			"baseUrl":     image.BaseURL,
			"model":       image.Model,
			"hasApiKey":   image.APIKeyCiphertext != "",
		},
		"video": map[string]any{
			"provider":    store.YDVideoProvider,
			"displayName": "中转亚迪",
			"hasApiKey":   video.Configured(),
		},
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
