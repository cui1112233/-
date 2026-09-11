package batchfactoryv11

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Keep the production repository explicit: callers may use the normal Store
// interface for read-only V11 work, but submission needs durable state.
var _ ProductionRepository = (*MySQLStore)(nil)

type productionQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *MySQLStore) FindProductionJob(ctx context.Context, owner, batchID, bookID, requestID string) (ProductionJob, error) {
	return findProductionJob(ctx, s.db, owner, batchID, bookID, requestID)
}

func findProductionJob(ctx context.Context, q productionQueryer, owner, batchID, bookID, requestID string) (ProductionJob, error) {
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM batch_factory_v11_production_jobs WHERE owner_username=? AND batch_id=? AND book_id=? AND request_id=?`, owner, batchID, bookID, requestID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ProductionJob{}, ErrNotFound
	}
	if err != nil {
		return ProductionJob{}, err
	}
	return loadProductionJob(ctx, q, owner, id)
}

func loadProductionJob(ctx context.Context, q productionQueryer, owner, id string) (ProductionJob, error) {
	var value ProductionJob
	var state string
	err := q.QueryRowContext(ctx, `SELECT id,batch_id,book_id,request_id,director_revision_id,status,created_at,updated_at FROM batch_factory_v11_production_jobs WHERE id=? AND owner_username=?`, id, owner).Scan(
		&value.ID, &value.BatchID, &value.BookID, &value.RequestID, &value.DirectorRevisionID, &state, &value.CreatedAt, &value.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return ProductionJob{}, ErrNotFound
	}
	if err != nil {
		return ProductionJob{}, err
	}
	value.Owner = owner
	value.Status = ProductionState(state)
	value.Tasks = []ProductionTask{}
	rows, err := q.QueryContext(ctx, `SELECT id,video_id,provider,status,attempt,final_prompt_hash,compiled_prompt,COALESCE(provider_task_id,''),COALESCE(media_url,''),COALESCE(error_message,''),created_at,updated_at FROM batch_factory_v11_production_tasks WHERE job_id=? AND owner_username=? ORDER BY created_at,id`, id, owner)
	if err != nil {
		return ProductionJob{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var task ProductionTask
		var taskState string
		if err := rows.Scan(&task.ID, &task.VideoID, &task.Provider, &taskState, &task.Attempt, &task.FinalPromptHash, &task.CompiledPrompt, &task.ProviderTaskID, &task.MediaURL, &task.ErrorMessage, &task.CreatedAt, &task.UpdatedAt); err != nil {
			return ProductionJob{}, err
		}
		task.Status = ProductionState(taskState)
		value.Tasks = append(value.Tasks, task)
	}
	if err := rows.Err(); err != nil {
		return ProductionJob{}, err
	}
	return value, nil
}

func (s *MySQLStore) CreateProductionJob(ctx context.Context, value ProductionJob) (ProductionJob, error) {
	if strings.TrimSpace(value.Owner) == "" || strings.TrimSpace(value.BatchID) == "" || strings.TrimSpace(value.BookID) == "" || strings.TrimSpace(value.RequestID) == "" || strings.TrimSpace(value.DirectorRevisionID) == "" || len(value.Tasks) == 0 {
		return ProductionJob{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ProductionJob{}, err
	}
	defer tx.Rollback()
	if existing, findErr := findProductionJob(ctx, tx, value.Owner, value.BatchID, value.BookID, value.RequestID); findErr == nil {
		return existing, nil
	} else if !errors.Is(findErr, ErrNotFound) {
		return ProductionJob{}, findErr
	}

	jobID, err := newID("production")
	if err != nil {
		return ProductionJob{}, err
	}
	now := time.Now().UTC()
	value.ID = jobID
	value.Status = productionJobState(value.Tasks)
	value.CreatedAt, value.UpdatedAt = now, now
	_, err = tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_production_jobs(id,owner_username,batch_id,book_id,request_id,director_revision_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, value.ID, value.Owner, value.BatchID, value.BookID, value.RequestID, value.DirectorRevisionID, value.Status, now, now)
	if err != nil {
		var duplicate *mysql.MySQLError
		if errors.As(err, &duplicate) && duplicate.Number == 1062 {
			_ = tx.Rollback()
			return s.FindProductionJob(ctx, value.Owner, value.BatchID, value.BookID, value.RequestID)
		}
		return ProductionJob{}, err
	}
	for index := range value.Tasks {
		task := &value.Tasks[index]
		taskID, idErr := newID("production-task")
		if idErr != nil {
			return ProductionJob{}, idErr
		}
		task.ID = taskID
		task.Status = normalizeProductionState(task.Status)
		task.CreatedAt, task.UpdatedAt = now, now
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_production_tasks(id,job_id,owner_username,video_id,provider,attempt,final_prompt_hash,compiled_prompt,provider_task_id,media_url,status,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, task.ID, value.ID, value.Owner, task.VideoID, nullableString(task.Provider), task.Attempt, task.FinalPromptHash, task.CompiledPrompt, nullableString(task.ProviderTaskID), nullableString(task.MediaURL), task.Status, nullableString(task.ErrorMessage), now, now); err != nil {
			return ProductionJob{}, err
		}
		if err := insertProductionEvent(ctx, tx, value.ID, task.ID, value.Owner, "created", "", string(task.Status), ""); err != nil {
			return ProductionJob{}, err
		}
	}
	if err := insertProductionEvent(ctx, tx, value.ID, "", value.Owner, "created", "", string(value.Status), ""); err != nil {
		return ProductionJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProductionJob{}, err
	}
	return loadProductionJob(ctx, s.db, value.Owner, value.ID)
}

func (s *MySQLStore) UpdateProductionTask(ctx context.Context, owner, jobID, taskID string, task ProductionTask) (ProductionJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ProductionJob{}, err
	}
	defer tx.Rollback()
	var prior string
	err = tx.QueryRowContext(ctx, `SELECT status FROM batch_factory_v11_production_tasks WHERE id=? AND job_id=? AND owner_username=? FOR UPDATE`, taskID, jobID, owner).Scan(&prior)
	if errors.Is(err, sql.ErrNoRows) {
		return ProductionJob{}, ErrNotFound
	}
	if err != nil {
		return ProductionJob{}, err
	}
	task.Status = normalizeProductionState(task.Status)
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_production_tasks SET provider_task_id=?,media_url=?,status=?,error_message=?,updated_at=? WHERE id=? AND job_id=? AND owner_username=?`, nullableString(task.ProviderTaskID), nullableString(task.MediaURL), task.Status, nullableString(productionError(errors.New(task.ErrorMessage))), now, taskID, jobID, owner); err != nil {
		return ProductionJob{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT status FROM batch_factory_v11_production_tasks WHERE job_id=? AND owner_username=? FOR UPDATE`, jobID, owner)
	if err != nil {
		return ProductionJob{}, err
	}
	states := []ProductionTask{}
	for rows.Next() {
		var state string
		if err := rows.Scan(&state); err != nil {
			rows.Close()
			return ProductionJob{}, err
		}
		states = append(states, ProductionTask{Status: ProductionState(state)})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ProductionJob{}, err
	}
	rows.Close()
	if len(states) == 0 {
		return ProductionJob{}, ErrNotFound
	}
	jobState := productionJobState(states)
	if _, err := tx.ExecContext(ctx, `UPDATE batch_factory_v11_production_jobs SET status=?,updated_at=? WHERE id=? AND owner_username=?`, jobState, now, jobID, owner); err != nil {
		return ProductionJob{}, err
	}
	if err := insertProductionEvent(ctx, tx, jobID, taskID, owner, "state_changed", prior, string(task.Status), productionError(errors.New(task.ErrorMessage))); err != nil {
		return ProductionJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProductionJob{}, err
	}
	return loadProductionJob(ctx, s.db, owner, jobID)
}

func (s *MySQLStore) ListProductionJobs(ctx context.Context, owner, batchID string) ([]ProductionJob, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM batch_factory_v11_production_jobs WHERE owner_username=? AND batch_id=? ORDER BY created_at,id`, owner, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProductionJob{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		job, err := loadProductionJob(ctx, s.db, owner, id)
		if err != nil {
			return nil, err
		}
		out = append(out, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func insertProductionEvent(ctx context.Context, tx *sql.Tx, jobID, taskID, owner, eventType, fromState, toState, message string) error {
	var task any
	if strings.TrimSpace(taskID) != "" {
		task = taskID
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_production_events(job_id,task_id,owner_username,event_type,from_state,to_state,message,created_at) VALUES(?,?,?,?,?,?,?,?)`, jobID, task, owner, eventType, nullableString(fromState), nullableString(toState), nullableString(productionError(errors.New(message))), time.Now().UTC()); err != nil {
		return err
	}
	return nil
}
