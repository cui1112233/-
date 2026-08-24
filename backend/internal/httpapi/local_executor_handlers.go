package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const localExecutorPairingTTL = 10 * time.Minute
const localExecutorOnlineWindow = 90 * time.Second

type localExecutorPairingRequest struct {
	Platform string `json:"platform"`
}

type localExecutorPairRequest struct {
	Code        string `json:"code"`
	DisplayName string `json:"displayName"`
}

type localExecutorHeartbeatRequest struct {
	DisplayName string `json:"displayName"`
}

type localExecutorPublic struct {
	ID          string `json:"id"`
	Platform    string `json:"platform"`
	DisplayName string `json:"displayName"`
	Online      bool   `json:"online"`
	LastSeenAt  string `json:"lastSeenAt,omitempty"`
}

func localExecutorToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func localExecutorHash(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}

func localExecutorIdentifier() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}

func normalizeExecutorPlatform(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "doubao") {
		return "doubao"
	}
	return "doubao"
}

func (api *API) requireLocalExecutorDatabase(w http.ResponseWriter) bool {
	if api.deps.DB != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "本地执行器服务暂不可用"})
	return false
}

func (api *API) handleCreateLocalExecutorPairing(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	var req localExecutorPairingRequest
	if err := readJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, ok := currentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	code, err := localExecutorToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成配对码失败"})
		return
	}
	// A short code is easier to enter in the Windows client. Its entropy is
	// still backed by crypto/rand and it expires quickly.
	code = strings.ToUpper(code[:10])
	expiresAt := time.Now().Add(localExecutorPairingTTL)
	_, err = api.deps.DB.ExecContext(r.Context(), `
INSERT INTO local_executor_pairings(user_id, code_hash, expires_at)
VALUES(?, ?, ?)`, user.ID, localExecutorHash(code), expiresAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存配对码失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"code": code, "platform": normalizeExecutorPlatform(req.Platform), "expiresAt": expiresAt.UTC().Format(time.RFC3339)})
}

func (api *API) handleListLocalExecutors(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	rows, err := api.deps.DB.QueryContext(r.Context(), `
SELECT id, platform, display_name, last_seen_at
FROM local_executors WHERE user_id = ? AND revoked_at IS NULL ORDER BY updated_at DESC`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取本地执行器失败"})
		return
	}
	defer rows.Close()
	items := make([]localExecutorPublic, 0)
	for rows.Next() {
		var item localExecutorPublic
		var lastSeen sql.NullTime
		if err := rows.Scan(&item.ID, &item.Platform, &item.DisplayName, &lastSeen); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取本地执行器失败"})
			return
		}
		if lastSeen.Valid {
			item.LastSeenAt = lastSeen.Time.UTC().Format(time.RFC3339)
			item.Online = time.Since(lastSeen.Time) <= localExecutorOnlineWindow
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"executors": items})
}

func (api *API) handlePairLocalExecutor(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	var req localExecutorPairRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	name := strings.TrimSpace(req.DisplayName)
	if len(code) != 10 || name == "" || len(name) > 128 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "配对码或设备名称无效"})
		return
	}
	tx, err := api.deps.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "本地执行器服务暂不可用"})
		return
	}
	defer tx.Rollback()
	var userID int64
	err = tx.QueryRowContext(r.Context(), `
SELECT user_id FROM local_executor_pairings
WHERE code_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
FOR UPDATE`, localExecutorHash(code)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "配对码无效或已过期"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "验证配对码失败"})
		return
	}
	id, err := localExecutorIdentifier()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成设备标识失败"})
		return
	}
	token, err := localExecutorToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成设备令牌失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE local_executor_pairings SET used_at = UTC_TIMESTAMP() WHERE code_hash = ?`, localExecutorHash(code)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新配对码失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `
INSERT INTO local_executors(id, user_id, platform, display_name, token_hash, last_seen_at)
VALUES(?, ?, 'doubao', ?, ?, UTC_TIMESTAMP())`, id, userID, name, localExecutorHash(token)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "绑定本地执行器失败"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "绑定本地执行器失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"executorId": id, "deviceToken": token, "platform": "doubao"})
}

func (api *API) handleLocalExecutorHeartbeat(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	var req localExecutorHeartbeatRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	result, err := api.deps.DB.ExecContext(r.Context(), `
UPDATE local_executors
SET last_seen_at = UTC_TIMESTAMP(), display_name = CASE WHEN ? <> '' THEN ? ELSE display_name END
WHERE token_hash = ? AND revoked_at IS NULL`, strings.TrimSpace(req.DisplayName), strings.TrimSpace(req.DisplayName), localExecutorHash(token))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新执行器状态失败"})
		return
	}
	rows, _ := result.RowsAffected()
	if rows != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
