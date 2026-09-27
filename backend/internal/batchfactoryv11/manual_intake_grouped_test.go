package batchfactoryv11

import "testing"

func TestParseGroupedManualBookLists(t *testing.T) {
	input := ManualIntakeInput{
		ParseMode:      "smart",
		ColumnPresetID: "full_metadata",
		Groups: []ManualIntakeGroup{
			{PlatformID: "3", PlatformName: "七猫付费", InputText: "737092 雪尽风软归良人\n687404 老公狠心"},
			{PlatformID: "15", PlatformName: "知乎付费", InputText: "567168 晚风惊扰旧梦"},
		},
	}
	books, err := ParseGroupedManualBookLists(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(books) != 3 {
		t.Fatalf("want 3 books, got %d", len(books))
	}
	if books[0].Platform != "3" || books[0].SourceMetadata["platformName"] != "七猫付费" {
		t.Fatalf("book0 platform wrong: %+v", books[0])
	}
	if books[2].Platform != "15" || books[2].SourceMetadata["platformName"] != "知乎付费" {
		t.Fatalf("book2 platform wrong: %+v", books[2])
	}
}

func TestParseGroupedManualBookListsSameIDAcrossGroupsKept(t *testing.T) {
	input := ManualIntakeInput{
		Groups: []ManualIntakeGroup{
			{PlatformID: "3", InputText: "737092 甲"},
			{PlatformID: "15", InputText: "737092 乙"},
		},
	}
	books, err := ParseGroupedManualBookLists(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(books) != 2 {
		t.Fatalf("cross-group same ID must be kept twice, got %d", len(books))
	}
}

func TestParseGroupedManualBookListsInvalidGroup(t *testing.T) {
	input := ManualIntakeInput{
		Groups: []ManualIntakeGroup{
			{PlatformID: "", InputText: "737092 甲"},
		},
	}
	if _, err := ParseGroupedManualBookLists(input); err == nil {
		t.Fatal("group without platformId must fail")
	}
}

func TestParseGroupedManualBookListsEmpty(t *testing.T) {
	if _, err := ParseGroupedManualBookLists(ManualIntakeInput{}); err == nil {
		t.Fatal("empty input must fail")
	}
}

func TestParseGroupedManualBookListsGroupScopedSourceText(t *testing.T) {
	input := ManualIntakeInput{
		// base 故意不带顶层 SourceTextByBookID，证明正文完全按组隔离。
		Groups: []ManualIntakeGroup{
			{
				PlatformID:         "3",
				PlatformName:       "七猫付费",
				InputText:          "737092 甲书",
				SourceTextByBookID: map[string]string{"737092": "甲正文，来自书城 3"},
			},
			{
				PlatformID:         "15",
				PlatformName:       "知乎付费",
				InputText:          "737092 乙书",
				SourceTextByBookID: map[string]string{"737092": "乙正文，来自书城 15"},
			},
		},
	}
	books, err := ParseGroupedManualBookLists(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(books) != 2 {
		t.Fatalf("want 2 books with duplicate ID across groups, got %d", len(books))
	}
	if books[0].Platform != "3" {
		t.Fatalf("books[0].Platform = %q, want 3", books[0].Platform)
	}
	if books[1].Platform != "15" {
		t.Fatalf("books[1].Platform = %q, want 15", books[1].Platform)
	}
	if books[0].SourceText != "甲正文，来自书城 3" {
		t.Fatalf("books[0].SourceText = %q, want group-3 text", books[0].SourceText)
	}
	if books[1].SourceText != "乙正文，来自书城 15" {
		t.Fatalf("books[1].SourceText = %q, want group-15 text", books[1].SourceText)
	}
	if books[0].SourceText == books[1].SourceText {
		t.Fatal("cross-platform duplicate IDs must keep separate source texts")
	}
}
