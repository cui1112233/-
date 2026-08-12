package prompts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type Preset struct {
	ID         int64
	VersionID  int64
	Module     string
	Purpose    string
	Name       string
	Parameters []string
	Body       string
	Enabled    bool
}

type PublicPreset struct {
	ID         int64    `json:"id"`
	VersionID  int64    `json:"versionId"`
	Module     string   `json:"module"`
	Purpose    string   `json:"purpose"`
	Name       string   `json:"name"`
	Parameters []string `json:"parameters"`
}

func ToPublicPreset(preset Preset) PublicPreset {
	return PublicPreset{
		ID: preset.ID, VersionID: preset.VersionID, Module: preset.Module,
		Purpose: preset.Purpose, Name: preset.Name, Parameters: append([]string(nil), preset.Parameters...),
	}
}

type Selection struct {
	BaseID   int64
	AddonIDs []int64
}

type AssembleInput struct {
	NovelText   string
	SegmentText string
	ProjectNote string
}

type PromptSnapshot struct {
	BaseVersionID   int64
	AddonVersionIDs []int64
	Rendered        string
}

type PublicSnapshot struct {
	BaseVersionID   int64   `json:"baseVersionId"`
	AddonVersionIDs []int64 `json:"addonVersionIds"`
}

func (snapshot PromptSnapshot) Public() PublicSnapshot {
	return PublicSnapshot{BaseVersionID: snapshot.BaseVersionID, AddonVersionIDs: append([]int64(nil), snapshot.AddonVersionIDs...)}
}

type Repository interface {
	ResolveEnabled(ctx context.Context, module string, selection Selection) (Preset, []Preset, error)
}

type DatabaseRepository struct {
	db      *sql.DB
	purpose string
}

func NewDatabaseRepository(db *sql.DB, purpose string) *DatabaseRepository {
	return &DatabaseRepository{db: db, purpose: purpose}
}

func (r *DatabaseRepository) ResolveEnabled(ctx context.Context, module string, _ Selection) (Preset, []Preset, error) {
	if r == nil || r.db == nil {
		return Preset{}, nil, fmt.Errorf("prompt repository is not configured")
	}
	var preset Preset
	err := r.db.QueryRowContext(ctx, `
SELECT d.id, v.id, d.module, d.purpose, d.name, COALESCE(v.parameters_json, JSON_ARRAY()), v.body, d.enabled
FROM prompt_definitions d
JOIN prompt_versions v ON v.prompt_definition_id = d.id
WHERE d.module = ? AND d.purpose = ? AND d.enabled = TRUE
  AND v.version_number = (SELECT MAX(current.version_number) FROM prompt_versions current WHERE current.prompt_definition_id = d.id)
ORDER BY d.id ASC
LIMIT 1
`, module, r.purpose).Scan(&preset.ID, &preset.VersionID, &preset.Module, &preset.Purpose, &preset.Name, newJSONStrings(&preset.Parameters), &preset.Body, &preset.Enabled)
	if err != nil {
		return Preset{}, nil, err
	}
	return preset, nil, nil
}

type jsonStrings struct{ target *[]string }

func newJSONStrings(target *[]string) jsonStrings { return jsonStrings{target: target} }

func (v jsonStrings) Scan(value any) error {
	if value == nil {
		*v.target = nil
		return nil
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		return fmt.Errorf("unsupported prompt parameters type %T", value)
	}
	return json.Unmarshal(raw, v.target)
}

type SnapshotStore struct{ db *sql.DB }

func NewSnapshotStore(db *sql.DB) *SnapshotStore { return &SnapshotStore{db: db} }

// Save keeps the rendered server prompt out of all list responses while making
// each text analysis reproducible for its owning project.
func (s *SnapshotStore) Save(ctx context.Context, ownerID, projectID, modelID, modelVersionID int64, purpose string, snapshot PromptSnapshot) (int64, error) {
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("prompt snapshot storage is not configured")
	}
	addonVersions, err := json.Marshal(snapshot.AddonVersionIDs)
	if err != nil {
		return 0, fmt.Errorf("encode addon prompt versions: %w", err)
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_prompt_snapshots(project_id, model_id, model_version_id, purpose, base_prompt_version_id, addon_prompt_version_ids, rendered_prompt)
SELECT id, ?, ?, ?, ?, CAST(? AS JSON), ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, modelID, modelVersionID, purpose, snapshot.BaseVersionID, string(addonVersions), snapshot.Rendered, projectID, ownerID)
	if err != nil {
		return 0, err
	}
	if err := requireAffected(result); err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func requireAffected(result sql.Result) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

type Service struct {
	repo   Repository
	module string
}

func NewService(repo Repository, module string) *Service {
	return &Service{repo: repo, module: module}
}

func (s *Service) Assemble(ctx context.Context, selection Selection, input AssembleInput) (PromptSnapshot, error) {
	if s.repo == nil {
		return PromptSnapshot{}, fmt.Errorf("prompt repository is required")
	}
	base, addons, err := s.repo.ResolveEnabled(ctx, s.module, selection)
	if err != nil {
		return PromptSnapshot{}, err
	}
	if !base.Enabled || base.Body == "" {
		return PromptSnapshot{}, fmt.Errorf("base prompt is not enabled")
	}
	bodies := []string{base.Body}
	versions := make([]int64, 0, len(addons))
	for _, addon := range addons {
		if !addon.Enabled {
			return PromptSnapshot{}, fmt.Errorf("addon prompt %d is not enabled", addon.ID)
		}
		bodies = append(bodies, addon.Body)
		versions = append(versions, addon.VersionID)
	}
	rendered := strings.NewReplacer(
		"{{novel_text}}", input.NovelText,
		"{{segment_text}}", input.SegmentText,
		"{{project_note}}", input.ProjectNote,
	).Replace(strings.Join(bodies, "\n\n"))
	return PromptSnapshot{BaseVersionID: base.VersionID, AddonVersionIDs: versions, Rendered: rendered}, nil
}
