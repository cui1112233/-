package httpapi

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type localScriptVideoRequest struct {
	Prompt string `json:"prompt"`
}

func (api *API) handleCreateLocalScriptVideo(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	var req localScriptVideoRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜视频提示词不能为空"})
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" || len(prompt) > 12000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分镜视频提示词长度无效"})
		return
	}
	user, _ := currentUser(r)
	taskID, err := localExecutorIdentifier()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建视频任务失败"})
		return
	}
	jobID, err := localExecutorIdentifier()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建执行任务失败"})
		return
	}
	tx, err := api.deps.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 503, map[string]string{"error": "视频服务暂不可用"})
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO script_video_tasks(id,user_id,prompt) VALUES(?,?,?)`, taskID, user.ID, prompt); err != nil {
		writeJSON(w, 500, map[string]string{"error": "保存视频任务失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO local_executor_jobs(id,user_id,source_kind,prompt,input_json) VALUES(?,?,'script_video',?,JSON_OBJECT())`, jobID, user.ID, prompt); err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建执行任务失败"})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE local_executor_jobs SET source_task_id=NULL, progress_message=? WHERE id=?`, "等待本地执行器领取", jobID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建执行任务失败"})
		return
	}
	// Store the script task identifier in input JSON because source_task_id is reserved for Shuihuo task IDs.
	if _, err = tx.ExecContext(r.Context(), `UPDATE local_executor_jobs SET input_json=JSON_OBJECT('scriptTaskId', ?) WHERE id=?`, taskID, jobID); err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建执行任务失败"})
		return
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "创建执行任务失败"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "taskId": taskID, "status": "processing"})
}

func (api *API) handleGetLocalScriptVideo(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) {
		return
	}
	user, _ := currentUser(r)
	taskID := strings.TrimSpace(chi.URLParam(r, "taskId"))
	var status, key string
	var errMsg *string
	err := api.deps.DB.QueryRowContext(r.Context(), `SELECT status,object_key,error_message FROM script_video_tasks WHERE id=? AND user_id=?`, taskID, user.ID).Scan(&status, &key, &errMsg)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, map[string]string{"error": "视频任务不存在"})
		return
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "读取视频任务失败"})
		return
	}
	result := map[string]any{"ok": true, "taskId": taskID, "status": status}
	if status == "succeeded" && key != "" {
		result["videoUrl"] = "/api/script-video/" + taskID + "/download"
	}
	if errMsg != nil {
		result["error"] = *errMsg
	}
	writeJSON(w, 200, result)
}

func (api *API) handleDownloadLocalScriptVideo(w http.ResponseWriter, r *http.Request) {
	if !api.requireLocalExecutorDatabase(w) || api.deps.Objects == nil {
		return
	}
	user, _ := currentUser(r)
	taskID := strings.TrimSpace(chi.URLParam(r, "taskId"))
	var key string
	if err := api.deps.DB.QueryRowContext(r.Context(), `SELECT object_key FROM script_video_tasks WHERE id=? AND user_id=? AND status='succeeded'`, taskID, user.ID).Scan(&key); err != nil || key == "" {
		writeJSON(w, 404, map[string]string{"error": "视频尚未生成"})
		return
	}
	body, obj, err := api.deps.Objects.Get(r.Context(), key)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "视频文件不存在"})
		return
	}
	defer body.Close()
	w.Header().Set("Content-Type", obj.ContentType)
	_, _ = io.Copy(w, body)
}
