package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

const localExecutorPairingTTL = 10 * time.Minute
const localExecutorOnlineWindow = 90 * time.Second
const localExecutorMaxVideoBytes = 512 << 20

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

type localExecutorJobStatusRequest struct {
	Status  string `json:"status"`
	Message string `json:"message"`
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

func (api *API) localExecutorIdentity(ctx context.Context, token string) (string, int64, error) {
	var id string
	var userID int64
	err := api.deps.DB.QueryRowContext(ctx, `SELECT id, user_id FROM local_executors WHERE token_hash = ? AND revoked_at IS NULL`, localExecutorHash(token)).Scan(&id, &userID)
	return id, userID, err
}

func (api *API) handleClaimLocalExecutorJob(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	executorID, userID, err := api.localExecutorIdentity(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	tx, err := api.deps.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "任务服务暂不可用"})
		return
	}
	defer tx.Rollback()
	var id, sourceKind, prompt, input string
	var sourceTaskID sql.NullInt64
	err = tx.QueryRowContext(r.Context(), `SELECT id, source_kind, source_task_id, prompt, input_json FROM local_executor_jobs WHERE user_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1 FOR UPDATE`, userID).Scan(&id, &sourceKind, &sourceTaskID, &prompt, &input)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"job": nil})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取任务失败"})
		return
	}
	if sourceKind != "shuihuo_video" || !sourceTaskID.Valid {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "本地任务来源无效"})
		return
	}
	result, err := tx.ExecContext(r.Context(), `UPDATE shuihuo_tasks SET status = 'running' WHERE id = ? AND status = 'queued'`, sourceTaskID.Int64)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "启动生成任务失败"})
		return
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "生成任务已变更，请刷新后重试"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO shuihuo_task_events(task_id, status, message) VALUES(?, 'running', '本地执行器开始处理')`, sourceTaskID.Int64); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "记录生成任务失败"})
		return
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE local_executor_jobs SET status='running', executor_id=?, claimed_at=UTC_TIMESTAMP(), progress_message='本地执行器已领取' WHERE id=? AND status='queued'`, executorID, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "领取任务失败"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "领取任务失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": map[string]any{"id": id, "sourceKind": sourceKind, "prompt": prompt, "input": input, "status": "running"}})
}

func (api *API) handleUpdateLocalExecutorJobStatus(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	var req localExecutorJobStatusRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "状态参数无效"})
		return
	}
	if req.Status != "running" && req.Status != "failed" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不支持的任务状态"})
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	executorID, _, err := api.localExecutorIdentity(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	jobID := strings.TrimSpace(chi.URLParam(r, "jobId"))
	if req.Status == "running" {
		result, err := api.deps.DB.ExecContext(r.Context(), `UPDATE local_executor_jobs SET progress_message=? WHERE id=? AND executor_id=? AND status='running'`, strings.TrimSpace(req.Message), jobID, executorID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新任务状态失败"})
			return
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "任务不存在或不属于此设备"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	tx, err := api.deps.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "更新任务状态失败"})
		return
	}
	defer tx.Rollback()
	var sourceTaskID sql.NullInt64
	err = tx.QueryRowContext(r.Context(), `SELECT source_task_id FROM local_executor_jobs WHERE id=? AND executor_id=? AND status='running' FOR UPDATE`, jobID, executorID).Scan(&sourceTaskID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "任务不存在或不属于此设备"})
		return
	}
	if err != nil || !sourceTaskID.Valid {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取任务状态失败"})
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "本地执行器任务失败"
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE local_executor_jobs SET status='failed', progress_message=?, completed_at=UTC_TIMESTAMP() WHERE id=?`, message, jobID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新任务状态失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE shuihuo_tasks SET status='failed', error_code='local_executor_failed', error_message=? WHERE id=? AND status='running'`, message, sourceTaskID.Int64); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新生成任务失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO shuihuo_task_events(task_id, status, message) VALUES(?, 'failed', ?)`, sourceTaskID.Int64, message); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "记录生成任务失败"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新任务状态失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleUploadLocalExecutorJobResult accepts the finished video from a paired
// device. The browser account itself never leaves the local executor; the
// device token is scoped to one paired device and one of its claimed jobs.
func (api *API) handleUploadLocalExecutorJobResult(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "素材存储未配置"})
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	executorID, userID, err := api.localExecutorIdentity(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "设备令牌无效"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, localExecutorMaxVideoBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频文件无效或超过 512MB"})
		return
	}
	file, header, err := r.FormFile("video")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择要回传的视频文件"})
		return
	}
	defer file.Close()
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if !strings.HasPrefix(contentType, "video/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "只支持视频文件回传"})
		return
	}
	jobID := strings.TrimSpace(chi.URLParam(r, "jobId"))
	var projectID int64
	var segmentID sql.NullInt64
	err = api.deps.DB.QueryRowContext(r.Context(), `
SELECT t.project_id, t.segment_id
FROM local_executor_jobs j
JOIN shuihuo_tasks t ON t.id = j.source_task_id
WHERE j.id=? AND j.executor_id=? AND j.user_id=? AND j.source_kind='shuihuo_video' AND j.status='running' AND t.status='running'
`, jobID, executorID, userID).Scan(&projectID, &segmentID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "没有可回传的运行中视频任务"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取回传任务失败"})
		return
	}
	ext := strings.ToLower(path.Ext(header.Filename))
	if ext == "" || len(ext) > 12 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频文件名无效"})
		return
	}
	filename := fmt.Sprintf("local-%s-%d%s", jobID, time.Now().UTC().UnixNano(), ext)
	key, err := shuihuostorage.ObjectKey(userID, projectID, "videos", filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频文件名无效"})
		return
	}
	if _, err = api.deps.Objects.Put(r.Context(), key, file, contentType); err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "local_executor_video_upload_failure")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存回传视频失败"})
		return
	}
	var durationMS *int64
	if rawDuration := strings.TrimSpace(r.FormValue("durationMs")); rawDuration != "" {
		if value, parseErr := strconv.ParseInt(rawDuration, 10, 64); parseErr == nil && value >= 0 {
			durationMS = &value
		}
	}
	tasks := shuihuostore.NewTasks(api.deps.DB)
	var taskID int64
	if err = api.deps.DB.QueryRowContext(r.Context(), `SELECT source_task_id FROM local_executor_jobs WHERE id=? AND executor_id=? AND status='running'`, jobID, executorID).Scan(&taskID); err != nil {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "local_executor_video_task_lookup_failure")
		writeJSON(w, http.StatusConflict, map[string]string{"error": "回传任务已变更，请重新领取"})
		return
	}
	completed, err := tasks.CompleteWithGeneratedMedia(r.Context(), taskID, domain.Media{ProjectID: projectID, SegmentID: nullableInt64Pointer(segmentID), TaskID: &taskID, Kind: "video", ObjectKey: key, Source: "local_executor", DurationMS: durationMS}, "本地豆包执行器已回传视频")
	if err != nil || !completed {
		_ = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), key, "local_executor_video_completion_failure")
		writeJSON(w, http.StatusConflict, map[string]string{"error": "视频状态已变更，未保存重复回传"})
		return
	}
	if _, err = api.deps.DB.ExecContext(r.Context(), `UPDATE local_executor_jobs SET status='succeeded', progress_message='视频已回传到平台', result_object_key=?, completed_at=UTC_TIMESTAMP() WHERE id=? AND executor_id=? AND status='running'`, key, jobID, executorID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "视频已保存，但任务回传状态更新失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "objectKey": key})
}

func nullableInt64Pointer(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}
