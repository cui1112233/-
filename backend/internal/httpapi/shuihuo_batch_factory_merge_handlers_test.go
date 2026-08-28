package httpapi

import (
	"path/filepath"
	"testing"
)

func TestBatchFactoryMergeBookIDValidation(t *testing.T) {
	valid := []string{
		"1",
		"2074141710842647315",
		"999999999999999999999999999999999999999999999999999999999999",
	}
	for _, value := range valid {
		if !batchFactoryBookIDPattern.MatchString(value) {
			t.Fatalf("expected book id %q to be valid", value)
		}
	}

	invalid := []string{
		"",
		"book-123",
		"123.txt",
		"../123",
		"123/456",
		"１２３",
	}
	for _, value := range invalid {
		if batchFactoryBookIDPattern.MatchString(value) {
			t.Fatalf("expected book id %q to be invalid", value)
		}
	}
}

func TestBatchFactoryMergeSpeedValidation(t *testing.T) {
	valid := []float64{1, 1.1, 1.5, 1.7, 2}
	for _, speed := range valid {
		if !validBatchFactoryMergeSpeed(speed) {
			t.Fatalf("expected speed %.2f to be valid", speed)
		}
	}
	invalid := []float64{0, 0.99, 2.01, 3}
	for _, speed := range invalid {
		if validBatchFactoryMergeSpeed(speed) {
			t.Fatalf("expected speed %.2f to be invalid", speed)
		}
	}
}

func TestResolveBatchFactoryFFmpegRejectsMissingConfiguredPath(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing-ffmpeg")
	t.Setenv("QIANTIE_FFMPEG_PATH", missing)
	if _, err := resolveBatchFactoryFFmpeg(); err == nil {
		t.Fatal("expected missing configured FFmpeg path to be rejected")
	}
}
