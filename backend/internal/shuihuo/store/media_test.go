package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"strings"
	"sync"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

const primaryMediaTestDriverName = "qiantie-primary-media-test"

var (
	registerPrimaryMediaTestDriver sync.Once
	primaryMediaTestState          *primaryMediaState
)

type primaryMediaState struct {
	items  []domain.Media
	nextID int64
}

func TestCreateGeneratedKeepsOnePrimaryImagePerSegment(t *testing.T) {
	repo := newPrimaryMediaRepository(t)
	firstSegmentID, otherSegmentID := int64(7), int64(8)
	if _, err := repo.CreateGenerated(context.Background(), domain.Media{ProjectID: 3, SegmentID: &firstSegmentID, Kind: "image", ObjectKey: "first.png", IsPrimary: true}); err != nil {
		t.Fatalf("first image: %v", err)
	}
	if _, err := repo.CreateGenerated(context.Background(), domain.Media{ProjectID: 3, SegmentID: &otherSegmentID, Kind: "image", ObjectKey: "other.png", IsPrimary: true}); err != nil {
		t.Fatalf("other segment image: %v", err)
	}
	if _, err := repo.CreateGenerated(context.Background(), domain.Media{ProjectID: 3, SegmentID: &firstSegmentID, Kind: "image", ObjectKey: "second.png", IsPrimary: true}); err != nil {
		t.Fatalf("second image: %v", err)
	}

	var firstSegmentImages, firstSegmentPrimaries, otherSegmentPrimaries int
	for _, item := range primaryMediaTestState.items {
		if item.SegmentID != nil && *item.SegmentID == firstSegmentID {
			firstSegmentImages++
			if item.IsPrimary {
				firstSegmentPrimaries++
				if item.ObjectKey != "second.png" {
					t.Fatalf("primary image = %q, want latest generated candidate", item.ObjectKey)
				}
			}
		}
		if item.SegmentID != nil && *item.SegmentID == otherSegmentID && item.IsPrimary {
			otherSegmentPrimaries++
		}
	}
	if firstSegmentImages != 2 || firstSegmentPrimaries != 1 {
		t.Fatalf("segment images=%d primaries=%d, want 2 candidates and one primary", firstSegmentImages, firstSegmentPrimaries)
	}
	if otherSegmentPrimaries != 1 {
		t.Fatalf("other segment primary count=%d, want 1", otherSegmentPrimaries)
	}
}

func TestAttachSegmentMovesPrimaryImageWithoutLeavingTwoPrimaries(t *testing.T) {
	repo := newPrimaryMediaRepository(t)
	sourceSegmentID, targetSegmentID := int64(6), int64(7)
	primaryMediaTestState.items = []domain.Media{
		{ID: 1, ProjectID: 3, SegmentID: &sourceSegmentID, Kind: "image", ObjectKey: "moved.png", IsPrimary: true},
		{ID: 2, ProjectID: 3, SegmentID: &targetSegmentID, Kind: "image", ObjectKey: "target.png", IsPrimary: true},
		{ID: 3, ProjectID: 3, SegmentID: &targetSegmentID, Kind: "video", ObjectKey: "clip.mp4", IsPrimary: true},
	}

	moved, err := repo.AttachSegment(context.Background(), 11, 1, targetSegmentID)
	if err != nil {
		t.Fatalf("AttachSegment() error = %v", err)
	}
	if moved.SegmentID == nil || *moved.SegmentID != targetSegmentID || !moved.IsPrimary {
		t.Fatalf("moved media = %#v, want primary image on target segment", moved)
	}

	var imageCount, primaryCount int
	for _, item := range primaryMediaTestState.items {
		if item.SegmentID != nil && *item.SegmentID == targetSegmentID && item.Kind == "image" {
			imageCount++
			if item.IsPrimary {
				primaryCount++
				if item.ID != 1 {
					t.Fatalf("target primary ID = %d, want moved image", item.ID)
				}
			}
		}
		if item.ID == 3 && !item.IsPrimary {
			t.Fatal("moving an image changed the target segment video primary flag")
		}
	}
	if imageCount != 2 || primaryCount != 1 {
		t.Fatalf("target images=%d primaries=%d, want two candidates and one primary", imageCount, primaryCount)
	}
}

