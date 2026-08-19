package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

var (
	ErrEmptySourceText                 = errors.New("source text is required")
	ErrSourceReplacementHasActiveTasks = errors.New("source replacement has active tasks")
)

// ImportingSegmentationStatus is deliberately excluded from ordinary project
// reads. It prevents a failed import from appearing as a usable project before
// its original document and database record are committed together.
const ImportingSegmentationStatus = "importing"

type Projects struct{ db *sql.DB }

func NewProjects(db *sql.DB) *Projects { return &Projects{db: db} }

func (s *Projects) Create(ctx context.Context, ownerID int64, project domain.Project) (domain.Project, error) {
	result, err := s.db.ExecContext(ctx, `
	INSERT INTO shuihuo_projects(user_id, name, source_text, source_object_key, segmentation_status, segmentation_version)
	VALUES(?, ?, ?, ?, ?, ?)
	`, ownerID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, project.SegmentationVersion)
	if err != nil {
		return domain.Project{}, err
	}
	project.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Project{}, err
	}
	project.UserID = ownerID
	return project, nil
}

func (s *Projects) GetProject(ctx context.Context, ownerID, projectID int64) (domain.Project, error) {
	var project domain.Project
	err := s.db.QueryRowContext(ctx, `
	SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version, created_at, updated_at
	FROM shuihuo_projects
	WHERE id = ? AND user_id = ? AND segmentation_status <> 'importing'
	`, projectID, ownerID).Scan(
		&project.ID,
		&project.UserID,
		&project.Name,
		&project.SourceText,
		&project.SourceObjectKey,
		&project.SegmentationStatus,
		&project.SegmentationVersion,
		&project.CreatedAt,
		&project.UpdatedAt,
	)
	return project, err
}

func (s *Projects) List(ctx context.Context, ownerID int64, limit int) ([]domain.Project, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version, created_at, updated_at
FROM shuihuo_projects
	WHERE user_id = ? AND segmentation_status <> 'importing'
ORDER BY created_at DESC, id DESC
LIMIT ?
`, ownerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]domain.Project, 0)
	for rows.Next() {
		var project domain.Project
		if err := rows.Scan(&project.ID, &project.UserID, &project.Name, &project.SourceText, &project.SourceObjectKey, &project.SegmentationStatus, &project.SegmentationVersion, &project.CreatedAt, &project.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Projects) Update(ctx context.Context, ownerID int64, project domain.Project) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_projects
	SET name = ?, source_text = ?, source_object_key = ?, segmentation_status = ?, segmentation_version = ?
	WHERE id = ? AND user_id = ?
	`, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, project.SegmentationVersion, project.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

// SetSourceObjectKey finalizes an import only after the source object is
// attached. Until this succeeds, the project remains hidden in importing.
func (s *Projects) SetSourceObjectKey(ctx context.Context, ownerID, projectID int64, objectKey string) error {
	result, err := s.db.ExecContext(ctx, `
	UPDATE shuihuo_projects
	SET source_object_key = ?,
	    segmentation_status = CASE WHEN segmentation_status = 'importing' THEN 'draft' ELSE segmentation_status END
	WHERE id = ? AND user_id = ?
`, objectKey, projectID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

// Delete removes a project which could not be completed during import. It is
// intentionally ownership-scoped so cleanup cannot delete another account's
// project even when a caller carries a stale ID.
func (s *Projects) Delete(ctx context.Context, ownerID, projectID int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_projects WHERE id = ? AND user_id = ?`, projectID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

// ReplaceSource starts a new active source version without deleting archived
// source-unit identities. Existing storyboard mappings are copied to history
// before their active segments are removed. The returned object key is the old
// import object and is safe for the caller to delete only after this commit.
func (s *Projects) ReplaceSource(ctx context.Context, ownerID, projectID int64, sourceText string) (domain.Project, string, error) {
	if strings.TrimSpace(sourceText) == "" {
		return domain.Project{}, "", ErrEmptySourceText
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Project{}, "", err
	}
	defer tx.Rollback()

	var oldObjectKey string
	var currentVersion int
	var lockedProjectID int64
	err = tx.QueryRowContext(ctx, `
SELECT id, source_object_key, segmentation_version
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
FOR UPDATE`, projectID, ownerID).Scan(&lockedProjectID, &oldObjectKey, &currentVersion)
	if err != nil {
		return domain.Project{}, "", err
	}

	var hasActiveTasks bool
	if err := tx.QueryRowContext(ctx, `
SELECT EXISTS(
  SELECT 1 FROM shuihuo_tasks
  WHERE project_id = ? AND status IN ('queued', 'running')
)`, lockedProjectID).Scan(&hasActiveTasks); err != nil {
		return domain.Project{}, "", err
	}
	if hasActiveTasks {
		return domain.Project{}, "", ErrSourceReplacementHasActiveTasks
	}

	queryer := sourceUnitTxAdapter{tx: tx}
	if err := archiveSourceMappings(ctx, queryer, lockedProjectID, currentVersion); err != nil {
		return domain.Project{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segments WHERE project_id = ?`, lockedProjectID); err != nil {
		return domain.Project{}, "", err
	}
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_projects
SET source_text = ?, source_object_key = '', segmentation_status = 'draft', segmentation_version = segmentation_version + 1
WHERE id = ? AND user_id = ?`, sourceText, lockedProjectID, ownerID)
	if err != nil {
		return domain.Project{}, "", err
	}
	if err := requireAffected(result); err != nil {
		return domain.Project{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return domain.Project{}, "", err
	}
	return domain.Project{
		ID:                  lockedProjectID,
		UserID:              ownerID,
		SourceText:          sourceText,
		SegmentationStatus:  "draft",
		SegmentationVersion: currentVersion + 1,
	}, oldObjectKey, nil
}
