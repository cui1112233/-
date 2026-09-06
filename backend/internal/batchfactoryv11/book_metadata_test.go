package batchfactoryv11

import (
	"context"
	"testing"
)

type metadataClassifier struct {
	result string
	calls  int
}

func (c *metadataClassifier) Complete(context.Context, TextCompletionRequest) (string, error) {
	c.calls++
	return c.result, nil
}

func TestManualMetadataRecognitionIsDisabledByDefault(t *testing.T) {
	classifier := &metadataClassifier{result: `{"gender":"女频","type":"现代言情"}`}
	got, err := ClassifyManualBookMetadata(context.Background(), classifier, ManualBookMetadataInput{Title: "测试", Text: "正文"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "未识别" || classifier.calls != 0 {
		t.Fatalf("got=%+v calls=%d", got, classifier.calls)
	}
}

func TestManualMetadataRecognitionPersistsGenderAndTypeWhenEnabled(t *testing.T) {
	classifier := &metadataClassifier{result: `{"gender":"女频","type":"现代言情"}`}
	got, err := ClassifyManualBookMetadata(context.Background(), classifier, ManualBookMetadataInput{Title: "测试", Text: "正文"}, true)
	if err != nil || got.Gender != "女频" || got.Type != "现代言情" || got.Status != "已识别" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}
