package segmentation

import (
	"context"
	"errors"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

type smartTestGenerator struct{ calls int }

func (g *smartTestGenerator) GenerateSegments(_ context.Context, _ int64, _ string) ([]CandidateSegment, error) {
	g.calls++
	return []CandidateSegment{{Text: "候选"}}, nil
}

func TestImportSplitsNumberedAndTimedContent(t *testing.T) {
	got := ParseImported("01\n00:00:00,000 --> 00:00:02,000\n第一句\n\n02\n第二句")
	if len(got) != 2 || got[0].Text != "第一句" || got[1].Text != "第二句" {
		t.Fatalf("segments=%#v", got)
	}
}

func TestImportSupportsWhitespaceSeparatorsAndCommonNumbering(t *testing.T) {
	got := ParseImported("WEBVTT\n\n1.\n00:00:00.000 --> 00:00:02.000\n第一句\n \t\n第2段\n第二句")
	if len(got) != 2 || got[0].Text != "第一句" || got[1].Text != "第二句" {
		t.Fatalf("segments=%#v", got)
	}
}

func TestFixedLineSegments(t *testing.T) {
	got := FixedLineSegments("一\n二\n三", 2)
	if len(got) != 2 || got[0].Text != "一\n二" || got[1].Text != "三" {
		t.Fatalf("segments=%#v", got)
	}
}

func TestParagraphSegmentsKeepsEachNonEmptyParagraph(t *testing.T) {
	got := ParagraphSegments("第一段第一句\n第一段第二句\n\n  \n第二段\n\n第三段")
	if len(got) != 3 || got[0].Text != "第一段第一句\n第一段第二句" || got[1].Text != "第二段" || got[2].Text != "第三段" {
		t.Fatalf("segments=%#v", got)
	}
}

func TestGenerationBlockedUntilSegmentsConfirmed(t *testing.T) {
	project := domain.Project{SegmentationStatus: StatusDraft}
	if err := EnsureSegmentsConfirmed(project); !errors.Is(err, ErrSegmentsUnconfirmed) {
		t.Fatalf("err=%v", err)
	}
	project.SegmentationStatus = StatusConfirmed
	if err := EnsureSegmentsConfirmed(project); err != nil {
		t.Fatal(err)
	}
}
