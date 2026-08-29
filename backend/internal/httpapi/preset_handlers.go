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
	CreateDraft(context.Context, int64, PresetDraftInput) (PresetVersion, error)
}

type sqlPresetStore struct{ db *sql.DB }

func NewSQLPresetStore(db *sql.DB) PresetStore { return &sqlPresetStore{db: db} }

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

// handleEmbeddedPresets exposes the read-only built-in catalog during the
// single-binary migration. Mutable draft/publish operations remain on the
// legacy gateway until their MySQL-backed Go implementation is complete.
func (api *API) handleEmbeddedPresets(w http.ResponseWriter, r *http.Request) {
	module := strings.TrimSpace(r.URL.Query().Get("module"))
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
