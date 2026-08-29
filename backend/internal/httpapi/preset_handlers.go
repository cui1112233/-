package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type PresetDraftInput struct {
	Module  string `json:"module"`
	Purpose string `json:"purpose"`
	Name    string `json:"name"`
	Body    string `json:"body"`
}

type PresetVersion struct {
	ID      string `json:"id"`
	Module  string `json:"module"`
	Purpose string `json:"purpose"`
	Name    string `json:"name"`
	Body    string `json:"body"`
	Version int    `json:"version"`
	Status  string `json:"status"`
}

type PresetStore interface {
	List(context.Context, string) ([]PresetVersion, error)
	CreateDraft(context.Context, int64, PresetDraftInput) (PresetVersion, error)
	Publish(context.Context, int64, string, int) (PresetVersion, error)
	Rollback(context.Context, int64, string, int) (PresetVersion, error)
}

type sqlPresetStore struct{ db *sql.DB }

func NewSQLPresetStore(db *sql.DB) PresetStore { return &sqlPresetStore{db: db} }

func (s *sqlPresetStore) List(ctx context.Context, module string) ([]PresetVersion, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("preset storage is not configured")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT d.id, d.module, d.purpose, d.name, v.body, v.version_number, v.status FROM prompt_definitions d JOIN prompt_versions v ON v.prompt_definition_id=d.id WHERE d.module=? ORDER BY d.id, v.version_number DESC`, module)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []PresetVersion{}
	for rows.Next() {
		var item PresetVersion
		var id int64
		if err := rows.Scan(&id, &item.Module, &item.Purpose, &item.Name, &item.Body, &item.Version, &item.Status); err != nil {
			return nil, err
		}
		item.ID = strconv.FormatInt(id, 10)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *sqlPresetStore) CreateDraft(ctx context.Context, userID int64, input PresetDraftInput) (PresetVersion, error) {
	if s == nil || s.db == nil {
		return PresetVersion{}, fmt.Errorf("preset storage is not configured")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return PresetVersion{}, err
	}
	defer tx.Rollback()
	purpose := strings.TrimSpace(input.Purpose)
	if purpose == "" {
		purpose = "base"
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO prompt_definitions(module, purpose, name, enabled) VALUES(?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, input.Module, purpose, input.Name)
	if err != nil {
		return PresetVersion{}, err
	}
	definitionID, err := result.LastInsertId()
	if err != nil {
		return PresetVersion{}, err
	}
	var next int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_number), 0) + 1 FROM prompt_versions WHERE prompt_definition_id = ?`, definitionID).Scan(&next); err != nil {
		return PresetVersion{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO prompt_versions(prompt_definition_id, version_number, body, created_by, status) VALUES(?, ?, ?, ?, 'draft')`, definitionID, next, input.Body, userID); err != nil {
		return PresetVersion{}, err
	}
	if err := tx.Commit(); err != nil {
		return PresetVersion{}, err
	}
	return PresetVersion{ID: strconv.FormatInt(definitionID, 10), Module: input.Module, Purpose: purpose, Name: input.Name, Body: input.Body, Version: next, Status: "draft"}, nil
}

func (s *sqlPresetStore) Publish(ctx context.Context, userID int64, id string, version int) (PresetVersion, error) {
	if s == nil || s.db == nil || version < 1 {
		return PresetVersion{}, fmt.Errorf("invalid preset publish request")
	}
	definitionID, err := strconv.ParseInt(id, 10, 64)
	if err != nil || definitionID < 1 {
		return PresetVersion{}, fmt.Errorf("invalid preset id")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return PresetVersion{}, err
	}
	defer tx.Rollback()
	var preset PresetVersion
	err = tx.QueryRowContext(ctx, `SELECT d.module, d.purpose, d.name, v.body FROM prompt_definitions d JOIN prompt_versions v ON v.prompt_definition_id = d.id WHERE d.id = ? AND v.version_number = ?`, definitionID, version).Scan(&preset.Module, &preset.Purpose, &preset.Name, &preset.Body)
	if err != nil {
		return PresetVersion{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE prompt_versions SET status = 'archived' WHERE prompt_definition_id = ? AND status = 'published'`, definitionID); err != nil {
		return PresetVersion{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE prompt_versions SET status = 'published', published_at = NOW(), published_by = ? WHERE prompt_definition_id = ? AND version_number = ?`, userID, definitionID, version)
	if err != nil {
		return PresetVersion{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return PresetVersion{}, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return PresetVersion{}, err
	}
	preset.ID, preset.Version, preset.Status = id, version, "published"
	return preset, nil
}

func (s *sqlPresetStore) Rollback(ctx context.Context, userID int64, id string, version int) (PresetVersion, error) {
	definitionID, err := strconv.ParseInt(id, 10, 64)
	if s == nil || s.db == nil || err != nil || definitionID < 1 || version < 1 {
		return PresetVersion{}, fmt.Errorf("invalid preset rollback request")
	}
	var source PresetDraftInput
	if err := s.db.QueryRowContext(ctx, `SELECT d.module, d.purpose, d.name, v.body FROM prompt_definitions d JOIN prompt_versions v ON v.prompt_definition_id=d.id WHERE d.id=? AND v.version_number=?`, definitionID, version).Scan(&source.Module, &source.Purpose, &source.Name, &source.Body); err != nil {
		return PresetVersion{}, err
	}
	draft, err := s.CreateDraft(ctx, userID, source)
	if err != nil {
		return PresetVersion{}, err
	}
	return s.Publish(ctx, userID, draft.ID, draft.Version)
}

func (api *API) handleCreatePresetDraft(w http.ResponseWriter, r *http.Request) {
	if api.deps.Presets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "提示词存储未配置"})
		return
	}
	var input PresetDraftInput
	if err := readJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	input.Module, input.Name, input.Body = strings.TrimSpace(input.Module), strings.TrimSpace(input.Name), strings.TrimSpace(input.Body)
	if input.Module == "" || input.Name == "" || input.Body == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模块、名称和正文不能为空"})
		return
	}
	user, _ := currentUser(r)
	preset, err := api.deps.Presets.CreateDraft(r.Context(), user.ID, input)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存提示词草稿失败"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"preset": preset})
}

func (api *API) handlePublishPreset(w http.ResponseWriter, r *http.Request) {
	if api.deps.Presets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "提示词存储未配置"})
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := readJSON(r, &input); err != nil || input.Version < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "版本号无效"})
		return
	}
	user, _ := currentUser(r)
	preset, err := api.deps.Presets.Publish(r.Context(), user.ID, chi.URLParam(r, "id"), input.Version)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "提示词版本不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preset": preset})
}

func (api *API) handleRollbackPreset(w http.ResponseWriter, r *http.Request) {
	if api.deps.Presets == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "提示词存储未配置"})
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := readJSON(r, &input); err != nil || input.Version < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "版本号无效"})
		return
	}
	user, _ := currentUser(r)
	preset, err := api.deps.Presets.Rollback(r.Context(), user.ID, chi.URLParam(r, "id"), input.Version)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "提示词版本不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preset": preset})
}

// handleEmbeddedPresets exposes the read-only built-in catalog during the
// single-binary migration. Mutable draft/publish operations remain on the
// legacy gateway until their MySQL-backed Go implementation is complete.
func (api *API) handleEmbeddedPresets(w http.ResponseWriter, r *http.Request) {
	module := strings.TrimSpace(r.URL.Query().Get("module"))
	if api.deps.Presets != nil {
		presets, err := api.deps.Presets.List(r.Context(), module)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取提示词失败"})
			return
		}
		if len(presets) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"presets": presets})
			return
		}
	}
	if module != "batch-factory" || api.deps.WebFS == nil {
		writeJSON(w, http.StatusOK, map[string]any{"presets": []any{}})
		return
	}
	entries, err := fs.ReadDir(api.deps.WebFS, "prompts")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取提示词目录失败"})
		return
	}
	presets := make([]map[string]any, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "批量工厂-") || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		body, readErr := fs.ReadFile(api.deps.WebFS, path.Join("prompts", entry.Name()))
		if readErr != nil {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".md")
		presets = append(presets, map[string]any{"id": id, "module": module, "name": id, "kind": "base", "version": 1, "status": "published", "body": string(body)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": presets})
}
