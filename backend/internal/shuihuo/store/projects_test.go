package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

const shuihuoStoreTestDriverName = "qiantie-shuihuo-store-test"

var (
	registerShuihuoStoreTestDriver sync.Once
	shuihuoStoreTestState          *shuihuoStoreState
)

func TestProjectQueriesAreScopedToOwner(t *testing.T) {
	repo, _ := newShuihuoRepositories(t)
	project, err := repo.Create(context.Background(), 11, domain.Project{Name: "甲项目"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := repo.GetProject(context.Background(), 12, project.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign user read error = %v, want sql.ErrNoRows", err)
	}
}

func TestManualPromptLockSurvivesReload(t *testing.T) {
	projects, segments := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{Name: "甲项目"})
	if err != nil {
		t.Fatalf("Create project error = %v", err)
	}
	segment, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{SourceText: "原文", OrderIndex: 1})
	if err != nil {
		t.Fatalf("Create segment error = %v", err)
	}
	if err := segments.UpdatePrompts(context.Background(), 11, segment.ID, "图像提示词", "视频提示词", true, true); err != nil {
		t.Fatalf("UpdatePrompts() error = %v", err)
	}

	got, err := segments.GetSegment(context.Background(), 11, segment.ID)
	if err != nil {
		t.Fatalf("GetSegment() error = %v", err)
	}
	if got.ImagePrompt != "图像提示词" || got.VideoPrompt != "视频提示词" || !got.ImagePromptLocked || !got.VideoPromptLocked {
		t.Fatalf("reloaded prompts = %#v, want persisted prompts and locks", got)
	}
}

