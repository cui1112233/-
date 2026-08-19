package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
)

func TestMergeAndSplitKeepsSourceUnitOrder(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	first, second := state.seedMappedSegments(11, 101, []string{"第一句"}, []string{"第二句"})

	merged, err := repo.MergeIntoPrevious(context.Background(), 11, second.ID)
	if err != nil {
		t.Fatalf("MergeIntoPrevious() error = %v", err)
	}
	if merged.ID != first.ID || merged.SourceText != "第一句\n第二句" {
		t.Fatalf("merged = %#v", merged)
	}

	mappings, err := repo.ListMappingsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("ListMappingsByProject() error = %v", err)
	}
	if got, want := mappings[first.ID], []int64{1, 2}; !sameInt64s(got, want) {
		t.Fatalf("mappings = %#v, want %v", mappings, want)
	}

	restored, err := repo.Split(context.Background(), 11, first.ID)
	if err != nil {
		t.Fatalf("Split() error = %v", err)
	}
	if got, want := sourceUnitSegmentTexts(restored), []string{"第一句", "第二句"}; !sameStrings(got, want) {
		t.Fatalf("restored = %v, want %v", got, want)
	}
}

func TestSourceUnitOperationsRejectFirstSingleAndForeignStoryboards(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	first, second := state.seedMappedSegments(11, 101, []string{"第一句"}, []string{"第二句"})
	if _, err := repo.MergeIntoPrevious(context.Background(), 11, first.ID); !errors.Is(err, ErrCannotMergeFirstStoryboard) {
		t.Fatalf("first MergeIntoPrevious() error = %v", err)
	}
	if _, err := repo.Split(context.Background(), 11, second.ID); !errors.Is(err, ErrCannotSplitSingleSource) {
		t.Fatalf("single Split() error = %v", err)
	}
	if _, err := repo.MergeIntoPrevious(context.Background(), 12, second.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign MergeIntoPrevious() error = %v", err)
	}
}

func TestStoryboardMutationsRejectActiveTasksAfterProjectLock(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	_, second := state.seedMappedSegments(11, 101, []string{"第一句"}, []string{"第二句"})
	state.activeTasks[101] = true

	if _, err := repo.MergeIntoPrevious(context.Background(), 11, second.ID); !errors.Is(err, ErrStoryboardMutationHasActiveTasks) {
		t.Fatalf("MergeIntoPrevious() error = %v", err)
	}
	if state.storyboardProjectLocks != 1 {
		t.Fatalf("storyboard project locks = %d, want 1", state.storyboardProjectLocks)
	}
}

func TestStoryboardMutationsLockOwnedProjectBeforeReadingStoryboard(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	first, second := state.seedMappedSegments(11, 101, []string{"第一句"}, []string{"第二句"})
	if _, err := repo.MergeIntoPrevious(context.Background(), 11, second.ID); err != nil {
		t.Fatalf("MergeIntoPrevious() error = %v", err)
	}
	if _, err := repo.Split(context.Background(), 11, first.ID); err != nil {
		t.Fatalf("Split() error = %v", err)
	}
	if _, err := repo.InsertAfter(context.Background(), 11, first.ID, "手动段", "手动段"); err != nil {
		t.Fatalf("InsertAfter() error = %v", err)
	}
	if state.storyboardProjectLocks != 3 {
		t.Fatalf("storyboard project locks = %d, want 3", state.storyboardProjectLocks)
	}
}

func TestReplaceConfirmedFromCandidatesCreatesImmutableSourceUnits(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	state.seedProject(11, 101)
	candidates := []domain.Segment{{SourceText: "第一句"}, {SourceText: "第二句"}}
	if err := repo.ReplaceConfirmedFromCandidates(context.Background(), 11, 101, candidates); err != nil {
		t.Fatalf("ReplaceConfirmedFromCandidates() error = %v", err)
	}
	units, err := repo.ListUnitsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("ListUnitsByProject() error = %v", err)
	}
	if got, want := []string{units[0].Text, units[1].Text}, []string{"第一句", "第二句"}; !sameStrings(got, want) {
		t.Fatalf("units = %#v", units)
	}
	mappings, err := repo.ListMappingsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("ListMappingsByProject() error = %v", err)
	}
	if len(mappings) != 2 {
		t.Fatalf("mappings = %#v, want one mapping per candidate", mappings)
	}
}

