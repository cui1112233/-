package batchfactoryv11

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

var _ MergeRepository = (*MySQLStore)(nil)

func (s *MySQLStore) FindMergeJob(ctx context.Context, owner, batchID, requestID string) (MergeJob, error) {
	return findMergeJob(ctx, s.db, owner, batchID, requestID)
}

func findMergeJob(ctx context.Context, q productionQueryer, owner, batchID, requestID string) (MergeJob, error) {
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM batch_factory_v11_merge_jobs WHERE owner_username=? AND batch_id=? AND request_id=?`, owner, batchID, requestID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return MergeJob{}, ErrNotFound
	}
	if err != nil {
		return MergeJob{}, err
	}
	return loadMergeJob(ctx, q, owner, id)
}

func loadMergeJob(ctx context.Context, q productionQueryer, owner, id string) (MergeJob, error) {
	var value MergeJob
	var state string
	var outputURL, errorMessage sql.NullString
	var providerTaskID sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id,batch_id,request_id,provider_task_id,status,output_url,error_message,created_at,updated_at FROM batch_factory_v11_merge_jobs WHERE id=? AND owner_username=?`, id, owner).Scan(
		&value.ID, &value.BatchID, &value.RequestID, &providerTaskID, &state, &outputURL, &errorMessage, &value.CreatedAt, &value.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return MergeJob{}, ErrNotFound
	}
	if err != nil {
		return MergeJob{}, err
	}
	value.Owner = owner
	value.Status = MergeState(state)
	value.ProviderTaskID = providerTaskID.String
	value.OutputURL = outputURL.String
	value.ErrorMessage = errorMessage.String
	value.Sources = []MergeMedia{}
	rows, err := q.QueryContext(ctx, `SELECT video_id,ordinal,media_url FROM batch_factory_v11_merge_sources WHERE job_id=? AND owner_username=? ORDER BY ordinal,video_id`, id, owner)
	if err != nil {
		return MergeJob{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var source MergeMedia
		if err := rows.Scan(&source.VideoID, &source.Order, &source.MediaURL); err != nil {
			return MergeJob{}, err
		}
		source.URL = source.MediaURL
		value.Sources = append(value.Sources, source)
	}
	if err := rows.Err(); err != nil {
		return MergeJob{}, err
	}
	return value, nil
}

func (s *MySQLStore) CreateMergeJob(ctx context.Context, value MergeJob) (MergeJob, error) {
	if strings.TrimSpace(value.Owner) == "" || strings.TrimSpace(value.BatchID) == "" || strings.TrimSpace(value.RequestID) == "" || len(value.Sources) == 0 {
		return MergeJob{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MergeJob{}, err
	}
	defer tx.Rollback()
	if existing, findErr := findMergeJob(ctx, tx, value.Owner, value.BatchID, value.RequestID); findErr == nil {
		return existing, nil
	} else if !errors.Is(findErr, ErrNotFound) {
		return MergeJob{}, findErr
	}
	jobID, err := newID("merge")
	if err != nil {
		return MergeJob{}, err
	}
	now := time.Now().UTC()
	value.ID = jobID
	value.Status = normalizeMergeState(value.Status)
	value.CreatedAt, value.UpdatedAt = now, now
	if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_merge_jobs(id,owner_username,batch_id,request_id,provider_task_id,status,output_url,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, value.ID, value.Owner, value.BatchID, value.RequestID, nullableString(value.ProviderTaskID), value.Status, nullableString(value.OutputURL), nullableString(value.ErrorMessage), now, now); err != nil {
		var duplicate *mysql.MySQLError
		if errors.As(err, &duplicate) && duplicate.Number == 1062 {
			_ = tx.Rollback()
			return s.FindMergeJob(ctx, value.Owner, value.BatchID, value.RequestID)
		}
		return MergeJob{}, err
	}
	for ordinal, source := range value.Sources {
		if strings.TrimSpace(source.VideoID) == "" || strings.TrimSpace(source.MediaURL) == "" || source.Order != ordinal {
			return MergeJob{}, ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO batch_factory_v11_merge_sources(job_id,owner_username,video_id,ordinal,media_url,created_at) VALUES(?,?,?,?,?,?)`, value.ID, value.Owner, source.VideoID, source.Order, source.MediaURL, now); err != nil {
			return MergeJob{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MergeJob{}, err
	}
	return loadMergeJob(ctx, s.db, value.Owner, value.ID)
}

func (s *MySQLStore) UpdateMergeJob(ctx context.Context, owner, jobID string, value MergeJob) (MergeJob, error) {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(jobID) == "" {
		return MergeJob{}, ErrInvalid
	}
	value.Status = normalizeMergeState(value.Status)
	result, err := s.db.ExecContext(ctx, `UPDATE batch_factory_v11_merge_jobs SET provider_task_id=?,status=?,output_url=?,error_message=?,updated_at=? WHERE id=? AND owner_username=?`, nullableString(value.ProviderTaskID), value.Status, nullableString(value.OutputURL), nullableString(value.ErrorMessage), time.Now().UTC(), jobID, owner)
	if err != nil {
		return MergeJob{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return MergeJob{}, ErrNotFound
	}
	return loadMergeJob(ctx, s.db, owner, jobID)
}

func (s *MySQLStore) ListMergeJobs(ctx context.Context, owner, batchID string) ([]MergeJob, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM batch_factory_v11_merge_jobs WHERE owner_username=? AND batch_id=? ORDER BY created_at,id`, owner, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MergeJob{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		job, err := loadMergeJob(ctx, s.db, owner, id)
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
