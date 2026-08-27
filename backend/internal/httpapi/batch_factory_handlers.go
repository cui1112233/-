package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type batchFactoryIntakeRequest struct {
	ID         string          `json:"id"`
	SourceType string          `json:"sourceType"`
	Name       string          `json:"name"`
	Items      json.RawMessage `json:"items"`
}

type batchFactoryBatchRequest struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	Mode           string             `json:"mode"`
	Settings       json.RawMessage    `json:"settings"`
	SourceIntakeID string             `json:"sourceIntakeId"`
	Items          []batchFactoryItem `json:"items"`
}

type batchFactoryItem struct {
	ID          string          `json:"id"`
	Status      string          `json:"status"`
	Payload     json.RawMessage `json:"payload"`
	ActivityLog json.RawMessage `json:"activityLog"`
}

type batchFactoryItemUpdateRequest struct {
	Item     json.RawMessage `json:"item"`
	Activity json.RawMessage `json:"activity"`
}

type batchFactorySettingsUpdateRequest struct { Settings json.RawMessage `json:"settings"` }

func batchFactoryNow() time.Time { return time.Now().UTC() }

func validBatchFactoryID(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 80
}

func validBatchFactoryJSON(value json.RawMessage, fallback string) (string, bool) {
	return normalizedJSON(value, fallback)
}

func (api *API) requireBatchFactoryDB(w http.ResponseWriter) bool {
	if api.deps.DB != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "批量工厂数据库服务未就绪"})
	return false
}

func (api *API) handleCreateBatchFactoryIntake(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	var req batchFactoryIntakeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !validBatchFactoryID(req.ID) || strings.TrimSpace(req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "交接单参数不完整"})
		return
	}
	items, ok := validBatchFactoryJSON(req.Items, "[]")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "交接书籍格式无效"})
		return
	}
	user, _ := currentUser(r)
	now := batchFactoryNow()
	_, err := api.deps.DB.ExecContext(r.Context(), `INSERT INTO batch_factory_intakes(id, owner_id, source_type, name, items_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)`, req.ID, user.ID, strings.TrimSpace(req.SourceType), strings.TrimSpace(req.Name), items, now, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建批量工厂交接单失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"intake": map[string]any{"id": req.ID, "sourceType": req.SourceType, "name": req.Name, "items": json.RawMessage(items), "createdAt": now.Format(time.RFC3339Nano), "consumedAt": "", "batchId": ""}})
}

func (api *API) handleGetBatchFactoryIntake(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	id := chi.URLParam(r, "intakeId")
	if !validBatchFactoryID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法交接单ID"})
		return
	}
	user, _ := currentUser(r)
	var sourceType, name, items, consumedAt, batchID, createdAt string
	err := api.deps.DB.QueryRowContext(r.Context(), `SELECT source_type, name, items_json, COALESCE(DATE_FORMAT(consumed_at, '%Y-%m-%dT%H:%i:%s.%fZ'), ''), batch_id, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') FROM batch_factory_intakes WHERE id = ? AND owner_id = ?`, id, user.ID).Scan(&sourceType, &name, &items, &consumedAt, &batchID, &createdAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "小说获取交接单不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批量工厂交接单失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"intake": map[string]any{"id": id, "sourceType": sourceType, "name": name, "items": json.RawMessage(items), "createdAt": createdAt, "consumedAt": consumedAt, "batchId": batchID}})
}

func (api *API) handleCreateBatchFactoryBatch(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	var req batchFactoryBatchRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if !validBatchFactoryID(req.ID) || strings.TrimSpace(req.Name) == "" || len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次参数不完整"})
		return
	}
	settings, ok := validBatchFactoryJSON(req.Settings, "{}")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次设置格式无效"})
		return
	}
	user, _ := currentUser(r)
	now := batchFactoryNow()
	tx, err := api.deps.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建批次失败"})
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO batch_factory_batches(id, owner_id, name, mode, settings_json, source_intake_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, req.ID, user.ID, strings.TrimSpace(req.Name), strings.TrimSpace(req.Mode), settings, strings.TrimSpace(req.SourceIntakeID), now, now)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "创建批次失败"})
		return
	}
	for ordinal, item := range req.Items {
		payload, valid := validBatchFactoryJSON(item.Payload, "{}")
		if !valid || !validBatchFactoryID(item.ID) || strings.TrimSpace(item.Status) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次书籍格式无效"})
			return
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO batch_factory_items(id, batch_id, ordinal, payload_json, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)`, item.ID, req.ID, ordinal, payload, item.Status, now, now); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存批次书籍失败"})
			return
		}
	}
	if req.SourceIntakeID != "" {
		result, updateErr := tx.ExecContext(r.Context(), `UPDATE batch_factory_intakes SET consumed_at = ?, batch_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND batch_id = ''`, now, req.ID, now, req.SourceIntakeID, user.ID)
		if updateErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新交接单失败"})
			return
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "交接单已被使用或不存在"})
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建批次失败"})
		return
	}
	api.writeBatchFactoryBatch(w, r, req.ID)
}

func (api *API) handleListBatchFactoryBatches(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	user, _ := currentUser(r)
	rows, err := api.deps.DB.QueryContext(r.Context(), `SELECT b.id, b.name, b.mode, b.settings_json, b.source_intake_id, DATE_FORMAT(b.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'), DATE_FORMAT(b.updated_at, '%Y-%m-%dT%H:%i:%s.%fZ'), COUNT(i.id), SUM(i.status = 'complete'), SUM(i.status = 'hook_review'), SUM(i.status = 'failed') FROM batch_factory_batches b LEFT JOIN batch_factory_items i ON i.batch_id = b.id WHERE b.owner_id = ? GROUP BY b.id ORDER BY b.updated_at DESC`, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次列表失败"})
		return
	}
	defer rows.Close()
	batches := make([]map[string]any, 0)
	for rows.Next() {
		var id, name, mode, settings, intakeID, createdAt, updatedAt string
		var total int
		var complete, review, failed sql.NullInt64
		if err := rows.Scan(&id, &name, &mode, &settings, &intakeID, &createdAt, &updatedAt, &total, &complete, &review, &failed); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次列表失败"})
			return
		}
		batches = append(batches, map[string]any{"id": id, "name": name, "mode": mode, "settings": json.RawMessage(settings), "sourceIntakeId": intakeID, "createdAt": createdAt, "updatedAt": updatedAt, "total": total, "completed": complete.Int64, "review": review.Int64, "failed": failed.Int64})
	}
	writeJSON(w, http.StatusOK, map[string]any{"batches": batches})
}

