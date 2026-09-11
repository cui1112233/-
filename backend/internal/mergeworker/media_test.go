package mergeworker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidatePublicHTTPSURLRejectsUnsafeTargets(t *testing.T) {
	for _, raw := range []string{
		"http://media.example/video.mp4",
		"https://127.0.0.1/video.mp4",
		"https://localhost/video.mp4",
		"https://169.254.169.254/latest/meta-data",
	} {
		if err := ValidatePublicHTTPSURL(raw); err == nil {
			t.Fatalf("expected unsafe URL rejection for %s", raw)
		}
	}
}

func TestDownloaderRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("12345"))
	}))
	defer server.Close()
	d := &Downloader{
		Client:       server.Client(),
		MaxFileBytes: 4,
		MaxTotalBytes: 8,
		ValidateURL:  func(string) error { return nil },
	}
	_, err := d.Download(context.Background(), []Source{{ProductionJobID: "p1", VideoID: "v1", MediaURL: server.URL + "/1.mp4", Order: 0}}, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("err=%v", err)
	}
}

func TestDownloaderPreservesSourceOrder(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(strings.TrimPrefix(r.URL.Path, "/")))
	}))
	defer server.Close()
	d := &Downloader{Client: server.Client(), MaxFileBytes: 1024, MaxTotalBytes: 2048, ValidateURL: func(string) error { return nil }}
	dir := t.TempDir()
	paths, err := d.Download(context.Background(), []Source{
		{ProductionJobID: "p1", VideoID: "video-a", MediaURL: server.URL + "/first", Order: 0},
		{ProductionJobID: "p2", VideoID: "video-b", MediaURL: server.URL + "/second", Order: 1},
	}, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 {
		t.Fatalf("paths=%v", paths)
	}
	first, _ := os.ReadFile(paths[0])
	second, _ := os.ReadFile(paths[1])
	if string(first) != "first" || string(second) != "second" {
		t.Fatalf("first=%q second=%q", first, second)
	}
	if filepath.Base(paths[0]) >= filepath.Base(paths[1]) {
		t.Fatalf("paths not ordered: %v", paths)
	}
}

func TestBuildFFmpegArgsUsesArgvAndFaststart(t *testing.T) {
	args, err := BuildFFmpegArgs("/work/inputs.txt", "/work/out.mp4", 1)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, required := range []string{"-f concat", "-safe 0", "libx264", "aac", "+faststart", "/work/out.mp4"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing %q in %q", required, joined)
		}
	}
	if strings.Contains(joined, "sh -c") || strings.Contains(joined, "bash -c") {
		t.Fatalf("shell invocation leaked into args: %q", joined)
	}
}
