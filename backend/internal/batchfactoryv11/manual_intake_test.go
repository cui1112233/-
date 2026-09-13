package batchfactoryv11

import "testing"

func TestParseManualBookListUsesPresetAndRetainsNovelFetchMetadata(t *testing.T) {
	books, err := ParseManualBookList(ManualIntakeInput{
		PlatformID:     "15",
		ParseMode:      "smart",
		ColumnPresetID: "sample_input",
		InputText:      "2080989285751305136\t重生书\t推荐理由\t女频\t重生,爽文\tS",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 || books[0].BookID != "2080989285751305136" || books[0].Title != "重生书" {
		t.Fatalf("books=%+v", books)
	}
	metadata := books[0].SourceMetadata
	if metadata["gender"] != "女频" || metadata["rating"] != "S" || metadata["tags"] != "重生,爽文" {
		t.Fatalf("metadata=%#v", metadata)
	}
	if metadata["sourceMode"] != "manual_original" || metadata["sourceLine"] == "" {
		t.Fatalf("source metadata=%#v", metadata)
	}
}

func TestParseManualBookListUnderstandsHeaderAndDeduplicatesBookID(t *testing.T) {
	books, err := ParseManualBookList(ManualIntakeInput{
		PlatformID: "zhihu-paid",
		ParseMode:  "header",
		InputText:  "书籍ID\t书名\t男女频\t类型\n100000000001\t书A\t男频\t都市\n100000000001\t书A新版\t男频\t都市",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 || books[0].BookID != "100000000001" || books[0].Title != "书A新版" {
		t.Fatalf("books=%+v", books)
	}
	if books[0].SourceMetadata["style"] != "都市" || books[0].Platform != "zhihu-paid" {
		t.Fatalf("book=%+v", books[0])
	}
}
