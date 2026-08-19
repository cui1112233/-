package export

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"qiantie/backend/internal/shuihuo/domain"
)

type memoryObjects map[string]storedObject

type storedObject struct {
	body        []byte
	contentType string
}

func (m memoryObjects) Get(_ context.Context, key string) (io.ReadCloser, Object, error) {
	item := m[key]
	return io.NopCloser(bytes.NewReader(item.body)), Object{Key: key, ContentType: item.contentType}, nil
}

func TestBuildZIPIncludesManifestSRTAndOwnedMedia(t *testing.T) {
	project := domain.Project{ID: 12, Name: "雨夜列车"}
	segments := []domain.Segment{{ID: 101, OrderIndex: 1, SourceText: "第一段原文", SubtitleText: "第一句字幕", Confirmed: true, ImagePrompt: "雨夜车站", VideoPrompt: "镜头推进", NegativePrompt: "避免畸形手指"}}
	media := []domain.Media{
		{ID: 1, ProjectID: 12, SegmentID: int64Ptr(101), Kind: "image", ObjectKey: "image-key", IsPrimary: true},
		{ID: 2, ProjectID: 12, SegmentID: int64Ptr(101), Kind: "audio", ObjectKey: "audio-key", DurationMS: int64Ptr(1250)},
	}
	objects := memoryObjects{
		"image-key": {body: []byte("png"), contentType: "image/png"},
		"audio-key": {body: []byte("mp3"), contentType: "audio/mpeg"},
	}

	body, err := BuildZIP(context.Background(), objects, project, segments, map[int64][]int64{101: {701}}, map[int64][]int64{101: {501}}, []domain.Asset{{ID: 501, ProjectID: 12, Category: "character", Name: "林晚", Prompt: "年轻女性"}}, media)
	if err != nil {
		t.Fatalf("BuildZIP() error = %v", err)
	}
	entries := zipEntries(t, body)
	for _, name := range []string{"manifest.json", "subtitles.srt", "media/0001-image.png", "media/0002-audio.mp3"} {
		if _, ok := entries[name]; !ok {
			t.Fatalf("ZIP entries = %v, missing %q", sortedKeys(entries), name)
		}
	}
	if got := string(entries["subtitles.srt"]); !strings.Contains(got, "00:00:00,000 --> 00:00:01,250") || !strings.Contains(got, "第一句字幕") {
		t.Fatalf("subtitles.srt = %q", got)
	}
	manifest := string(entries["manifest.json"])
	if !strings.Contains(manifest, `"timingSource":"media_duration"`) || !strings.Contains(manifest, `"assetIds":[501]`) || !strings.Contains(manifest, `"negativePrompt":"避免畸形手指"`) || strings.Contains(manifest, "image-key") || strings.Contains(manifest, "audio-key") {
		t.Fatalf("manifest leaks object key or lacks timing source: %s", manifest)
	}
}

func TestBuildZIPUsesEstimatedTimingWithoutAudio(t *testing.T) {
	body, err := BuildZIP(context.Background(), memoryObjects{}, domain.Project{ID: 12, Name: "测试"}, []domain.Segment{{ID: 101, OrderIndex: 1, SubtitleText: "字幕", Confirmed: true}}, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("BuildZIP() error = %v", err)
	}
	entries := zipEntries(t, body)
	if got := string(entries["subtitles.srt"]); !strings.Contains(got, "00:00:03,000") {
		t.Fatalf("estimated subtitles.srt = %q", got)
	}
	if manifest := string(entries["manifest.json"]); !strings.Contains(manifest, `"timingSource":"estimated"`) {
		t.Fatalf("manifest = %s", manifest)
	}
}

func zipEntries(t *testing.T, body []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	entries := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		input, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(input)
		input.Close()
		if err != nil {
			t.Fatal(err)
		}
		entries[file.Name] = data
	}
	return entries
}

func sortedKeys(items map[string][]byte) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	return keys
}

func int64Ptr(value int64) *int64 { return &value }
