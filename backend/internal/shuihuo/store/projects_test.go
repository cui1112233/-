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
	"time"

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

func TestProjectDeleteIsScopedToOwner(t *testing.T) {
	repo, _ := newShuihuoRepositories(t)
	project, err := repo.Create(context.Background(), 11, domain.Project{Name: "待删除项目"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := repo.Delete(context.Background(), 12, project.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign Delete() error = %v, want sql.ErrNoRows", err)
	}
	if _, err := repo.GetProject(context.Background(), 11, project.ID); err != nil {
		t.Fatalf("project disappeared after foreign delete: %v", err)
	}
	if err := repo.Delete(context.Background(), 11, project.ID); err != nil {
		t.Fatalf("owner Delete() error = %v", err)
	}
	if _, err := repo.GetProject(context.Background(), 11, project.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("project still exists after Delete(): %v", err)
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
	if err := segments.UpdatePrompts(context.Background(), 11, segment.ID, "图像提示词", "视频提示词", "负面提示词", true, true, true); err != nil {
		t.Fatalf("UpdatePrompts() error = %v", err)
	}

	got, err := segments.GetSegment(context.Background(), 11, segment.ID)
	if err != nil {
		t.Fatalf("GetSegment() error = %v", err)
	}
	if got.ImagePrompt != "图像提示词" || got.VideoPrompt != "视频提示词" || got.NegativePrompt != "负面提示词" || !got.ImagePromptLocked || !got.VideoPromptLocked || !got.NegativePromptLocked {
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

func TestReplaceSourceArchivesStoryboardAndRejectsActiveTasks(t *testing.T) {
	projects, _ := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{
		Name:                "原文项目",
		SourceText:          "旧原文",
		SourceObjectKey:     "shuihuo-production/11/1/source/old.txt",
		SegmentationStatus:  "confirmed",
		SegmentationVersion: 2,
	})
	if err != nil {
		t.Fatal(err)
	}

	updated, oldObjectKey, err := projects.ReplaceSource(context.Background(), 11, project.ID, "新原文")
	if err != nil {
		t.Fatalf("ReplaceSource() error = %v", err)
	}
	if oldObjectKey != project.SourceObjectKey || updated.SourceText != "新原文" || updated.SourceObjectKey != "" || updated.SegmentationStatus != "draft" || updated.SegmentationVersion != 3 {
		t.Fatalf("ReplaceSource() = %#v, %q", updated, oldObjectKey)
	}
	if shuihuoStoreTestState.projectLockCount != 1 || shuihuoStoreTestState.archivedProjectID != project.ID {
		t.Fatalf("replace did not lock/archive current workbench: %#v", shuihuoStoreTestState)
	}

	shuihuoStoreTestState.activeTasks[project.ID] = true
	if _, _, err := projects.ReplaceSource(context.Background(), 11, project.ID, "不能替换"); !errors.Is(err, ErrSourceReplacementHasActiveTasks) {
		t.Fatalf("ReplaceSource() active task error = %v, want ErrSourceReplacementHasActiveTasks", err)
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

func TestMappedSegmentUpdateProtectsSourceAndKeepsEditableFields(t *testing.T) {
	projects, segments := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{Name: "分镜项目"})
	if err != nil {
		t.Fatal(err)
	}
	segment, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{SourceText: "原文", OrderIndex: 1, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	segment.SubtitleText = "新字幕"
	segment.ImagePrompt = "新生图提示词"
	segment.VideoPrompt = "新视频提示词"
	segment.ImagePromptLocked = true
	segment.VideoPromptLocked = true
	if err := segments.Update(context.Background(), 11, segment); err != nil {
		t.Fatalf("Update() editable fields error = %v", err)
	}
	stored, err := segments.GetSegment(context.Background(), 11, segment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.SubtitleText != "新字幕" || stored.ImagePrompt != "新生图提示词" || !stored.VideoPromptLocked {
		t.Fatalf("stored editable fields = %#v", stored)
	}
	segment.SourceText = "篡改原文"
	if err := segments.Update(context.Background(), 11, segment); !errors.Is(err, ErrMappedSegmentStructureChange) {
		t.Fatalf("Update() source mutation error = %v, want ErrMappedSegmentStructureChange", err)
	}
	segment.SourceText = stored.SourceText
	segment.OrderIndex = 2
	if err := segments.Update(context.Background(), 11, segment); !errors.Is(err, ErrMappedSegmentStructureChange) {
		t.Fatalf("Update() order mutation error = %v, want ErrMappedSegmentStructureChange", err)
	}
}

func TestDeleteAndReorderAcquireProjectLock(t *testing.T) {
	projects, segments := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{Name: "锁测试"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{SourceText: "第一段", OrderIndex: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{SourceText: "第二段", OrderIndex: 2})
	if err != nil {
		t.Fatal(err)
	}
	shuihuoStoreTestState.projectLockCount = 0
	if err := segments.Delete(context.Background(), 11, second.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if shuihuoStoreTestState.projectLockCount != 1 {
		t.Fatalf("Delete() project locks = %d, want 1", shuihuoStoreTestState.projectLockCount)
	}
	if err := segments.Reorder(context.Background(), 11, project.ID, []int64{first.ID}); err != nil {
		t.Fatalf("Reorder() error = %v", err)
	}
	if shuihuoStoreTestState.projectLockCount != 2 {
		t.Fatalf("Reorder() project locks = %d, want 2", shuihuoStoreTestState.projectLockCount)
	}

	shuihuoStoreTestState.activeTasks[project.ID] = true
	if err := segments.Delete(context.Background(), 11, first.ID); !errors.Is(err, ErrStoryboardMutationHasActiveTasks) {
		t.Fatalf("Delete() active task error = %v, want ErrStoryboardMutationHasActiveTasks", err)
	}
	if err := segments.Reorder(context.Background(), 11, project.ID, []int64{first.ID}); !errors.Is(err, ErrStoryboardMutationHasActiveTasks) {
		t.Fatalf("Reorder() active task error = %v, want ErrStoryboardMutationHasActiveTasks", err)
	}
	first.OrderIndex = 2
	if err := segments.Update(context.Background(), 11, first); !errors.Is(err, ErrStoryboardMutationHasActiveTasks) {
		t.Fatalf("Update() structural active task error = %v, want ErrStoryboardMutationHasActiveTasks", err)
	}
}

func TestReplaceSegmentAssetsUsesProjectLockAndActiveTaskGuard(t *testing.T) {
	projects, segments := newShuihuoRepositories(t)
	project, err := projects.Create(context.Background(), 11, domain.Project{Name: "预设绑定"})
	if err != nil {
		t.Fatal(err)
	}
	segment, err := segments.Create(context.Background(), 11, project.ID, domain.Segment{SourceText: "第一段", OrderIndex: 1})
	if err != nil {
		t.Fatal(err)
	}
	assets := NewAssets(segments.db)
	shuihuoStoreTestState.assets[301] = domain.Asset{ID: 301, ProjectID: project.ID, Name: "主角"}
	shuihuoStoreTestState.projectLockCount = 0

	if err := assets.ReplaceSegmentAssets(context.Background(), 11, segment.ID, []int64{301}); err != nil {
		t.Fatalf("ReplaceSegmentAssets() error = %v", err)
	}
	if got := shuihuoStoreTestState.segmentAssetMappings[segment.ID]; len(got) != 1 || got[0] != 301 {
		t.Fatalf("asset bindings = %#v", shuihuoStoreTestState.segmentAssetMappings)
	}
	if shuihuoStoreTestState.projectLockCount != 1 {
		t.Fatalf("project locks = %d, want 1", shuihuoStoreTestState.projectLockCount)
	}

	shuihuoStoreTestState.activeTasks[project.ID] = true
	if err := assets.ReplaceSegmentAssets(context.Background(), 11, segment.ID, nil); !errors.Is(err, ErrStoryboardMutationHasActiveTasks) {
		t.Fatalf("active task error = %v, want ErrStoryboardMutationHasActiveTasks", err)
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
	shuihuoStoreTestState = &shuihuoStoreState{projects: make(map[int64]domain.Project), segments: make(map[int64]domain.Segment), assets: make(map[int64]domain.Asset), units: make(map[int64]domain.SourceUnit), mappings: make(map[int64][]int64), segmentAssetMappings: make(map[int64][]int64), activeTasks: make(map[int64]bool)}
	db, err := sql.Open(shuihuoStoreTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewProjects(db), NewSegments(db)
}

type shuihuoStoreState struct {
	projects             map[int64]domain.Project
	segments             map[int64]domain.Segment
	assets               map[int64]domain.Asset
	units                map[int64]domain.SourceUnit
	mappings             map[int64][]int64
	segmentAssetMappings map[int64][]int64
	nextProjectID        int64
	nextSegmentID        int64
	nextSourceID         int64
	projectLockCount     int
	activeTasks          map[int64]bool
	archivedProjectID    int64
}

type shuihuoStoreTestDriver struct{}

func (shuihuoStoreTestDriver) Open(string) (driver.Conn, error) { return shuihuoStoreTestConn{}, nil }

type shuihuoStoreTestConn struct{}

func (shuihuoStoreTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (shuihuoStoreTestConn) Close() error                        { return nil }
func (shuihuoStoreTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }
func (shuihuoStoreTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return shuihuoStoreTestTx{}, nil
}

type shuihuoStoreTestTx struct{}

func (shuihuoStoreTestTx) Commit() error   { return nil }
func (shuihuoStoreTestTx) Rollback() error { return nil }
func (shuihuoStoreTestTx) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return shuihuoStoreTestConn{}.ExecContext(ctx, query, args)
}
func (shuihuoStoreTestTx) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return shuihuoStoreTestConn{}.QueryContext(ctx, query, args)
}

func (shuihuoStoreTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactSQL(query)
	switch {
	case strings.HasPrefix(query, "INSERT IGNORE INTO shuihuo_segment_source_unit_history"):
		shuihuoStoreTestState.archivedProjectID = args[1].Value.(int64)
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE project_id = ?"):
		projectID := args[0].Value.(int64)
		for id, segment := range shuihuoStoreTestState.segments {
			if segment.ProjectID == projectID {
				delete(shuihuoStoreTestState.segments, id)
				delete(shuihuoStoreTestState.mappings, id)
			}
		}
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_projects SET source_text = ?"):
		projectID, ownerID := args[1].Value.(int64), args[2].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		project.SourceText = args[0].Value.(string)
		project.SourceObjectKey = ""
		project.SegmentationStatus = "draft"
		project.SegmentationVersion++
		shuihuoStoreTestState.projects[projectID] = project
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_projects SET source_object_key = ?"):
		projectID, ownerID := args[1].Value.(int64), args[2].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		project.SourceObjectKey = args[0].Value.(string)
		shuihuoStoreTestState.projects[projectID] = project
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_projects WHERE id = ?"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		delete(shuihuoStoreTestState.projects, projectID)
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET source_text"):
		segment := shuihuoStoreTestState.segments[args[12].Value.(int64)]
		segment.SourceText = args[0].Value.(string)
		segment.SubtitleText = args[1].Value.(string)
		segment.Speaker = args[2].Value.(string)
		segment.OrderIndex = int(args[3].Value.(int64))
		segment.Confirmed = args[4].Value.(bool)
		segment.ManuallyEdited = args[5].Value.(bool)
		segment.ImagePrompt = args[6].Value.(string)
		segment.VideoPrompt = args[7].Value.(string)
		segment.NegativePrompt = args[8].Value.(string)
		segment.ImagePromptLocked = args[9].Value.(bool)
		segment.VideoPromptLocked = args[10].Value.(bool)
		segment.NegativePromptLocked = args[11].Value.(bool)
		shuihuoStoreTestState.segments[segment.ID] = segment
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE id"):
		delete(shuihuoStoreTestState.segments, args[0].Value.(int64))
		delete(shuihuoStoreTestState.mappings, args[0].Value.(int64))
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segment_assets WHERE segment_id = ?"):
		delete(shuihuoStoreTestState.segmentAssetMappings, args[0].Value.(int64))
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segment_assets(segment_id, asset_id)"):
		segmentID, assetID := args[0].Value.(int64), args[1].Value.(int64)
		shuihuoStoreTestState.segmentAssetMappings[segmentID] = append(shuihuoStoreTestState.segmentAssetMappings[segmentID], assetID)
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET order_index"):
		segment := shuihuoStoreTestState.segments[args[1].Value.(int64)]
		segment.OrderIndex = int(args[0].Value.(int64))
		shuihuoStoreTestState.segments[segment.ID] = segment
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_source_units"):
		shuihuoStoreTestState.nextSourceID++
		id := shuihuoStoreTestState.nextSourceID
		shuihuoStoreTestState.units[id] = domain.SourceUnit{ID: id, ProjectID: args[0].Value.(int64), Text: args[1].Value.(string), SourceKind: args[2].Value.(string), SegmentationVersion: int(args[3].Value.(int64)), SourceOrder: int(args[4].Value.(int64))}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segment_source_units"):
		segmentID, sourceID := args[0].Value.(int64), args[1].Value.(int64)
		shuihuoStoreTestState.mappings[segmentID] = append(shuihuoStoreTestState.mappings[segmentID], sourceID)
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segments(project_id") && !strings.Contains(query, "SELECT id"):
		shuihuoStoreTestState.nextSegmentID++
		id := shuihuoStoreTestState.nextSegmentID
		shuihuoStoreTestState.segments[id] = domain.Segment{ID: id, ProjectID: args[0].Value.(int64), SourceText: args[1].Value.(string), SubtitleText: args[2].Value.(string), Speaker: args[3].Value.(string), OrderIndex: int(args[4].Value.(int64)), Confirmed: args[5].Value.(bool), ManuallyEdited: args[6].Value.(bool), ImagePrompt: args[7].Value.(string), VideoPrompt: args[8].Value.(string), NegativePrompt: args[9].Value.(string), ImagePromptLocked: args[10].Value.(bool), VideoPromptLocked: args[11].Value.(bool), NegativePromptLocked: args[12].Value.(bool)}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_projects"):
		shuihuoStoreTestState.nextProjectID++
		id := shuihuoStoreTestState.nextProjectID
		now := time.Now().UTC()
		shuihuoStoreTestState.projects[id] = domain.Project{
			ID:                  id,
			UserID:              args[0].Value.(int64),
			Name:                args[1].Value.(string),
			SourceText:          args[2].Value.(string),
			SourceObjectKey:     args[3].Value.(string),
			SegmentationStatus:  args[4].Value.(string),
			SegmentationVersion: int(args[5].Value.(int64)),
			CreatedAt:           now,
			UpdatedAt:           now,
		}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_projects WHERE id = ? AND user_id = ?"):
		id, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[id]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		delete(shuihuoStoreTestState.projects, id)
		return shuihuoStoreResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segments"):
		shuihuoStoreTestState.nextSegmentID++
		id := shuihuoStoreTestState.nextSegmentID
		projectID, ownerID := args[11].Value.(int64), args[12].Value.(int64)
		project, ok := shuihuoStoreTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		shuihuoStoreTestState.segments[id] = domain.Segment{ID: id, ProjectID: projectID, SourceText: args[0].Value.(string), SubtitleText: args[1].Value.(string), OrderIndex: int(args[2].Value.(int64))}
		return shuihuoStoreResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments s JOIN shuihuo_projects p") && strings.Contains(query, "SET s.image_prompt"):
		id, ownerID := args[6].Value.(int64), args[7].Value.(int64)
		segment, ok := shuihuoStoreTestState.segments[id]
		project, projectOK := shuihuoStoreTestState.projects[segment.ProjectID]
		if !ok || !projectOK || project.UserID != ownerID {
			return shuihuoStoreResult{}, nil
		}
		segment.ImagePrompt = args[0].Value.(string)
		segment.VideoPrompt = args[1].Value.(string)
		segment.NegativePrompt = args[2].Value.(string)
		segment.ImagePromptLocked = args[3].Value.(bool)
		segment.VideoPromptLocked = args[4].Value.(bool)
		segment.NegativePromptLocked = args[5].Value.(bool)
		shuihuoStoreTestState.segments[id] = segment
		return shuihuoStoreResult{rows: 1}, nil
	default:
		return nil, fmt.Errorf("unexpected exec query: %s", query)
	}
}

func (shuihuoStoreTestConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	query = compactSQL(query)
	switch {
	case strings.HasPrefix(query, "SELECT id, source_object_key, segmentation_version FROM shuihuo_projects"):
		project, ok := shuihuoStoreTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{}, nil
		}
		shuihuoStoreTestState.projectLockCount++
		return &shuihuoStoreRows{columns: []string{"id", "source_object_key", "segmentation_version"}, values: [][]driver.Value{{project.ID, project.SourceObjectKey, int64(project.SegmentationVersion)}}}, nil
	case strings.Contains(query, "FROM shuihuo_tasks") && strings.Contains(query, "status IN ('queued', 'running')"):
		projectID := args[0].Value.(int64)
		return &shuihuoStoreRows{columns: []string{"exists"}, values: [][]driver.Value{{shuihuoStoreTestState.activeTasks[projectID]}}}, nil
	case strings.Contains(query, "FROM shuihuo_projects p JOIN shuihuo_segments s"):
		segment, ok := shuihuoStoreTestState.segments[args[0].Value.(int64)]
		project := shuihuoStoreTestState.projects[segment.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{columns: []string{"id"}}, nil
		}
		shuihuoStoreTestState.projectLockCount++
		return &shuihuoStoreRows{columns: []string{"id"}, values: [][]driver.Value{{project.ID}}}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_projects WHERE id = ? AND user_id = ?"):
		project, ok := shuihuoStoreTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{}, nil
		}
		if strings.HasSuffix(query, "FOR UPDATE") {
			shuihuoStoreTestState.projectLockCount++
		}
		return &shuihuoStoreRows{columns: []string{"id"}, values: [][]driver.Value{{project.ID}}}, nil
	case strings.HasPrefix(query, "SELECT segmentation_version FROM shuihuo_projects WHERE id = ?"):
		project, ok := shuihuoStoreTestState.projects[args[0].Value.(int64)]
		if !ok {
			return &shuihuoStoreRows{columns: []string{"segmentation_version"}}, nil
		}
		return &shuihuoStoreRows{columns: []string{"segmentation_version"}, values: [][]driver.Value{{int64(project.SegmentationVersion)}}}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_assets WHERE project_id = ? AND id IN"):
		projectID := args[0].Value.(int64)
		rows := make([][]driver.Value, 0, len(args)-1)
		for _, arg := range args[1:] {
			asset, ok := shuihuoStoreTestState.assets[arg.Value.(int64)]
			if ok && asset.ProjectID == projectID {
				rows = append(rows, []driver.Value{asset.ID})
			}
		}
		return &shuihuoStoreRows{columns: []string{"id"}, values: rows}, nil
	case strings.HasPrefix(query, "SELECT COUNT(*) FROM shuihuo_segment_source_units"):
		return &shuihuoStoreRows{columns: []string{"count"}, values: [][]driver.Value{{int64(len(shuihuoStoreTestState.mappings[args[0].Value.(int64)]))}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments WHERE id = ? AND project_id = ?"):
		segment, ok := shuihuoStoreTestState.segments[args[0].Value.(int64)]
		if !ok || segment.ProjectID != args[1].Value.(int64) {
			return &shuihuoStoreRows{columns: segmentColumns}, nil
		}
		return &shuihuoStoreRows{columns: segmentColumns, values: [][]driver.Value{{segment.ID, segment.ProjectID, segment.SourceText, segment.SubtitleText, segment.Speaker, int64(segment.OrderIndex), segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked}}}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_segments WHERE project_id = ?"):
		projectID := args[0].Value.(int64)
		rows := make([][]driver.Value, 0)
		for _, segment := range shuihuoStoreTestState.segments {
			if segment.ProjectID == projectID {
				rows = append(rows, []driver.Value{segment.ID})
			}
		}
		return &shuihuoStoreRows{columns: []string{"id"}, values: rows}, nil
	case strings.Contains(query, "MAX(source_order)") && strings.Contains(query, "FROM shuihuo_source_units"):
		projectID := args[0].Value.(int64)
		var maximum int64
		for _, unit := range shuihuoStoreTestState.units {
			if unit.ProjectID == projectID && int64(unit.SourceOrder) > maximum {
				maximum = int64(unit.SourceOrder)
			}
		}
		return &shuihuoStoreRows{columns: []string{"source_order"}, values: [][]driver.Value{{maximum + 1}}}, nil
	case strings.Contains(query, "FROM shuihuo_projects WHERE id = ? AND user_id = ?"):
		project, ok := shuihuoStoreTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{}, nil
		}
		return &shuihuoStoreRows{columns: projectColumns, values: [][]driver.Value{{project.ID, project.UserID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, int64(project.SegmentationVersion), project.CreatedAt, project.UpdatedAt}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p"):
		segment, ok := shuihuoStoreTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &shuihuoStoreRows{columns: segmentColumns}, nil
		}
		project, ok := shuihuoStoreTestState.projects[segment.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &shuihuoStoreRows{columns: segmentColumns}, nil
		}
		return &shuihuoStoreRows{columns: segmentColumns, values: [][]driver.Value{{segment.ID, segment.ProjectID, segment.SourceText, segment.SubtitleText, segment.Speaker, int64(segment.OrderIndex), segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked}}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

func compactSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type shuihuoStoreResult struct{ id, rows int64 }

func (r shuihuoStoreResult) LastInsertId() (int64, error) { return r.id, nil }
func (r shuihuoStoreResult) RowsAffected() (int64, error) { return r.rows, nil }

var projectColumns = []string{"id", "user_id", "name", "source_text", "source_object_key", "segmentation_status", "segmentation_version", "created_at", "updated_at"}
var segmentColumns = []string{"id", "project_id", "source_text", "subtitle_text", "speaker", "order_index", "confirmed", "manually_edited", "image_prompt", "video_prompt", "negative_prompt", "image_prompt_locked", "video_prompt_locked", "negative_prompt_locked"}

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
