package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
)

// Object is the minimal object metadata required for a project export.
// It intentionally excludes storage URLs and provider-specific details.
type Object struct {
	Key         string
	ContentType string
}

type ObjectReader interface {
	Get(context.Context, string) (io.ReadCloser, Object, error)
}

type manifest struct {
	Project  manifestProject   `json:"project"`
	Segments []manifestSegment `json:"segments"`
	Assets   []manifestAsset   `json:"assets"`
	Media    []manifestMedia   `json:"media"`
}

type manifestProject struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type manifestSegment struct {
	ID                  int64   `json:"id"`
	OrderIndex          int     `json:"orderIndex"`
	SourceText          string  `json:"sourceText"`
	SubtitleText        string  `json:"subtitleText"`
	ImagePrompt         string  `json:"imagePrompt"`
	VideoPrompt         string  `json:"videoPrompt"`
	NegativePrompt      string  `json:"negativePrompt"`
	SourceUnitIDs       []int64 `json:"sourceUnitIds"`
	AssetIDs            []int64 `json:"assetIds"`
	TimingSource        string  `json:"timingSource"`
	EstimatedDurationMS int64   `json:"estimatedDurationMs"`
}

type manifestAsset struct {
	ID       int64  `json:"id"`
	Category string `json:"category"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
}

type manifestMedia struct {
	ID        int64  `json:"id"`
	SegmentID *int64 `json:"segmentId,omitempty"`
	Kind      string `json:"kind"`
	File      string `json:"file"`
	Source    string `json:"source"`
	IsPrimary bool   `json:"isPrimary"`
}

const estimatedSegmentDurationMS = int64(3000)

// BuildZIP creates a project-owned archive from confirmed storyboards and
// their persisted media. Object keys are never included in the archive
// manifest; consumers only receive stable archive-local filenames.
func BuildZIP(ctx context.Context, objects ObjectReader, project domain.Project, segments []domain.Segment, sourceUnitIDs, segmentAssetIDs map[int64][]int64, assets []domain.Asset, media []domain.Media) ([]byte, error) {
	confirmed := confirmedSegments(segments)
	if len(confirmed) == 0 {
		return nil, fmt.Errorf("no confirmed storyboards")
	}
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	manifestValue := manifest{Project: manifestProject{ID: project.ID, Name: project.Name}, Assets: publicAssets(assets)}
	for _, segment := range confirmed {
		duration, source := segmentTiming(segment.ID, media)
		manifestValue.Segments = append(manifestValue.Segments, manifestSegment{
			ID: segment.ID, OrderIndex: segment.OrderIndex, SourceText: segment.SourceText, SubtitleText: segment.SubtitleText,
			ImagePrompt: segment.ImagePrompt, VideoPrompt: segment.VideoPrompt, NegativePrompt: segment.NegativePrompt, SourceUnitIDs: append([]int64(nil), sourceUnitIDs[segment.ID]...), AssetIDs: append([]int64(nil), segmentAssetIDs[segment.ID]...),
			TimingSource: source, EstimatedDurationMS: duration,
		})
	}
	if err := writeSRT(archive, confirmed, media); err != nil {
		return nil, err
	}
	if err := writeMedia(ctx, archive, objects, media, &manifestValue); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(manifestValue)
	if err != nil {
		return nil, fmt.Errorf("encode export manifest: %w", err)
	}
	if err := writeEntry(archive, "manifest.json", encoded); err != nil {
		return nil, err
	}
	if err := archive.Close(); err != nil {
		return nil, fmt.Errorf("finalize export archive: %w", err)
	}
	return buffer.Bytes(), nil
}

func confirmedSegments(segments []domain.Segment) []domain.Segment {
	confirmed := make([]domain.Segment, 0, len(segments))
	for _, segment := range segments {
		if segment.Confirmed {
			confirmed = append(confirmed, segment)
		}
	}
	sort.SliceStable(confirmed, func(i, j int) bool { return confirmed[i].OrderIndex < confirmed[j].OrderIndex })
	return confirmed
}

func publicAssets(assets []domain.Asset) []manifestAsset {
	result := make([]manifestAsset, 0, len(assets))
	for _, asset := range assets {
		result = append(result, manifestAsset{ID: asset.ID, Category: asset.Category, Name: asset.Name, Prompt: asset.Prompt})
	}
	return result
}

func segmentTiming(segmentID int64, media []domain.Media) (int64, string) {
	for _, item := range media {
		if item.SegmentID != nil && *item.SegmentID == segmentID && item.Kind == "audio" && item.DurationMS != nil && *item.DurationMS > 0 {
			return *item.DurationMS, "media_duration"
		}
	}
	return estimatedSegmentDurationMS, "estimated"
}

func writeSRT(archive *zip.Writer, segments []domain.Segment, media []domain.Media) error {
	var builder strings.Builder
	position := int64(0)
	for index, segment := range segments {
		duration, _ := segmentTiming(segment.ID, media)
		fmt.Fprintf(&builder, "%d\n%s --> %s\n%s\n\n", index+1, srtTimestamp(position), srtTimestamp(position+duration), strings.TrimSpace(segment.SubtitleText))
		position += duration
	}
	return writeEntry(archive, "subtitles.srt", []byte(builder.String()))
}

func srtTimestamp(milliseconds int64) string {
	value := time.Duration(milliseconds) * time.Millisecond
	hours := int(value / time.Hour)
	minutes := int(value % time.Hour / time.Minute)
	seconds := int(value % time.Minute / time.Second)
	ms := int(value % time.Second / time.Millisecond)
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, ms)
}

func writeMedia(ctx context.Context, archive *zip.Writer, objects ObjectReader, media []domain.Media, result *manifest) error {
	if len(media) == 0 {
		return nil
	}
	if objects == nil {
		return fmt.Errorf("object storage is unavailable")
	}
	for _, item := range media {
		if item.ObjectKey == "" {
			continue
		}
		body, object, err := objects.Get(ctx, item.ObjectKey)
		if err != nil {
			return fmt.Errorf("read export media %d: %w", item.ID, err)
		}
		data, readErr := io.ReadAll(body)
		closeErr := body.Close()
		if readErr != nil {
			return fmt.Errorf("read export media %d: %w", item.ID, readErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close export media %d: %w", item.ID, closeErr)
		}
		filename := exportedMediaFilename(item, object.ContentType)
		if err := writeEntry(archive, filename, data); err != nil {
			return err
		}
		result.Media = append(result.Media, manifestMedia{ID: item.ID, SegmentID: item.SegmentID, Kind: item.Kind, File: filename, Source: item.Source, IsPrimary: item.IsPrimary})
	}
	return nil
}

func exportedMediaFilename(media domain.Media, contentType string) string {
	extension := path.Ext(media.ObjectKey)
	if extension == "" {
		switch media.Kind {
		case "image":
			extension = ".png"
		case "video":
			extension = ".mp4"
		case "audio":
			extension = ".mp3"
		default:
			extension = ".bin"
		}
	}
	return fmt.Sprintf("media/%04d-%s%s", media.ID, media.Kind, extension)
}

func writeEntry(archive *zip.Writer, name string, body []byte) error {
	entry, err := archive.Create(name)
	if err != nil {
		return fmt.Errorf("create export entry %s: %w", name, err)
	}
	if _, err := entry.Write(body); err != nil {
		return fmt.Errorf("write export entry %s: %w", name, err)
	}
	return nil
}