func TestReconfirmPreservesHistoricalSourceUnitsAndActivatesNewVersion(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	state.seedProject(11, 101)
	if err := repo.ReplaceConfirmedFromCandidates(context.Background(), 11, 101, []domain.Segment{{SourceText: "旧第一句"}, {SourceText: "旧第二句"}, {SourceText: "旧第三句"}}); err != nil {
		t.Fatalf("first ReplaceConfirmedFromCandidates() error = %v", err)
	}
	firstUnits, err := repo.ListUnitsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("first ListUnitsByProject() error = %v", err)
	}
	firstIDs := []int64{firstUnits[0].ID, firstUnits[1].ID, firstUnits[2].ID}
	firstStoryboards := state.segmentsByProject(101)
	if _, err := repo.MergeIntoPrevious(context.Background(), 11, firstStoryboards[1].ID); err != nil {
		t.Fatalf("MergeIntoPrevious() on first version error = %v", err)
	}

	if err := repo.ReplaceConfirmedFromCandidates(context.Background(), 11, 101, []domain.Segment{{SourceText: "新第一句"}, {SourceText: "新第二句"}}); err != nil {
		t.Fatalf("second ReplaceConfirmedFromCandidates() error = %v", err)
	}
	for _, id := range firstIDs {
		if _, found := state.units[id]; !found {
			t.Fatalf("first source unit %d was deleted during resegmentation", id)
		}
	}
	historical, err := repo.ListHistoricalMappingsByProject(context.Background(), 11, 101, 1)
	if err != nil {
		t.Fatalf("ListHistoricalMappingsByProject() error = %v", err)
	}
	if got, want := flattenedSourceUnitIDs(historical), firstIDs; !sameInt64s(got, want) {
		t.Fatalf("historical source unit IDs = %v, want %v", got, want)
	}
	historicalStoryboards, err := repo.ListHistoricalStoryboardsByProject(context.Background(), 11, 101, 1)
	if err != nil {
		t.Fatalf("ListHistoricalStoryboardsByProject() error = %v", err)
	}
	if len(historicalStoryboards) != 2 {
		t.Fatalf("historical storyboards = %#v, want two", historicalStoryboards)
	}
	if got, want := []int{historicalStoryboards[0].OrderIndex, historicalStoryboards[1].OrderIndex}, []int{1, 2}; !sameInts(got, want) {
		t.Fatalf("historical storyboard order = %v, want %v", got, want)
	}
	if got, want := historicalStoryboards[0].SourceUnits, []domain.HistoricalStoryboardSourceUnit{
		{ID: firstIDs[0], Text: "旧第一句", PositionIndex: 1},
		{ID: firstIDs[1], Text: "旧第二句", PositionIndex: 2},
	}; !sameHistoricalSourceUnits(got, want) {
		t.Fatalf("first historical storyboard source units = %#v, want %#v", got, want)
	}
	if got, want := historicalStoryboards[1].SourceUnits, []domain.HistoricalStoryboardSourceUnit{{ID: firstIDs[2], Text: "旧第三句", PositionIndex: 1}}; !sameHistoricalSourceUnits(got, want) {
		t.Fatalf("second historical storyboard source units = %#v, want %#v", got, want)
	}

	activeUnits, err := repo.ListUnitsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("active ListUnitsByProject() error = %v", err)
	}
	if got, want := []string{activeUnits[0].Text, activeUnits[1].Text}, []string{"新第一句", "新第二句"}; !sameStrings(got, want) {
		t.Fatalf("active source units = %v, want %v", got, want)
	}
	if got, want := []int{activeUnits[0].SegmentationVersion, activeUnits[1].SegmentationVersion}, []int{2, 2}; !sameInts(got, want) {
		t.Fatalf("active source unit versions = %v, want %v", got, want)
	}
	if activeUnits[0].ID == firstIDs[0] || activeUnits[1].ID == firstIDs[1] {
		t.Fatalf("active source units reused historical IDs: %#v", activeUnits)
	}

	current := state.segmentsByProject(101)
	if len(current) != 2 {
		t.Fatalf("current segments = %#v, want two", current)
	}
	merged, err := repo.MergeIntoPrevious(context.Background(), 11, current[1].ID)
	if err != nil {
		t.Fatalf("MergeIntoPrevious() on active version error = %v", err)
	}
	restored, err := repo.Split(context.Background(), 11, merged.ID)
	if err != nil {
		t.Fatalf("Split() on active version error = %v", err)
	}
	if got, want := sourceUnitSegmentTexts(restored), []string{"新第一句", "新第二句"}; !sameStrings(got, want) {
		t.Fatalf("restored active version = %v, want %v", got, want)
	}
}

