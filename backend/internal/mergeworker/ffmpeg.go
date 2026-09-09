package mergeworker

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type CommandExecutor func(context.Context, string, ...string) error

type FFmpegRunner struct {
	Binary string
	Exec   CommandExecutor
}

func BuildFFmpegArgs(manifestPath, outputPath string, speed float64) ([]string, error) {
	if strings.TrimSpace(manifestPath) == "" || strings.TrimSpace(outputPath) == "" {
		return nil, fmt.Errorf("ffmpeg manifest and output are required")
	}
	if speed == 0 {
		speed = 1
	}
	if speed < 0.5 || speed > 4 {
		return nil, fmt.Errorf("speed must be between 0.5 and 4")
	}
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "concat", "-safe", "0", "-i", manifestPath,
		"-map", "0:v:0", "-map", "0:a:0?",
	}
	if speed != 1 {
		args = append(args, "-filter:v", "setpts=PTS/"+strconv.FormatFloat(speed, 'f', -1, 64))
		args = append(args, "-filter:a", "atempo="+atempoFilter(speed))
	}
	args = append(args,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "192k",
		"-movflags", "+faststart", outputPath,
	)
	return args, nil
}

func atempoFilter(speed float64) string {
	parts := []string{}
	for speed > 2 {
		parts = append(parts, "2.0")
		speed /= 2
	}
	for speed < 0.5 {
		parts = append(parts, "0.5")
		speed /= 0.5
	}
	parts = append(parts, strconv.FormatFloat(speed, 'f', -1, 64))
	return strings.Join(parts, ",atempo=")
}

func (r *FFmpegRunner) Merge(ctx context.Context, inputPaths []string, outputPath string, speed float64) error {
	if len(inputPaths) == 0 {
		return fmt.Errorf("ffmpeg inputs are required")
	}
	workDir := filepath.Dir(outputPath)
	if err := os.MkdirAll(workDir, 0o700); err != nil {
		return err
	}
	manifestPath := filepath.Join(workDir, "concat.txt")
	manifest, err := os.OpenFile(manifestPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriter(manifest)
	for _, inputPath := range inputPaths {
		absolute, err := filepath.Abs(inputPath)
		if err != nil {
			manifest.Close()
			return err
		}
		if _, err := fmt.Fprintf(writer, "file '%s'\n", escapeConcatPath(absolute)); err != nil {
			manifest.Close()
			return err
		}
	}
	if err := writer.Flush(); err != nil {
		manifest.Close()
		return err
	}
	if err := manifest.Close(); err != nil {
		return err
	}
	args, err := BuildFFmpegArgs(manifestPath, outputPath, speed)
	if err != nil {
		return err
	}
	binary := strings.TrimSpace(r.Binary)
	if binary == "" {
		binary = "ffmpeg"
	}
	run := r.Exec
	if run == nil {
		run = func(ctx context.Context, name string, args ...string) error {
			cmd := exec.CommandContext(ctx, name, args...)
			output, err := cmd.CombinedOutput()
			if err != nil {
				message := strings.TrimSpace(string(output))
				if len(message) > 512 {
					message = message[:512]
				}
				if message == "" {
					return fmt.Errorf("ffmpeg failed: %w", err)
				}
				return fmt.Errorf("ffmpeg failed: %s", message)
			}
			return nil
		}
	}
	return run(ctx, binary, args...)
}

func escapeConcatPath(value string) string {
	return strings.ReplaceAll(value, "'", "'\\''")
}
