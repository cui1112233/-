package store

import (
	"context"
	"database/sql"

	"qiantie/backend/internal/shuihuo/domain"
)

type Tasks struct{ db *sql.DB }

func NewTasks(db *sql.DB) *Tasks { return &Tasks{db: db} }

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

func ValidateTransition(current, next domain.TaskStatus) error {
	return domain.ValidateTaskTransition(current, next)
}

func (s *Tasks) Create(ctx context.Context, ownerID, projectID int64, task domain.Task) (domain.Task, error) {
	if err := domain.ValidateTaskStatus(task.Status); err != nil {
		return domain.Task{}, err
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_tasks(project_id, segment_id, kind, status, provider, provider_task_id, model_id, model_version_id, prompt_version_id, input_snapshot, output_snapshot, error_code, error_message, retry_count)
SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, task.SegmentID, task.Kind, task.Status, task.Provider, task.ProviderTaskID, task.ModelID, task.ModelVersionID, task.PromptVersionID, task.Input, task.Output, task.ErrorCode, task.ErrorMessage, task.RetryCount, projectID, ownerID)
	if err != nil {
		return domain.Task{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Task{}, err
	}
	task.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Task{}, err
	}
	task.ProjectID = projectID
	return task, nil
}

func (s *Tasks) Get(ctx context.Context, ownerID, taskID int64) (domain.Task, error) {
	var task domain.Task
	err := s.db.QueryRowContext(ctx, `
SELECT t.id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.id = ? AND p.user_id = ?
`, taskID, ownerID).Scan(&task.ID, &task.ProjectID, &task.SegmentID, &task.Kind, &task.Status, &task.Provider, &task.ProviderTaskID, &task.ModelID, &task.ModelVersionID, &task.PromptVersionID, &task.Input, &task.Output, &task.ErrorCode, &task.ErrorMessage, &task.RetryCount)
	return task, err
}

func (s *Tasks) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Task, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT t.id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.project_id = ? AND p.user_id = ?
ORDER BY t.created_at DESC, t.id DESC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := make([]domain.Task, 0)
	for rows.Next() {
		var task domain.Task
		if err := rows.Scan(&task.ID, &task.ProjectID, &task.SegmentID, &task.Kind, &task.Status, &task.Provider, &task.ProviderTaskID, &task.ModelID, &task.ModelVersionID, &task.PromptVersionID, &task.Input, &task.Output, &task.ErrorCode, &task.ErrorMessage, &task.RetryCount); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Tasks) Update(ctx context.Context, ownerID int64, task domain.Task) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
SET t.segment_id = ?, t.kind = ?, t.provider = ?, t.provider_task_id = ?, t.model_id = ?, t.model_version_id = ?, t.prompt_version_id = ?,
    t.input_snapshot = ?, t.output_snapshot = ?, t.error_code = ?, t.error_message = ?, t.retry_count = ?
WHERE t.id = ? AND p.user_id = ?
`, task.SegmentID, task.Kind, task.Provider, task.ProviderTaskID, task.ModelID, task.ModelVersionID, task.PromptVersionID, task.Input, task.Output, task.ErrorCode, task.ErrorMessage, task.RetryCount, task.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Tasks) Transition(ctx context.Context, ownerID, taskID int64, current, next domain.TaskStatus, message string) error {
	if err := domain.ValidateTaskTransition(current, next); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
SET t.status = ?
WHERE t.id = ? AND t.status = ? AND p.user_id = ?
`, next, taskID, current, ownerID)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO shuihuo_task_events(task_id, status, message)
SELECT t.id, ?, ?
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.id = ? AND p.user_id = ?
`, next, message, taskID, ownerID); err != nil {
		return err
	}
	return tx.Commit()
}