func TestProjectReadModelKeepsActiveMappingsWithinOneSegmentationVersion(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	state.seedProject(11, 101)
	if err := repo.ReplaceConfirmedFromCandidates(context.Background(), 11, 101, []domain.Segment{{SourceText: "旧第一句"}, {SourceText: "旧第二句"}}); err != nil {
		t.Fatalf("first ReplaceConfirmedFromCandidates() error = %v", err)
	}
	if err := repo.ReplaceConfirmedFromCandidates(context.Background(), 11, 101, []domain.Segment{{SourceText: "新第一句"}, {SourceText: "新第二句"}, {SourceText: "新第三句"}}); err != nil {
		t.Fatalf("second ReplaceConfirmedFromCandidates() error = %v", err)
	}

	readModel, err := repo.ReadProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("ReadProject() error = %v", err)
	}
	if state.readSnapshots != 1 {
		t.Fatalf("ReadProject() read snapshots = %d, want 1", state.readSnapshots)
	}
	if readModel.Project.SegmentationVersion != 2 {
		t.Fatalf("read model version = %d, want 2", readModel.Project.SegmentationVersion)
	}
	segmentIDs := make(map[int64]struct{}, len(readModel.Segments))
	for _, segment := range readModel.Segments {
		segmentIDs[segment.ID] = struct{}{}
	}
	unitIDs := make(map[int64]struct{}, len(readModel.SourceUnits))
	for _, unit := range readModel.SourceUnits {
		if unit.SegmentationVersion != readModel.Project.SegmentationVersion {
			t.Fatalf("source unit %#v is outside active version %d", unit, readModel.Project.SegmentationVersion)
		}
		unitIDs[unit.ID] = struct{}{}
	}
	for segmentID, sourceIDs := range readModel.SegmentSourceUnitIDs {
		if _, ok := segmentIDs[segmentID]; !ok {
			t.Fatalf("mapping references inactive segment %d", segmentID)
		}
		for _, sourceID := range sourceIDs {
			if _, ok := unitIDs[sourceID]; !ok {
				t.Fatalf("mapping references inactive source unit %d", sourceID)
			}
		}
	}
}

func TestInsertAfterShiftsSourceUnitOrdersWithoutDuplicates(t *testing.T) {
	repo, state := newSourceUnitsTestRepository(t)
	first, _ := state.seedMappedSegments(11, 101, []string{"第一句"}, []string{"第三句"})

	inserted, err := repo.InsertAfter(context.Background(), 11, first.ID, "第二句", "第二句")
	if err != nil {
		t.Fatalf("InsertAfter() error = %v", err)
	}
	if inserted.SourceText != "第二句" {
		t.Fatalf("inserted = %#v", inserted)
	}
	units, err := repo.ListUnitsByProject(context.Background(), 11, 101)
	if err != nil {
		t.Fatalf("ListUnitsByProject() error = %v", err)
	}
	if got, want := []string{units[0].Text, units[1].Text, units[2].Text}, []string{"第一句", "第二句", "第三句"}; !sameStrings(got, want) {
		t.Fatalf("source unit order = %v, want %v", got, want)
	}
	seen := make(map[int]bool, len(units))
	for _, unit := range units {
		if seen[unit.SourceOrder] {
			t.Fatalf("duplicate source order %d in %#v", unit.SourceOrder, units)
		}
		seen[unit.SourceOrder] = true
	}
}

func sameInt64s(got, want []int64) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func sameInts(got, want []int) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func sameHistoricalSourceUnits(got, want []domain.HistoricalStoryboardSourceUnit) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}

func sourceUnitSegmentTexts(segments []domain.Segment) []string {
	texts := make([]string, 0, len(segments))
	for _, segment := range segments {
		texts = append(texts, segment.SourceText)
	}
	return texts
}

