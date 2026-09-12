package mergeworker

import (
	"bufio"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type CommandExecutor func(context.Context, string, ...string) error
type DurationProbeFunc func(context.Context, string) (float64, error)

type FFmpegRunner struct {
	Binary      string
	ProbeBinary string
	Exec        CommandExecutor
	Probe       DurationProbeFunc
}

func ResolveMergeSpeed(timingMode string, requestedSpeed, sourceDurationSeconds, audioDurationSeconds float64) (float64, error) {
	mode := strings.TrimSpace(timingMode)
	if mode == "" {
		mode = "speed"
	}
	if mode != "speed" && mode != "audio" {
		return 0, fmt.Errorf("unsupported timing mode")
	}
	if requestedSpeed != 0 {
		if math.IsNaN(requestedSpeed) || math.IsInf(requestedSpeed, 0) || requestedSpeed < 0.25 || requestedSpeed > 4 {
			return 0, fmt.Errorf("speed must be between 0.25 and 4")
		}
		return requestedSpeed, nil
	}
	if mode == "speed" {
		return 1, nil
	}
	if sourceDurationSeconds <= 0 || math.IsNaN(sourceDurationSeconds) || math.IsInf(sourceDurationSeconds, 0) {
		return 0, fmt.Errorf("source duration must be positive for audio timing")
	}
	if audioDurationSeconds <= 0 || math.IsNaN(audioDurationSeconds) || math.IsInf(audioDurationSeconds, 0) {
		return 0, fmt.Errorf("audio duration must be positive for audio timing")
	}
	speed := sourceDurationSeconds / audioDurationSeconds
	if speed < 0.25 || speed > 4 {
		return 0, fmt.Errorf("required speed %.3f is outside supported range 0.25-4", speed)
	}
	return speed, nil
}

func BuildFFmpegArgs(manifestPath, outputPath string, speed float64) ([]string, error) {
	if strings.TrimSpace(manifestPath) == "" || strings.TrimSpace(outputPath) == "" {
		return nil, fmt.Errorf("ffmpeg manifest and output are required")
	}
	if speed == 0 {
		speed = 1
	}
	if speed < 0.25 || speed > 4 {
		return nil, fmt.Errorf("speed must be between 0.25 and 4")
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

func (r *FFmpegRunner) TotalDuration(ctx context.Context, inputPaths []string) (float64, error) {
	if len(inputPaths) == 0 {
		return 0, fmt.Errorf("media inputs are required")
	}
	total := 0.0
	for _, inputPath := range inputPaths {
		duration, err := r.probeDuration(ctx, inputPath)
		if err != nil {
			return 0, err
		}
		if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
			return 0, fmt.Errorf("invalid media duration")
		}
		total += duration
	}
	return total, nil
}

func (r *FFmpegRunner) probeDuration(ctx context.Context, inputPath string) (float64, error) {
	if r.Probe != nil {
		return r.Probe(ctx, inputPath)
	}
	binary := strings.TrimSpace(r.ProbeBinary)
	if binary == "" {
		binary = "ffprobe"
	}
	cmd := exec.CommandContext(ctx, binary,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		inputPath,
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed")
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("ffprobe returned invalid duration")
	}
	return value, nil
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
