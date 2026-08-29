package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/store"
)

type contextKey string

const userContextKey contextKey = "user"

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (api *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, err := api.deps.Users.FindByUsername(r.Context(), req.Username)
	if err == sql.ErrNoRows || !auth.CheckPassword(req.Password, user.PasswordHash) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "用户名或密码错误"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Login failed"})
		return
	}
	if !user.IsActive {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "账号已停用"})
		return
	}
	token, err := auth.NewToken(api.deps.TokenSecret, user.ID, user.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Create token failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "username": user.Username})
}

func (api *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := currentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": user.Username})
}

func (api *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		token := strings.TrimSpace(authHeader[len("Bearer "):])
		userID, _, err := auth.ParseToken(api.deps.TokenSecret, token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		user, err := api.deps.Users.FindByID(r.Context(), userID)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		if !user.IsActive {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "账号已停用"})
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requirePlatformAuth accepts the signed identity produced by qiantie's Node
// gateway. Go deliberately does not parse the browser's Node session token,
// keeping one public login system while retaining Go ownership of this module.
func (api *API) requirePlatformAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username := strings.TrimSpace(r.Header.Get("X-Qiantie-Username"))
		issuedAtText := strings.TrimSpace(r.Header.Get("X-Qiantie-Issued-At"))
		signature := strings.TrimSpace(r.Header.Get("X-Qiantie-Signature"))
		ownerText := strings.TrimSpace(r.Header.Get("X-Qiantie-Is-Owner"))
		issuedAt, err := strconv.ParseInt(issuedAtText, 10, 64)
		if err != nil || username == "" || signature == "" || time.Since(time.Unix(issuedAt, 0)) > 60*time.Second || time.Until(time.Unix(issuedAt, 0)) > 10*time.Second {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		isOwner := ownerText == "true"
		payload := strings.Join([]string{username, issuedAtText, strconv.FormatBool(isOwner), r.Method, r.URL.EscapedPath()}, "\n")
		expected := signPlatformRequest(api.deps.BridgeSecret, payload)
		if _, decodeErr := hex.DecodeString(signature); decodeErr != nil || !hmac.Equal([]byte(expected), []byte(signature)) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		user, err := api.deps.Users.EnsureBridgeUser(r.Context(), username, isOwner)
		if err != nil || !user.IsActive {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireBrowserOrPlatformAuth keeps the existing signed Node bridge working
// while allowing the embedded frontend in the single Go binary to call the
// same protected business routes with its normal Bearer token.
func (api *API) requireBrowserOrPlatformAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(strings.ToLower(r.Header.Get("Authorization")), "bearer ") {
			api.requireAuth(next).ServeHTTP(w, r)
			return
		}
		api.requirePlatformAuth(next).ServeHTTP(w, r)
	})
}

func signPlatformRequest(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func (api *API) requireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(r)
		if !ok || !user.IsOwner {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "无管理员权限"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func currentUser(r *http.Request) (store.User, bool) {
	user, ok := r.Context().Value(userContextKey).(store.User)
	return user, ok
}