func flattenedSourceUnitIDs(mappings map[int64][]int64) []int64 {
	ids := make([]int64, 0)
	for _, sourceUnitIDs := range mappings {
		ids = append(ids, sourceUnitIDs...)
	}
	sort.Slice(ids, func(left, right int) bool { return ids[left] < ids[right] })
	return ids
}

func newSourceUnitsTestRepository(t *testing.T) (*SourceUnits, *sourceUnitTestState) {
	t.Helper()
	state := &sourceUnitTestState{
		projects:           map[int64]domain.Project{},
		segments:           map[int64]domain.Segment{},
		units:              map[int64]domain.SourceUnit{},
		mappings:           map[int64][]sourceUnitTestMapping{},
		historicalMappings: map[int][]sourceUnitTestHistoryMapping{},
		activeTasks:        map[int64]bool{},
	}
	return newSourceUnitsWithDB(&sourceUnitTestDB{state: state}), state
}

type sourceUnitTestState struct {
	projects               map[int64]domain.Project
	segments               map[int64]domain.Segment
	units                  map[int64]domain.SourceUnit
	mappings               map[int64][]sourceUnitTestMapping
	historicalMappings     map[int][]sourceUnitTestHistoryMapping
	activeTasks            map[int64]bool
	nextSegmentID          int64
	nextUnitID             int64
	storyboardProjectLocks int
	readSnapshots          int
}

func (s *sourceUnitTestState) segmentsByProject(projectID int64) []domain.Segment {
	segments := make([]domain.Segment, 0)
	for _, segment := range s.segments {
		if segment.ProjectID == projectID {
			segments = append(segments, segment)
		}
	}
	sort.Slice(segments, func(left, right int) bool {
		return segments[left].OrderIndex < segments[right].OrderIndex
	})
	return segments
}

type sourceUnitTestMapping struct {
	unitID int64
	pos    int
}

type sourceUnitTestHistoryMapping struct {
	segmentID    int64
	segmentOrder int
	unitID       int64
	pos          int
}

func (s *sourceUnitTestState) seedProject(ownerID, projectID int64) {
	s.projects[projectID] = domain.Project{ID: projectID, UserID: ownerID, Name: "测试项目"}
}

func (s *sourceUnitTestState) seedMappedSegments(ownerID, projectID int64, texts ...[]string) (domain.Segment, domain.Segment) {
	s.seedProject(ownerID, projectID)
	var result []domain.Segment
	for order, group := range texts {
		s.nextSegmentID++
		segment := domain.Segment{ID: s.nextSegmentID, ProjectID: projectID, SourceText: strings.Join(group, "\n"), OrderIndex: order + 1, Confirmed: true}
		s.segments[segment.ID] = segment
		for position, text := range group {
			s.nextUnitID++
			unit := domain.SourceUnit{ID: s.nextUnitID, ProjectID: projectID, Text: text, SourceKind: "confirmed_candidate", SegmentationVersion: s.projects[projectID].SegmentationVersion, SourceOrder: int(s.nextUnitID), CreatedAt: time.Now().UTC()}
			s.units[unit.ID] = unit
			s.mappings[segment.ID] = append(s.mappings[segment.ID], sourceUnitTestMapping{unitID: unit.ID, pos: position + 1})
		}
		result = append(result, segment)
	}
	return result[0], result[1]
}

type sourceUnitTestDB struct{ state *sourceUnitTestState }

func (d *sourceUnitTestDB) BeginTx(_ context.Context, options *sql.TxOptions) (sourceUnitTx, error) {
	if options != nil && options.ReadOnly && options.Isolation == sql.LevelRepeatableRead {
		d.state.readSnapshots++
	}
	return &sourceUnitTestTx{sourceUnitTestDB: d}, nil
}
func (d *sourceUnitTestDB) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	return d.exec(query, args...)
}
func (d *sourceUnitTestDB) QueryContext(_ context.Context, query string, args ...any) (sourceUnitRows, error) {
	return d.query(query, args...)
}
func (d *sourceUnitTestDB) QueryRowContext(ctx context.Context, query string, args ...any) sourceUnitRow {
	rows, err := d.query(query, args...)
	return sourceUnitTestRow{rows: rows, err: err}
}