func newPrimaryMediaRepository(t *testing.T) *Media {
	t.Helper()
	registerPrimaryMediaTestDriver.Do(func() { sql.Register(primaryMediaTestDriverName, primaryMediaDriver{}) })
	primaryMediaTestState = &primaryMediaState{}
	db, err := sql.Open(primaryMediaTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewMedia(db)
}

type primaryMediaDriver struct{}

func (primaryMediaDriver) Open(string) (driver.Conn, error) { return primaryMediaConn{}, nil }

type primaryMediaConn struct{}

func (primaryMediaConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (primaryMediaConn) Close() error                        { return nil }
func (primaryMediaConn) Begin() (driver.Tx, error)           { return primaryMediaTx{}, nil }
func (primaryMediaConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return primaryMediaTx{}, nil
}
func (primaryMediaConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return primaryMediaExec(query, args)
}
func (primaryMediaConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	query = compactSQL(query)
	if strings.Contains(query, "FROM shuihuo_media m JOIN shuihuo_projects p") {
		mediaID := args[0].Value.(int64)
		for _, item := range primaryMediaTestState.items {
			if item.ID == mediaID {
				return &primaryMediaRows{columns: []string{"id", "project_id", "segment_id", "task_id", "kind", "object_key", "source", "manually_edited", "width", "height", "duration_ms", "is_primary"}, values: [][]driver.Value{{item.ID, item.ProjectID, optionalInt64Value(item.SegmentID), optionalInt64Value(item.TaskID), item.Kind, item.ObjectKey, item.Source, item.ManuallyEdited, optionalIntValue(item.Width), optionalIntValue(item.Height), optionalInt64Value(item.DurationMS), item.IsPrimary}}}, nil
			}
		}
		return &primaryMediaRows{}, nil
	}
	if strings.HasPrefix(query, "SELECT EXISTS(SELECT 1 FROM shuihuo_segments") {
		return &primaryMediaRows{columns: []string{"exists"}, values: [][]driver.Value{{true}}}, nil
	}
	if strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p") {
		return &primaryMediaRows{columns: []string{"id"}, values: [][]driver.Value{{args[0].Value}}}, nil
	}
	if strings.Contains(query, "FROM shuihuo_segments WHERE id = ? AND project_id = ?") {
		return &primaryMediaRows{columns: []string{"id"}, values: [][]driver.Value{{args[0].Value}}}, nil
	}
	return nil, driver.ErrSkip
}

type primaryMediaTx struct{}

func (primaryMediaTx) Commit() error   { return nil }
func (primaryMediaTx) Rollback() error { return nil }
func (primaryMediaTx) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return primaryMediaExec(query, args)
}
func (primaryMediaTx) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return primaryMediaConn{}.QueryContext(ctx, query, args)
}

func primaryMediaExec(query string, args []driver.NamedValue) (driver.Result, error) {
	query = compactSQL(query)
	switch {
	case strings.HasPrefix(query, "UPDATE shuihuo_media SET is_primary = FALSE"):
		projectID, segmentID := args[0].Value.(int64), args[1].Value.(int64)
		for index := range primaryMediaTestState.items {
			item := &primaryMediaTestState.items[index]
			if item.ProjectID == projectID && item.SegmentID != nil && *item.SegmentID == segmentID && item.Kind == "image" {
				item.IsPrimary = false
			}
		}
		return primaryMediaResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_media"):
		primaryMediaTestState.nextID++
		item := domain.Media{ID: primaryMediaTestState.nextID, ProjectID: args[0].Value.(int64), SegmentID: int64Pointer(args[1].Value), Kind: args[3].Value.(string), ObjectKey: args[4].Value.(string), IsPrimary: args[10].Value.(bool)}
		primaryMediaTestState.items = append(primaryMediaTestState.items, item)
		return primaryMediaResult{id: item.ID, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_media m JOIN shuihuo_projects p"):
		mediaID := args[len(args)-2].Value.(int64)
		for index := range primaryMediaTestState.items {
			item := &primaryMediaTestState.items[index]
			if item.ID == mediaID {
				item.SegmentID = int64Pointer(args[0].Value)
				if strings.Contains(query, "m.is_primary = CASE") {
					item.IsPrimary = args[1].Value.(bool)
				} else if len(args) > 10 {
					item.IsPrimary = args[9].Value.(bool)
				}
				return primaryMediaResult{rows: 1}, nil
			}
		}
		return primaryMediaResult{}, nil
	default:
		return nil, driver.ErrSkip
	}
}

func int64Pointer(value any) *int64 {
	if value == nil {
		return nil
	}
	item := value.(int64)
	return &item
}

func optionalInt64Value(value *int64) driver.Value {
	if value == nil {
		return nil
	}
	return *value
}

func optionalIntValue(value *int) driver.Value {
	if value == nil {
		return nil
	}
	return int64(*value)
}

type primaryMediaResult struct{ id, rows int64 }

func (r primaryMediaResult) LastInsertId() (int64, error) { return r.id, nil }
func (r primaryMediaResult) RowsAffected() (int64, error) { return r.rows, nil }

type primaryMediaRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *primaryMediaRows) Columns() []string { return r.columns }
func (r *primaryMediaRows) Close() error      { return nil }
func (r *primaryMediaRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}
