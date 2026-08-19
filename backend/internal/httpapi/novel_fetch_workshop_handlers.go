package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
)

var workshopBookIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

type workshopSettingsRequest struct {
	Settings json.RawMessage `json:"settings"`
}

type workshopTaskRequest struct {
	Meta        json.RawMessage   `json:"meta"`
	Original    string            `json:"original"`
	OriginalRaw string            `json:"originalRaw"`
	Versions    map[string]string `json:"versions"`
	Logs        []json.RawMessage `json:"logs"`
}

type workshopTaskRecord struct {
	BookID      string            `json:"bookId"`
	Meta        json.RawMessage   `json:"meta"`
	Original    string            `json:"original"`
	OriginalRaw string            `json:"originalRaw"`
	Versions    map[string]string `json:"versions"`
	Logs        []json.RawMessage `json:"logs"`
	UpdatedAt   string            `json:"updatedAt"`
}

func (api *API) requireWorkshopDB(w http.ResponseWriter) bool {
	if api.deps.DB != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "小说获取工作台数据库服务未就绪"})
	return false
}

func validWorkshopBookID(value string) bool {
	return workshopBookIDPattern.MatchString(strings.TrimSpace(value))
}

func normalizedJSON(value json.RawMessage, fallback string) (string, bool) {
	if len(value) == 0 {
		return fallback, true
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return "", false
	}
	encoded, err := json.Marshal(decoded)
	return string(encoded), err == nil
}

func (api *API) handleGetNovelFetchWorkshopSettings(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	user, _ := currentUser(r)
	var raw string
	err := api.deps.DB.QueryRowContext(r.Context(), `SELECT settings_json FROM novel_fetch_workshop_settings WHERE user_id = ?`, user.ID).Scan(&raw)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusOK, map[string]any{"settings": map[string]any{}})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取小说获取工作台设置失败"})
		return
	}
	var settings any
	if json.Unmarshal([]byte(raw), &settings) != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "小说获取工作台设置数据损坏"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func (api *API) handleSaveNovelFetchWorkshopSettings(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	var req workshopSettingsRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	raw, ok := normalizedJSON(req.Settings, `{}`)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "settings 必须是有效 JSON"})
		return
	}
	user, _ := currentUser(r)
	_, err := api.deps.DB.ExecContext(r.Context(), `
INSERT INTO novel_fetch_workshop_settings(user_id, settings_json)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`, user.ID, raw)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存小说获取工作台设置失败"})
		return
	}
	var settings any
	_ = json.Unmarshal([]byte(raw), &settings)
	writeJSON(w, http.StatusOK, map[string]any{"settings": settings})
}

func decodeWorkshopRecord(bookID, meta, original, originalRaw, versions, logs, updatedAt string) (workshopTaskRecord, error) {
	record := workshopTaskRecord{BookID: bookID, Meta: json.RawMessage(meta), Original: original, OriginalRaw: originalRaw, Versions: map[string]string{}, Logs: []json.RawMessage{}, UpdatedAt: updatedAt}
	if err := json.Unmarshal([]byte(versions), &record.Versions); err != nil {
		return workshopTaskRecord{}, err
	}
	if err := json.Unmarshal([]byte(logs), &record.Logs); err != nil {
		return workshopTaskRecord{}, err
	}
	return record, nil
}

func (api *API) handleListNovelFetchWorkshopTasks(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	user, _ := currentUser(r)
	rows, err := api.deps.DB.QueryContext(r.Context(), `
SELECT book_id, meta_json, original_text, original_raw_text, versions_json, logs_json, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ')
FROM novel_fetch_workshop_tasks WHERE user_id = ? ORDER BY updated_at DESC, book_id`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取小说获取工作台任务失败"})
		return
	}
	defer rows.Close()
	result := make([]workshopTaskRecord, 0)
	for rows.Next() {
		var bookID, meta, original, originalRaw, versions, logs, updatedAt string
		if err := rows.Scan(&bookID, &meta, &original, &originalRaw, &versions, &logs, &updatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取小说获取工作台任务失败"})
			return
		}
		record, err := decodeWorkshopRecord(bookID, meta, original, originalRaw, versions, logs, updatedAt)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "小说获取工作台任务数据损坏"})
			return
		}
		result = append(result, record)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取小说获取工作台任务失败"})
		return
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].UpdatedAt > result[j].UpdatedAt })
	writeJSON(w, http.StatusOK, map[string]any{"tasks": result})
}

func (api *API) handleGetNovelFetchWorkshopTask(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	bookID := strings.TrimSpace(chi.URLParam(r, "bookId"))
	if !validWorkshopBookID(bookID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法的书籍ID"})
		return
	}
	user, _ := currentUser(r)
	var meta, original, originalRaw, versions, logs, updatedAt string
	err := api.deps.DB.QueryRowContext(r.Context(), `
SELECT meta_json, original_text, original_raw_text, versions_json, logs_json, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ')
FROM novel_fetch_workshop_tasks WHERE user_id = ? AND book_id = ?`, user.ID, bookID).Scan(&meta, &original, &originalRaw, &versions, &logs, &updatedAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "任务不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取小说获取工作台任务失败"})
		return
	}
	record, err := decodeWorkshopRecord(bookID, meta, original, originalRaw, versions, logs, updatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "小说获取工作台任务数据损坏"})
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (api *API) handleSaveNovelFetchWorkshopTask(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	bookID := strings.TrimSpace(chi.URLParam(r, "bookId"))
	if !validWorkshopBookID(bookID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法的书籍ID"})
		return
	}
	var req workshopTaskRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	meta, ok := normalizedJSON(req.Meta, `{}`)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "meta 必须是有效 JSON"})
		return
	}
	versions, err := json.Marshal(req.Versions)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "versions 无效"})
		return
	}
	logs, err := json.Marshal(req.Logs)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "logs 无效"})
		return
	}
	user, _ := currentUser(r)
	_, err = api.deps.DB.ExecContext(r.Context(), `
INSERT INTO novel_fetch_workshop_tasks(user_id, book_id, meta_json, original_text, original_raw_text, versions_json, logs_json)
VALUES(?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE meta_json = VALUES(meta_json), original_text = VALUES(original_text), original_raw_text = VALUES(original_raw_text), versions_json = VALUES(versions_json), logs_json = VALUES(logs_json)`, user.ID, bookID, meta, req.Original, req.OriginalRaw, string(versions), string(logs))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存小说获取工作台任务失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleDeleteNovelFetchWorkshopTasks(w http.ResponseWriter, r *http.Request) {
	if !api.requireWorkshopDB(w) {
		return
	}
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, _ := currentUser(r)
	deleted := 0
	results := make([]map[string]any, 0, len(req.IDs))
	for _, rawID := range req.IDs {
		bookID := strings.TrimSpace(rawID)
		if !validWorkshopBookID(bookID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法的书籍ID"})
			return
		}
		result, err := api.deps.DB.ExecContext(r.Context(), `DELETE FROM novel_fetch_workshop_tasks WHERE user_id = ? AND book_id = ?`, user.ID, bookID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除小说获取工作台任务失败"})
			return
		}
		count, _ := result.RowsAffected()
		if count > 0 {
			deleted++
		}
		results = append(results, map[string]any{"bookId": bookID, "deleted": count > 0})
	}
	writeJSON(w, http.StatusOK, map[string]any{"requested": len(req.IDs), "deleted": deleted, "results": results})
}
