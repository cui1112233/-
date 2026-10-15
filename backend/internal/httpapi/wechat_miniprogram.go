package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/miniprogramauth"
)

func registerWechatMiniProgramRoutes(root *http.ServeMux, service *miniprogramauth.Service) {
	root.HandleFunc("GET /api/wechat-miniprogram/session", func(w http.ResponseWriter, req *http.Request) {
		if service == nil {
			writeWechatError(w, http.StatusServiceUnavailable, "微信登录服务尚未配置")
			return
		}
		username, isOwner, err := service.Authenticate(req.Context(), bearerToken(req.Header.Get("Authorization")))
		if err != nil {
			writeWechatError(w, http.StatusUnauthorized, "登录状态已失效")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": miniprogramauth.Account{Username: username, IsOwner: isOwner}})
	})
	root.HandleFunc("POST /api/wechat-miniprogram/session", func(w http.ResponseWriter, req *http.Request) {
		if service == nil {
			writeWechatError(w, http.StatusServiceUnavailable, "微信登录服务尚未配置")
			return
		}
		var input struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, req.Body, 16<<10)).Decode(&input); err != nil {
			writeWechatError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		response, err := service.Session(req.Context(), input.Code)
		if err != nil {
			writeWechatServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	})
	root.HandleFunc("POST /api/wechat-miniprogram/bind", func(w http.ResponseWriter, req *http.Request) {
		if service == nil {
			writeWechatError(w, http.StatusServiceUnavailable, "微信登录服务尚未配置")
			return
		}
		var input struct {
			BindingTicket string `json:"bindingTicket"`
			Username      string `json:"username"`
			Password      string `json:"password"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, req.Body, 16<<10)).Decode(&input); err != nil {
			writeWechatError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		response, err := service.Bind(req.Context(), input.BindingTicket, input.Username, input.Password)
		if err != nil {
			writeWechatServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	})
}

func writeWechatServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, miniprogramauth.ErrUnconfigured):
		writeWechatError(w, http.StatusServiceUnavailable, "微信登录服务尚未配置")
	case errors.Is(err, miniprogramauth.ErrInvalidRequest), errors.Is(err, miniprogramauth.ErrInvalidTicket):
		writeWechatError(w, http.StatusBadRequest, "微信登录凭证或绑定凭证无效")
	case errors.Is(err, miniprogramauth.ErrInvalidCredentials):
		writeWechatError(w, http.StatusUnauthorized, "用户名或密码错误")
	case errors.Is(err, miniprogramauth.ErrIdentityAlreadyBound):
		writeWechatError(w, http.StatusConflict, "该微信已绑定其他账号")
	case errors.Is(err, miniprogramauth.ErrWechatProvider):
		writeWechatError(w, http.StatusBadGateway, "微信登录服务暂不可用")
	default:
		writeWechatError(w, http.StatusServiceUnavailable, "微信登录服务暂不可用")
	}
}

func writeWechatError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func bearerToken(header string) string {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}