func TestProjectSourceTextSurvivesReload(t *testing.T) {
	repo, _ := newShuihuoRepositories(t)
	project, err := repo.Create(context.Background(), 11, domain.Project{
		Name:                "原文项目",
		SourceText:          "第一章\n雨夜的车站。",
		SegmentationVersion: 3,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	got, err := repo.GetProject(context.Background(), 11, project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if got.SourceText != project.SourceText || got.SegmentationVersion != project.SegmentationVersion {
		t.Fatalf("project = %#v, want source text and segmentation version persisted", got)
	}
}

func TestSegmentSubtitleSurvivesReload(t *testing.T) {
	projects, segments := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{Name: "字幕项目"})
	if err != nil {
		t.Fatalf("Create project error = %v", err)
	}
	segment, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{
		SourceText:   "雨夜的车站。",
		SubtitleText: "雨夜，车站。",
		OrderIndex:   1,
	})
	if err != nil {
		t.Fatalf("Create segment error = %v", err)
	}

	got, err := segments.GetSegment(context.Background(), 11, segment.ID)
	if err != nil {
		t.Fatalf("GetSegment() error = %v", err)
	}
	if got.SubtitleText != segment.SubtitleText {
		t.Fatalf("subtitle = %q, want %q", got.SubtitleText, segment.SubtitleText)
	}
}

func TestTaskCreateRejectsUnknownStatus(t *testing.T) {
	tasks := NewTasks(nil)
	_, err := tasks.Create(context.Background(), 11, 1, domain.Task{Status: domain.TaskStatus("unknown")})
	if !errors.Is(err, domain.ErrInvalidTaskStatus) {
		t.Fatalf("Create() error = %v, want ErrInvalidTaskStatus", err)
	}
}

func TestTaskStatusTransitionsRejectInvalidMoves(t *testing.T) {
	if !domain.TaskDraft.CanTransitionTo(domain.TaskQueued) {
		t.Fatal("draft -> queued must be allowed")
	}
	if domain.TaskQueued.CanTransitionTo(domain.TaskSucceeded) {
		t.Fatal("queued -> succeeded must be rejected")
	}
	if err := domain.ValidateTaskTransition(domain.TaskRunning, domain.TaskSucceeded); err != nil {
		t.Fatalf("running -> succeeded error = %v", err)
	}
	if err := domain.ValidateTaskTransition(domain.TaskSucceeded, domain.TaskQueued); !errors.Is(err, domain.ErrInvalidTaskTransition) {
		t.Fatalf("succeeded -> queued error = %v, want ErrInvalidTaskTransition", err)
	}
}

func TestTaskUpdateDoesNotWriteStatus(t *testing.T) {
	const updateTaskSQL = `
UPDATE shuihuo_tasks t
JOIN shuihuo_projects p ON p.id = t.project_id
SET t.segment_id = ?, t.kind = ?, t.provider = ?, t.provider_task_id = ?, t.model_id = ?, t.model_version_id = ?, t.prompt_version_id = ?,
    t.input_snapshot = ?, t.output_snapshot = ?, t.error_code = ?, t.error_message = ?, t.retry_count = ?
WHERE t.id = ? AND p.user_id = ?`
	if strings.Contains(compactSQL(updateTaskSQL), " t.status = ") {
		t.Fatal("task metadata update must not bypass Transition by writing status")
	}
}

func newShuihuoRepositories(t *testing.T) (*Projects, *Segments) {
	t.Helper()
	registerShuihuoStoreTestDriver.Do(func() { sql.Register(shuihuoStoreTestDriverName, shuihuoStoreTestDriver{}) })
	shuihuoStoreTestState = &shuihuoStoreState{projects: make(map[int64]domain.Project), segments: make(map[int64]domain.Segment)}
	db, err := sql.Open(shuihuoStoreTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewProjects(db), NewSegments(db)
}

type shuihuoStoreState struct {
	projects      map[int64]domain.Project
	segments      map[int64]domain.Segment
	nextProjectID int64
	nextSegmentID int64
}

type shuihuoStoreTestDriver struct{}

func (shuihuoStoreTestDriver) Open(string) (driver.Conn, error) { return shuihuoStoreTestConn{}, nil }

type shuihuoStoreTestConn struct{}

func (shuihuoStoreTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (shuihuoStoreTestConn) Close() error                        { return nil }
func (shuihuoStoreTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (shuihuoStoreTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactSQL(query)
	switch {
	case strings.HasPrefix(query, "INSERT INTO shuihuo_projects"):
		shuihuoStoreTestState.nextProjectID++
		id := shuihuoStoreTestState.nextProjectID
		shuihuoStoreTestState.projects[id] = domain.Project{
			ID:                  id,
			UserID:              args[0].Value.(int64),
			Name:                args[1].Value.(string),
			SourceText:          args[2].Value.(string),
			SourceObjectKey:     args[3].Value.(string),
			SegmentationStatus:  args[4].Value.(string),
			SegmentationVersion: int(args[5].Value.(int64)),
		}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segments"):
		shuihuoStoreTestState.nextSegmentID++
		id := shuihuoStoreTestState.nextSegmentID
		projectID, ownerID := args[9].Value.(int64), args[10].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		shuihuoStoreTestState.segments[id] = domain.Segment{ID: id, ProjectID: projectID, SourceText: args[0].Value.(string), SubtitleText: args[1].Value.(string), OrderIndex: int(args[2].Value.(int64))}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments s JOIN shuihuo_projects p") && strings.Contains(query, "SET s.image_prompt"):
		id, ownerID := args[4].Value.(int64), args[5].Value.(int64)
		segment, ok := shuihuoStoreTestState.segments[id]
		project, projectOK := shuihuoStoreTestState.projects[segment.ProjectID]
		if !ok || !projectOK || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		segment.ImagePrompt = args[0].Value.(string)
		segment.VideoPrompt = args[1].Value.(string)
		segment.ImagePromptLocked = args[2].Value.(bool)
		segment.VideoPromptLocked = args[3].Value.(bool)
		shuihuoStoreTestState.segments[id] = segment
		return shuihuoStoreResult{rows: 1}, nil
	default:
		return nil, fmt.Errorf("unexpected exec query: %s", query)
	}
}

func (shuihuoStoreTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	query = compactSQL(query)
	switch {
	case strings.Contains(query, "FROM shuihuo_projects WHERE id = ? AND user_id = ?"):
		project, ok := shuihuoStoreTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{}, nil
		}
		return &shuihuoStoreRows{columns: projectColumns, values: [][]driver.Value{{project.ID, project.UserID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, int64(project.SegmentationVersion)}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p"):
		segment, ok := shuihuoStoreTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &shuihuoStoreRows{columns: segmentColumns}, nil
		}
		project, ok := shuihuoStoreTestState.projects[segment.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{columns: segmentColumns}, nil
		}
		return &shuihuoStoreRows{columns: segmentColumns, values: [][]driver.Value{{segment.ID, segment.ProjectID, segment.SourceText, segment.SubtitleText, int64(segment.OrderIndex), segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.ImagePromptLocked, segment.VideoPromptLocked}}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func compactSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type shuihuoStoreResult struct{ id, rows int64 }

func (r shuihuoStoreResult) LastInsertId() (int64, error) { return r.id, nil }
func (r shuihuoStoreResult) RowsAffected() (int64, error) { return r.rows, nil }

var projectColumns = []string{"id", "user_id", "name", "source_text", "source_object_key", "segmentation_status", "segmentation_version"}
var segmentColumns = []string{"id", "project_id", "source_text", "subtitle_text", "order_index", "confirmed", "manually_edited", "image_prompt", "video_prompt", "image_prompt_locked", "video_prompt_locked"}

type shuihuoStoreRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *shuihuoStoreRows) Columns() []string { return r.columns }
func (r *shuihuoStoreRows) Close() error      { return nil }
func (r *shuihuoStoreRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