type sourceUnitTestTx struct{ *sourceUnitTestDB }

func (t *sourceUnitTestTx) Commit() error   { return nil }
func (t *sourceUnitTestTx) Rollback() error { return nil }

func (d *sourceUnitTestDB) exec(query string, args ...any) (sql.Result, error) {
	query = compactSourceUnitSQL(query)
	switch {
	case strings.HasPrefix(query, "INSERT INTO shuihuo_source_units"):
		d.state.nextUnitID++
		id := d.state.nextUnitID
		d.state.units[id] = domain.SourceUnit{ID: id, ProjectID: asInt64(args[0]), Text: args[1].(string), SourceKind: args[2].(string), SegmentationVersion: int(asInt64(args[3])), SourceOrder: int(asInt64(args[4])), CreatedAt: time.Now().UTC()}
		return sourceUnitTestResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segments"):
		d.state.nextSegmentID++
		id := d.state.nextSegmentID
		d.state.segments[id] = domain.Segment{ID: id, ProjectID: asInt64(args[0]), SourceText: args[1].(string), SubtitleText: args[2].(string), Speaker: args[3].(string), OrderIndex: int(asInt64(args[4])), Confirmed: args[5].(bool), ManuallyEdited: args[6].(bool), ImagePrompt: args[7].(string), VideoPrompt: args[8].(string), NegativePrompt: args[9].(string), ImagePromptLocked: args[10].(bool), VideoPromptLocked: args[11].(bool), NegativePromptLocked: args[12].(bool)}
		return sourceUnitTestResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segment_source_units"):
		segmentID, unitID := asInt64(args[0]), asInt64(args[1])
		d.state.mappings[segmentID] = append(d.state.mappings[segmentID], sourceUnitTestMapping{unitID: unitID, pos: 1})
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT IGNORE INTO shuihuo_segment_source_unit_history"):
		projectID, version := asInt64(args[1]), int(asInt64(args[0]))
		for segmentID, mappings := range d.state.mappings {
			segment, ok := d.state.segments[segmentID]
			if !ok || segment.ProjectID != projectID {
				continue
			}
			for _, mapping := range mappings {
				d.state.historicalMappings[version] = append(d.state.historicalMappings[version], sourceUnitTestHistoryMapping{segmentID: segmentID, segmentOrder: segment.OrderIndex, unitID: mapping.unitID, pos: mapping.pos})
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE project_id"):
		projectID := asInt64(args[0])
		for id, segment := range d.state.segments {
			if segment.ProjectID == projectID {
				delete(d.state.segments, id)
				delete(d.state.mappings, id)
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_source_units WHERE project_id"):
		projectID := asInt64(args[0])
		for id, unit := range d.state.units {
			if unit.ProjectID == projectID {
				delete(d.state.units, id)
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_projects SET segmentation_status"):
		project := d.state.projects[asInt64(args[0])]
		project.SegmentationStatus, project.SegmentationVersion = "confirmed", project.SegmentationVersion+1
		d.state.projects[project.ID] = project
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET position_index = -position_index"):
		for index := range d.state.mappings[asInt64(args[0])] {
			d.state.mappings[asInt64(args[0])][index].pos *= -1
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = -position_index + ?"):
		previousID, previousCount, currentID := asInt64(args[0]), int(asInt64(args[1])), asInt64(args[2])
		for _, mapping := range d.state.mappings[currentID] {
			mapping.pos = -mapping.pos + previousCount
			d.state.mappings[previousID] = append(d.state.mappings[previousID], mapping)
		}
		delete(d.state.mappings, currentID)
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET source_text"):
		segment := d.state.segments[asInt64(args[1])]
		segment.SourceText = args[0].(string)
		d.state.segments[segment.ID] = segment
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE id"):
		delete(d.state.segments, asInt64(args[0]))
		delete(d.state.mappings, asInt64(args[0]))
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET position_index = 1"):
		segmentID, unitID := asInt64(args[0]), asInt64(args[1])
		for index := range d.state.mappings[segmentID] {
			if d.state.mappings[segmentID][index].unitID == unitID {
				d.state.mappings[segmentID][index].pos = 1
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = 1"):
		newID, oldID, unitID := asInt64(args[0]), asInt64(args[1]), asInt64(args[2])
		for index, mapping := range d.state.mappings[oldID] {
			if mapping.unitID == unitID {
				d.state.mappings[oldID] = append(d.state.mappings[oldID][:index], d.state.mappings[oldID][index+1:]...)
				d.state.mappings[newID] = append(d.state.mappings[newID], sourceUnitTestMapping{unitID: unitID, pos: 1})
				break
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_source_units SET source_order = source_order + 1"):
		projectID, version, after := asInt64(args[0]), int(asInt64(args[1])), int(asInt64(args[2]))
		for id, unit := range d.state.units {
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder > after {
				unit.SourceOrder++
				d.state.units[id] = unit
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_source_units SET source_order = -source_order WHERE"):
		projectID, version, after := asInt64(args[0]), int(asInt64(args[1])), int(asInt64(args[2]))
		for id, unit := range d.state.units {
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder > after {
				unit.SourceOrder = -unit.SourceOrder
				d.state.units[id] = unit
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_source_units SET source_order = -source_order + 1 WHERE"):
		projectID, version := asInt64(args[0]), int(asInt64(args[1]))
		for id, unit := range d.state.units {
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder < 0 {
				unit.SourceOrder = -unit.SourceOrder + 1
				d.state.units[id] = unit
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET order_index = order_index +"):
		offset, projectID, after := int(asInt64(args[0])), asInt64(args[1]), int(asInt64(args[2]))
		for id, segment := range d.state.segments {
			if segment.ProjectID == projectID && segment.OrderIndex > after {
				segment.OrderIndex += offset
				d.state.segments[id] = segment
			}
		}
		return sourceUnitTestResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET order_index = ? WHERE id"):
		segment := d.state.segments[asInt64(args[1])]
		segment.OrderIndex = int(asInt64(args[0]))
		d.state.segments[segment.ID] = segment
		return sourceUnitTestResult{rows: 1}, nil
	default:
		return nil, fmt.Errorf("unexpected source-unit exec: %s", query)
	}
}

func (d *sourceUnitTestDB) query(query string, args ...any) (sourceUnitRows, error) {
	query = compactSourceUnitSQL(query)
	rows := &sourceUnitTestRows{}
	switch {
	case strings.Contains(query, "FROM shuihuo_tasks") && strings.Contains(query, "status IN ('queued', 'running')"):
		rows.values = append(rows.values, []any{d.state.activeTasks[asInt64(args[0])]})
	case strings.HasPrefix(query, "SELECT segmentation_version FROM shuihuo_projects"):
		if project, ok := d.state.projects[asInt64(args[0])]; ok {
			rows.values = append(rows.values, []any{int64(project.SegmentationVersion)})
		}
	case strings.Contains(query, "FROM shuihuo_projects p JOIN shuihuo_segments s"):
		segment, ok := d.state.segments[asInt64(args[0])]
		project := d.state.projects[segment.ProjectID]
		if ok && project.UserID == asInt64(args[1]) {
			d.state.storyboardProjectLocks++
			rows.values = append(rows.values, []any{project.ID})
		}
	case strings.HasPrefix(query, "SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version FROM shuihuo_projects"):
		project, ok := d.state.projects[asInt64(args[0])]
		if ok && project.UserID == asInt64(args[1]) {
			rows.values = append(rows.values, []any{project.ID, project.UserID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, int64(project.SegmentationVersion)})
		}
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_projects"):
		project, ok := d.state.projects[asInt64(args[0])]
		if ok && project.UserID == asInt64(args[1]) {
			rows.values = append(rows.values, []any{project.ID})
		}
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p") && strings.Contains(query, "WHERE s.project_id = ?"):
		projectID, ownerID := asInt64(args[0]), asInt64(args[1])
		project, ok := d.state.projects[projectID]
		if ok && project.UserID == ownerID {
			for _, segment := range d.state.segmentsByProject(projectID) {
				rows.values = append(rows.values, sourceUnitSegmentRow(segment))
			}
		}
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p"):
		segment, ok := d.state.segments[asInt64(args[0])]
		project := d.state.projects[segment.ProjectID]
		if ok && project.UserID == asInt64(args[1]) {
			rows.values = append(rows.values, sourceUnitSegmentRow(segment))
		}
	case strings.Contains(query, "FROM shuihuo_segments WHERE project_id = ? AND order_index < ?"):
		projectID, before := asInt64(args[0]), int(asInt64(args[1]))
		var found *domain.Segment
		for _, segment := range d.state.segments {
			if segment.ProjectID == projectID && segment.OrderIndex < before && (found == nil || segment.OrderIndex > found.OrderIndex) {
				copy := segment
				found = &copy
			}
		}
		if found != nil {
			rows.values = append(rows.values, sourceUnitSegmentRow(*found))
		}
	case strings.Contains(query, "FROM shuihuo_segment_source_units m JOIN shuihuo_source_units u") && strings.Contains(query, "WHERE m.segment_id") && !strings.HasPrefix(query, "SELECT COALESCE(MAX(u.source_order)"):
		for _, mapping := range sortedSourceMappings(d.state.mappings[asInt64(args[0])]) {
			rows.values = append(rows.values, []any{mapping.unitID, d.state.units[mapping.unitID].Text})
		}
	case strings.HasPrefix(query, "SELECT COALESCE(MAX(source_order)") && strings.Contains(query, "FROM shuihuo_source_units"):
		projectID, version := asInt64(args[0]), int(asInt64(args[1]))
		max := 0
		for _, unit := range d.state.units {
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder > max {
				max = unit.SourceOrder
			}
		}
		rows.values = append(rows.values, []any{int64(max + 1)})
	case strings.HasPrefix(query, "SELECT COALESCE(MAX(u.source_order)"):
		segmentID := asInt64(args[0])
		maximum := 0
		for _, mapping := range d.state.mappings[segmentID] {
			if unit := d.state.units[mapping.unitID]; unit.SourceOrder > maximum {
				maximum = unit.SourceOrder
			}
		}
		rows.values = append(rows.values, []any{int64(maximum)})
	case strings.HasPrefix(query, "SELECT COALESCE(MAX(order_index)"):
		projectID := asInt64(args[0])
		max := 0
		for _, segment := range d.state.segments {
			if segment.ProjectID == projectID && segment.OrderIndex > max {
				max = segment.OrderIndex
			}
		}
		rows.values = append(rows.values, []any{int64(max)})
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_segments WHERE project_id"):
		projectID := asInt64(args[0])
		ids := make([]int64, 0)
		for id, segment := range d.state.segments {
			if segment.ProjectID == projectID {
				ids = append(ids, id)
			}
		}
		sort.Slice(ids, func(i, j int) bool {
			a, b := d.state.segments[ids[i]], d.state.segments[ids[j]]
			return a.OrderIndex < b.OrderIndex || (a.OrderIndex == b.OrderIndex && a.ID < b.ID)
		})
		for _, id := range ids {
			rows.values = append(rows.values, []any{id})
		}
	case strings.Contains(query, "FROM shuihuo_source_units u JOIN shuihuo_projects p"):
		projectID, ownerID := asInt64(args[0]), asInt64(args[1])
		project, ok := d.state.projects[projectID]
		if ok && project.UserID == ownerID {
			units := make([]domain.SourceUnit, 0)
			for _, unit := range d.state.units {
				if unit.ProjectID == projectID && unit.SegmentationVersion == project.SegmentationVersion {
					units = append(units, unit)
				}
			}
			sort.Slice(units, func(i, j int) bool { return units[i].SourceOrder < units[j].SourceOrder })
			for _, unit := range units {
				rows.values = append(rows.values, []any{unit.ID, unit.ProjectID, unit.Text, unit.SourceKind, int64(unit.SegmentationVersion), int64(unit.SourceOrder), unit.CreatedAt})
			}
		}
	case strings.Contains(query, "FROM shuihuo_segment_source_units m JOIN shuihuo_segments s"):
		projectID, ownerID := asInt64(args[0]), asInt64(args[1])
		project, ok := d.state.projects[projectID]
		if ok && project.UserID == ownerID {
			segments := make([]domain.Segment, 0)
			for _, segment := range d.state.segments {
				if segment.ProjectID == projectID {
					segments = append(segments, segment)
				}
			}
			sort.Slice(segments, func(i, j int) bool { return segments[i].OrderIndex < segments[j].OrderIndex })
			for _, segment := range segments {
				for _, mapping := range sortedSourceMappings(d.state.mappings[segment.ID]) {
					if d.state.units[mapping.unitID].SegmentationVersion == project.SegmentationVersion {
						rows.values = append(rows.values, []any{segment.ID, mapping.unitID})
					}
				}
			}
		}
	case strings.Contains(query, "FROM shuihuo_segment_assets sa"):
		// The source-unit test repository has no preset bindings. Returning no
		// rows verifies the read model keeps the empty mapping shape.
	case strings.Contains(query, "FROM shuihuo_assets a"):
		// The source-unit test repository has no asset fixture. Returning no rows
		// verifies the project read model preserves the existing empty-array shape.
	case strings.Contains(query, "FROM shuihuo_media m"):
		// The source-unit test repository has no media fixture.
	case strings.Contains(query, "FROM shuihuo_segment_source_unit_history h"):
		projectID, ownerID, version := asInt64(args[0]), asInt64(args[1]), int(asInt64(args[2]))
		if project, ok := d.state.projects[projectID]; ok && project.UserID == ownerID {
			mappings := append([]sourceUnitTestHistoryMapping(nil), d.state.historicalMappings[version]...)
			sort.Slice(mappings, func(i, j int) bool {
				if mappings[i].segmentOrder != mappings[j].segmentOrder {
					return mappings[i].segmentOrder < mappings[j].segmentOrder
				}
				if mappings[i].pos != mappings[j].pos {
					return mappings[i].pos < mappings[j].pos
				}
				return mappings[i].unitID < mappings[j].unitID
			})
			for _, mapping := range mappings {
				if strings.Contains(query, "u.text") {
					rows.values = append(rows.values, []any{mapping.segmentID, int64(mapping.segmentOrder), mapping.unitID, int64(mapping.pos), d.state.units[mapping.unitID].Text})
					continue
				}
				rows.values = append(rows.values, []any{mapping.segmentID, mapping.unitID})
			}
		}
	default:
		return nil, fmt.Errorf("unexpected source-unit query: %s", query)
	}
	return rows, nil
}

func sourceUnitSegmentRow(segment domain.Segment) []any {
	return []any{segment.ID, segment.ProjectID, segment.SourceText, segment.SubtitleText, segment.Speaker, int64(segment.OrderIndex), segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked}
}
func compactSourceUnitSQL(query string) string { return strings.Join(strings.Fields(query), " ") }
func asInt64(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		panic(fmt.Sprintf("not an integer: %T", value))
	}
}
func sortedSourceMappings(mappings []sourceUnitTestMapping) []sourceUnitTestMapping {
	copied := append([]sourceUnitTestMapping(nil), mappings...)
	sort.Slice(copied, func(i, j int) bool { return copied[i].pos < copied[j].pos })
	return copied
}

type sourceUnitTestResult struct{ id, rows int64 }

func (r sourceUnitTestResult) LastInsertId() (int64, error) { return r.id, nil }
func (r sourceUnitTestResult) RowsAffected() (int64, error) { return r.rows, nil }

type sourceUnitTestRow struct {
	rows sourceUnitRows
	err  error
}

func (r sourceUnitTestRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if !r.rows.Next() {
		return sql.ErrNoRows
	}
	return r.rows.Scan(dest...)
}

type sourceUnitTestRows struct {
	values [][]any
	index  int
}

func (r *sourceUnitTestRows) Close() error { return nil }
func (r *sourceUnitTestRows) Err() error   { return nil }
func (r *sourceUnitTestRows) Next() bool   { return r.index < len(r.values) }
func (r *sourceUnitTestRows) Scan(dest ...any) error {
	if r.index >= len(r.values) {
		return sql.ErrNoRows
	}
	row := r.values[r.index]
	r.index++
	if len(dest) != len(row) {
		return fmt.Errorf("scan count %d, want %d", len(dest), len(row))
	}
	for i := range dest {
		switch target := dest[i].(type) {
		case *int64:
			*target = row[i].(int64)
		case *int:
			*target = int(row[i].(int64))
		case *string:
			*target = row[i].(string)
		case *bool:
			*target = row[i].(bool)
		case *time.Time:
			*target = row[i].(time.Time)
		default:
			return fmt.Errorf("unsupported scan target %T", target)
		}
	}
	return nil
}
