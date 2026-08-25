package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

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
SELECT t.id, p.user_id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.id = ? AND p.user_id = ?
`, taskID, ownerID).Scan(&task.ID, &task.UserID, &task.ProjectID, &task.SegmentID, &task.Kind, &task.Status, &task.Provider, &task.ProviderTaskID, &task.ModelID, &task.ModelVersionID, &task.PromptVersionID, &task.Input, &task.Output, &task.ErrorCode, &task.ErrorMessage, &task.RetryCount)
	return task, err
}

func (s *Tasks) GetForWorker(ctx context.Context, taskID int64) (domain.Task, error) {
	var task domain.Task
	err := s.db.QueryRowContext(ctx, `
SELECT t.id, p.user_id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.id = ?
`, taskID).Scan(&task.ID, &task.UserID, &task.ProjectID, &task.SegmentID, &task.Kind, &task.Status, &task.Provider, &task.ProviderTaskID, &task.ModelID, &task.ModelVersionID, &task.PromptVersionID, &task.Input, &task.Output, &task.ErrorCode, &task.ErrorMessage, &task.RetryCount)
	return task, err
}

func (s *Tasks) TransitionForWorker(ctx context.Context, taskID int64, current, next domain.TaskStatus, message string) error {
	if err := domain.ValidateTaskTransition(current, next); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE shuihuo_tasks SET status = ? WHERE id = ? AND status = ?`, next, taskID, current)
	if err != nil {
		return err
	}
	if err := requireAffected(result); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_task_events(task_id, status, message) VALUES(?, ?, ?)`, taskID, next, message); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Tasks) SetFailure(ctx context.Context, taskID int64, code, message string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE shuihuo_tasks SET error_code = ?, error_message = ? WHERE id = ?`, code, message, taskID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Tasks) SetOutput(ctx context.Context, taskID int64, output string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE shuihuo_tasks SET output_snapshot = ?, error_code = '', error_message = '' WHERE id = ?`, output, taskID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Tasks) SetProviderTask(ctx context.Context, taskID int64, providerTaskID string, nextPollAt time.Time) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_tasks
SET provider_task_id = ?, next_poll_at = ?, error_code = '', error_message = ''
WHERE id = ? AND status = 'running'
`, providerTaskID, nextPollAt, taskID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Tasks) ListRunningByProvider(ctx context.Context, provider string, dueAt time.Time, limit int) ([]domain.Task, error) {
	if limit < 1 {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT t.id, p.user_id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.provider = ? AND t.status = 'running' AND t.provider_task_id IS NOT NULL AND t.provider_task_id <> ''
  AND (t.next_poll_at IS NULL OR t.next_poll_at <= ?)
ORDER BY t.next_poll_at ASC, t.id ASC
LIMIT ?
`, provider, dueAt, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
}

func (s *Tasks) SetNextPoll(ctx context.Context, taskID int64, nextPollAt time.Time) error {
	result, err := s.db.ExecContext(ctx, `UPDATE shuihuo_tasks SET next_poll_at = ? WHERE id = ? AND status = 'running'`, nextPollAt, taskID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

// CompleteWithGeneratedMedia is the terminal compare-and-set. The media row
// and task transition commit together, so a restart or duplicate poll cannot
// expose an extra video record.
func (s *Tasks) CompleteWithGeneratedMedia(ctx context.Context, taskID int64, media domain.Media, output string) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
UPDATE shuihuo_tasks
SET status = 'succeeded', output_snapshot = ?, error_code = '', error_message = '', next_poll_at = NULL
WHERE id = ? AND status = 'running'
`, output, taskID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected == 0 {
		return false, tx.Rollback()
	}
	result, err = tx.ExecContext(ctx, `
INSERT INTO shuihuo_media(project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, media.ProjectID, media.SegmentID, media.TaskID, media.Kind, media.ObjectKey, media.Source, media.ManuallyEdited, media.Width, media.Height, media.DurationMS, media.IsPrimary)
	if err != nil {
		return false, err
	}
	if _, err := result.LastInsertId(); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_task_events(task_id, status, message) VALUES(?, 'succeeded', '生成素材已保存')`, taskID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func scanTasks(rows *sql.Rows) ([]domain.Task, error) {
	tasks := make([]domain.Task, 0)
	for rows.Next() {
		var task domain.Task
		if err := rows.Scan(&task.ID, &task.UserID, &task.ProjectID, &task.SegmentID, &task.Kind, &task.Status, &task.Provider, &task.ProviderTaskID, &task.ModelID, &task.ModelVersionID, &task.PromptVersionID, &task.Input, &task.Output, &task.ErrorCode, &task.ErrorMessage, &task.RetryCount); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Tasks) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Task, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT t.id, p.user_id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
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
	return scanTasks(rows)
}

func (s *Tasks) ListByProjects(ctx context.Context, ownerID int64, projectIDs []int64) ([]domain.Task, error) {
	if len(projectIDs) == 0 {
		return []domain.Task{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(projectIDs)), ",")
	args := make([]any, 0, len(projectIDs)+1)
	for _, projectID := range projectIDs {
		args = append(args, projectID)
	}
	args = append(args, ownerID)
	rows, err := s.db.QueryContext(ctx, `
SELECT t.id, p.user_id, t.project_id, t.segment_id, t.kind, t.status, t.provider, t.provider_task_id, t.model_id, t.model_version_id, t.prompt_version_id,
       t.input_snapshot, t.output_snapshot, t.error_code, t.error_message, t.retry_count
FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.project_id IN (`+placeholders+`) AND p.user_id = ?
ORDER BY t.project_id ASC, t.created_at ASC, t.id ASC
`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
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

func (s *Tasks) Cancel(ctx context.Context, ownerID, taskID int64) error {
	task, err := s.Get(ctx, ownerID, taskID)
	if err != nil {
		return err
	}
	if task.Status != domain.TaskDraft && task.Status != domain.TaskQueued && task.Status != domain.TaskRunning {
		return domain.ErrInvalidTaskTransition
	}
	return s.Transition(ctx, ownerID, taskID, task.Status, domain.TaskCancelled, "用户取消任务")
}

func (s *Tasks) Retry(ctx context.Context, ownerID, taskID int64) (domain.Task, error) {
	task, err := s.Get(ctx, ownerID, taskID)
	if err != nil {
		return domain.Task{}, err
	}
	if task.Status != domain.TaskFailed && task.Status != domain.TaskCancelled {
		return domain.Task{}, domain.ErrInvalidTaskTransition
	}
	task.ID, task.ProviderTaskID = 0, ""
	task.Status, task.ErrorCode, task.ErrorMessage = domain.TaskDraft, "", ""
	task.RetryCount++
	return s.Create(ctx, ownerID, task.ProjectID, task)
}

func (s *Tasks) Delete(ctx context.Context, ownerID, taskID int64) error {
	result, err := s.db.ExecContext(ctx, `
DELETE t FROM shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
WHERE t.id = ? AND p.user_id = ? AND t.status = 'draft'
`, taskID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}