func (api *API) handleGetBatchFactoryBatch(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	api.writeBatchFactoryBatch(w, r, chi.URLParam(r, "batchId"))
}

func (api *API) handleUpdateBatchFactorySettings(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) { return }
	id := chi.URLParam(r, "batchId")
	if !validBatchFactoryID(id) { writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法批次ID"}); return }
	var req batchFactorySettingsUpdateRequest
	if err := readJSON(r, &req); err != nil { writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"}); return }
	settings, ok := validBatchFactoryJSON(req.Settings, "{}")
	if !ok { writeJSON(w, http.StatusBadRequest, map[string]string{"error": "批次设置格式无效"}); return }
	user, _ := currentUser(r)
	now := batchFactoryNow()
	result, err := api.deps.DB.ExecContext(r.Context(), `UPDATE batch_factory_batches SET settings_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?`, settings, now, id, user.ID)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存批次设置失败"}); return }
	affected, _ := result.RowsAffected()
	if affected == 0 { writeJSON(w, http.StatusNotFound, map[string]string{"error": "批次不存在"}); return }
	api.writeBatchFactoryBatch(w, r, id)
}

func (api *API) writeBatchFactoryBatch(w http.ResponseWriter, r *http.Request, id string) {
	if !validBatchFactoryID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法批次ID"})
		return
	}
	user, _ := currentUser(r)
	var name, mode, settings, intakeID, createdAt, updatedAt string
	err := api.deps.DB.QueryRowContext(r.Context(), `SELECT name, mode, settings_json, source_intake_id, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ'), DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.%fZ') FROM batch_factory_batches WHERE id = ? AND owner_id = ?`, id, user.ID).Scan(&name, &mode, &settings, &intakeID, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "批次不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次失败"})
		return
	}
	rows, err := api.deps.DB.QueryContext(r.Context(), `SELECT payload_json FROM batch_factory_items WHERE batch_id = ? ORDER BY ordinal`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次书籍失败"})
		return
	}
	defer rows.Close()
	items := make([]json.RawMessage, 0)
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取批次书籍失败"})
			return
		}
		items = append(items, json.RawMessage(payload))
	}
	writeJSON(w, http.StatusOK, map[string]any{"batch": map[string]any{"id": id, "name": name, "mode": mode, "settings": json.RawMessage(settings), "sourceIntakeId": intakeID, "createdAt": createdAt, "updatedAt": updatedAt, "items": items}})
}

func (api *API) handleUpdateBatchFactoryItem(w http.ResponseWriter, r *http.Request) {
	if !api.requireBatchFactoryDB(w) {
		return
	}
	batchID, itemID := chi.URLParam(r, "batchId"), chi.URLParam(r, "itemId")
	if !validBatchFactoryID(batchID) || !validBatchFactoryID(itemID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "非法批次或书籍ID"})
		return
	}
	var req batchFactoryItemUpdateRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	payload, ok := validBatchFactoryJSON(req.Item, "{}")
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "书籍格式无效"})
		return
	}
	var item map[string]any
	if json.Unmarshal([]byte(payload), &item) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "书籍格式无效"})
		return
	}
	status, _ := item["status"].(string)
	if strings.TrimSpace(status) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "书籍状态不能为空"})
		return
	}
	user, _ := currentUser(r)
	now := batchFactoryNow()
	result, err := api.deps.DB.ExecContext(r.Context(), `UPDATE batch_factory_items i JOIN batch_factory_batches b ON b.id = i.batch_id SET i.payload_json = ?, i.status = ?, i.updated_at = ?, b.updated_at = ? WHERE i.id = ? AND i.batch_id = ? AND b.owner_id = ?`, payload, status, now, now, itemID, batchID, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存批次书籍失败"})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "批次或书籍不存在"})
		return
	}
	if len(req.Activity) > 0 {
		if event, valid := validBatchFactoryJSON(req.Activity, ""); valid && event != "" {
			_, _ = api.deps.DB.ExecContext(r.Context(), `INSERT INTO batch_factory_activity_logs(batch_id,item_id,event_json,created_at) VALUES(?,?,?,?)`, batchID, itemID, event, now)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": json.RawMessage(payload)})
}
