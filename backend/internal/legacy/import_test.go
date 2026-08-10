package legacy

import "testing"

func TestStripHeader(t *testing.T) {
	content := "格式：画布模式\n" + "========================================" + "\n\n正文内容"
	if got := stripHeader(content); got != "正文内容" {
		t.Fatalf("stripHeader() = %q", got)
	}
}

func TestMakePreviewUsesRuneLength(t *testing.T) {
	got := makePreview("一二三四五六七八九十十一十二十三十四十五十六十七十八十九二十")
	if len([]rune(got)) > 40 {
		t.Fatalf("preview too long: %d", len([]rune(got)))
	}
}
