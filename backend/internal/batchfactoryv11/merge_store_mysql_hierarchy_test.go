package batchfactoryv11

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const loadMergeHierarchySQL = `SELECT id,batch_id,request_id,root_request_id,book_id,video_id,stage,timing_mode,speed,tts_speed,audio_duration_seconds,provider_task_id,status,output_url,error_message,created_at,updated_at FROM batch_factory_v11_merge_jobs WHERE id=? AND owner_username=?`
const loadMergeHierarchySourcesSQL = `SELECT production_job_id,book_id,video_id,shot_id,ordinal,media_url FROM batch_factory_v11_merge_sources WHERE job_id=? AND owner_username=? ORDER BY ordinal,video_id`

func TestLoadMergeJobRestoresHierarchyTimingAndShotSources(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta(loadMergeHierarchySQL)).
		WithArgs("merge-1", "alice").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "batch_id", "request_id", "root_request_id", "book_id", "video_id", "stage", "timing_mode", "speed", "tts_speed", "audio_duration_seconds", "provider_task_id", "status", "output_url", "error_message", "created_at", "updated_at",
		}).AddRow(
			"merge-1", "batch-1", "root-1:video:video-1", "root-1", "book-1", "video-1", "video", "audio", 0.0, 1.7, 6.25, "provider-1", "succeeded", "https://media.example/video.mp4", nil, now, now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(loadMergeHierarchySourcesSQL)).
		WithArgs("merge-1", "alice").
		WillReturnRows(sqlmock.NewRows([]string{"production_job_id", "book_id", "video_id", "shot_id", "ordinal", "media_url"}).
			AddRow("production-1", "book-1", "video-1", "shot-1", 0, "https://media.example/shot-1.mp4").
			AddRow("production-1", "book-1", "video-1", "shot-2", 1, "https://media.example/shot-2.mp4"))

	job, err := loadMergeJob(context.Background(), db, "alice", "merge-1")
	if err != nil {
		t.Fatal(err)
	}
	if job.RootRequestID != "root-1" || job.BookID != "book-1" || job.VideoID != "video-1" || job.Stage != MergeStageVideo {
		t.Fatalf("hierarchy lost: %+v", job)
	}
	if job.TimingMode != "audio" || job.Speed != 0 || job.TTSSpeed != 1.7 || job.AudioDurationSeconds != 6.25 {
		t.Fatalf("timing lost: %+v", job)
	}
	if len(job.Sources) != 2 || job.Sources[0].ProductionJobID != "production-1" || job.Sources[0].BookID != "book-1" || job.Sources[0].ShotID != "shot-1" || job.Sources[1].ShotID != "shot-2" {
		t.Fatalf("source hierarchy lost: %+v", job.Sources)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateMergeJobPersistsHierarchyTimingAndShotSource(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &MySQLStore{db: db}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id FROM batch_factory_v11_merge_jobs WHERE owner_username=? AND batch_id=? AND request_id=?`)).
		WithArgs("alice", "batch-1", "root-1:video:video-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO batch_factory_v11_merge_jobs(id,owner_username,batch_id,request_id,root_request_id,book_id,video_id,stage,timing_mode,speed,tts_speed,audio_duration_seconds,provider_task_id,status,output_url,error_message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)).
		WithArgs(sqlmock.AnyArg(), "alice", "batch-1", "root-1:video:video-1", "root-1", "book-1", "video-1", MergeStageVideo, "speed", 1.0, 1.7, 0.0, nil, MergeQueued, nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO batch_factory_v11_merge_sources(job_id,owner_username,production_job_id,book_id,video_id,shot_id,ordinal,media_url,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)).
		WithArgs(sqlmock.AnyArg(), "alice", "production-1", "book-1", "video-1", "shot-1", 0, "https://media.example/shot-1.mp4", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta(loadMergeHierarchySQL)).
		WithArgs(sqlmock.AnyArg(), "alice").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "batch_id", "request_id", "root_request_id", "book_id", "video_id", "stage", "timing_mode", "speed", "tts_speed", "audio_duration_seconds", "provider_task_id", "status", "output_url", "error_message", "created_at", "updated_at",
		}).AddRow(
			"merge-created", "batch-1", "root-1:video:video-1", "root-1", "book-1", "video-1", "video", "speed", 1.0, 1.7, 0.0, nil, "queued", nil, nil, now, now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(loadMergeHierarchySourcesSQL)).
		WithArgs(sqlmock.AnyArg(), "alice").
		WillReturnRows(sqlmock.NewRows([]string{"production_job_id", "book_id", "video_id", "shot_id", "ordinal", "media_url"}).
			AddRow("production-1", "book-1", "video-1", "shot-1", 0, "https://media.example/shot-1.mp4"))

	created, err := store.CreateMergeJob(context.Background(), MergeJob{
		Owner:         "alice",
		BatchID:       "batch-1",
		RequestID:     "root-1:video:video-1",
		RootRequestID: "root-1",
		BookID:        "book-1",
		VideoID:       "video-1",
		Stage:         MergeStageVideo,
		TimingMode:    "speed",
		Speed:         1,
		TTSSpeed:      1.7,
		Status:        MergeQueued,
		Sources: []MergeMedia{{
			ProductionJobID: "production-1",
			BookID:          "book-1",
			VideoID:         "video-1",
			ShotID:          "shot-1",
			MediaURL:        "https://media.example/shot-1.mp4",
			Order:           0,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.RootRequestID != "root-1" || created.Stage != MergeStageVideo || len(created.Sources) != 1 || created.Sources[0].ShotID != "shot-1" {
		t.Fatalf("created hierarchy lost: %+v", created)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
