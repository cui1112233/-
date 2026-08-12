package store

import (
	"context"
	"database/sql"

	"qiantie/backend/internal/shuihuo/domain"
)

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
	SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version
	FROM shuihuo_projects
	WHERE id = ? AND user_id = ?
	`, projectID, ownerID).Scan(&project.ID, &project.UserID, &project.Name, &project.SourceText, &project.SourceObjectKey, &project.SegmentationStatus, &project.SegmentationVersion)
	return project, err
}

func (s *Projects) List(ctx context.Context, ownerID int64, limit int) ([]domain.Project, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version
FROM shuihuo_projects
WHERE user_id = ?
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
		if err := rows.Scan(&project.ID, &project.UserID, &project.Name, &project.SourceText, &project.SourceObjectKey, &project.SegmentationStatus, &project.SegmentationVersion); err != nil {
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
