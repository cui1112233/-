package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

const (
	batchFactoryMergeSource       = "batch_merge"
	batchFactoryMergeTimeout      = 110 * time.Second
	batchFactoryMergeMaxInputSize = int64(2 << 30)
)

var batchFactoryBookIDPattern = regexp.MustCompile(`^[0-9]{1,128}$`)

type batchFactoryMergeRequest struct {
	ProjectID int64   `json:"projectId"`
	BookID    string  `json:"bookId"`
	MediaIDs  []int64 `json:"mediaIds"`
	Speed     float64 `json:"speed"`
}

type batchFactoryMergeCapability struct {
	Ready  bool   `json:"ready"`
	Reason string `json:"reason,omitempty"`
}

func resolveBatchFactoryFFmpeg() (string, error) {
	configured := strings.TrimSpace(os.Getenv("QIANTIE_FFMPEG_PATH"))
	if configured != "" {
		path, err := exec.LookPath(configured)
		if err != nil {
			return "", errors.New("QIANTIE_FFMPEG_PATH 指向的 FFmpeg 不可用")
		}
		return path, nil
	}
	return exec.LookPath("ffmpeg")
}

func validBatchFactoryMergeSpeed(speed float64) bool {
	return speed >= 1 && speed <= 2
}

func (api *API) handleBatchFactoryMergeCapability(w http.ResponseWriter, r *http.Request) {
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusOK, batchFactoryMergeCapability{Ready: false, Reason: "对象存储未配置"})
		return
	}
	if _, err := resolveBatchFactoryFFmpeg(); err != nil {
		writeJSON(w, http.StatusOK, batchFactoryMergeCapability{Ready: false, Reason: "服务器未检测到 FFmpeg；可安装 ffmpeg 或配置 QIANTIE_FFMPEG_PATH"})
		return
	}
	writeJSON(w, http.StatusOK, batchFactoryMergeCapability{Ready: true})
}

func (api *API) handleBatchFactoryMergeVideos(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "对象存储未配置，无法合并视频"})
		return
	}
	ffmpegPath, err := resolveBatchFactoryFFmpeg()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "服务器未检测到 FFmpeg，请先安装 ffmpeg 或配置 QIANTIE_FFMPEG_PATH"})
		return
	}

	var req batchFactoryMergeRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	req.BookID = strings.TrimSpace(req.BookID)
	if req.ProjectID < 1 || !batchFactoryBookIDPattern.MatchString(req.BookID) || len(req.MediaIDs) == 0 || len(req.MediaIDs) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "合并视频参数无效"})
		return
	}
	if req.Speed == 0 {
		req.Speed = 1
	}
	if !validBatchFactoryMergeSpeed(req.Speed) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "当前合并倍率仅支持 1.0x–2.0x"})
		return
	}
	seen := make(map[int64]struct{}, len(req.MediaIDs))
	for _, mediaID := range req.MediaIDs {
		if mediaID < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "视频素材ID无效"})
			return
		}
		if _, duplicate := seen[mediaID]; duplicate {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "参与合并的视频不能重复"})
			return
		}
		seen[mediaID] = struct{}{}
	}

	user, _ := currentUser(r)
	if _, err := shuihuostore.NewProjects(api.deps.DB).GetProject(r.Context(), user.ID, req.ProjectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "生产项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取生产项目失败"})
		return
	}

	mediaRepo := shuihuostore.NewMedia(api.deps.DB)
	inputs := make([]domain.Media, 0, len(req.MediaIDs))
	var sourceDurationMS int64
	hasCompleteDuration := true
	for index, mediaID := range req.MediaIDs {
		item, err := mediaRepo.Get(r.Context(), user.ID, mediaID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("第 %d 个 VIDEO 成品不存在", index+1)})
			return
		}
		if item.ProjectID != req.ProjectID || item.Kind != "video" || item.SegmentID == nil || item.TaskID == nil || item.Source == batchFactoryMergeSource {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("第 %d 个素材不是当前小说由生成任务产出的 VIDEO 成品", index+1)})
			return
		}
		inputs = append(inputs, item)
		if item.DurationMS == nil || *item.DurationMS <= 0 {
			hasCompleteDuration = false
		} else {
			sourceDurationMS += *item.DurationMS
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), batchFactoryMergeTimeout)
	defer cancel()
	tempDir, err := os.MkdirTemp("", "qiantie-batch-merge-*")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建视频合并临时目录失败"})
		return
	}
	defer os.RemoveAll(tempDir)

	var concat bytes.Buffer
	var totalInputBytes int64
	for index, item := range inputs {
		reader, object, err := api.deps.Objects.Get(ctx, item.ObjectKey)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("读取 VIDEO %02d 成品失败", index+1)})
			return
		}
		if object.Size > 0 && totalInputBytes+object.Size > batchFactoryMergeMaxInputSize {
			reader.Close()
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "参与合并的视频总大小超过 2GB"})
			return
		}

		filename := fmt.Sprintf("part-%03d.mp4", index+1)
		path := filepath.Join(tempDir, filename)
		file, createErr := os.Create(path)
		if createErr != nil {
			reader.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "写入视频临时文件失败"})
			return
		}
		remaining := batchFactoryMergeMaxInputSize - totalInputBytes
		written, copyErr := io.Copy(file, io.LimitReader(reader, remaining+1))
		closeErr := file.Close()
		reader.Close()
		totalInputBytes += written
		if totalInputBytes > batchFactoryMergeMaxInputSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "参与合并的视频总大小超过 2GB"})
			return
		}
		if copyErr != nil || closeErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存视频临时文件失败"})
			return
		}
		fmt.Fprintf(&concat, "file '%s'\n", filename)
	}
	listPath := filepath.Join(tempDir, "inputs.txt")
	if err := os.WriteFile(listPath, concat.Bytes(), 0o600); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建视频合并清单失败"})
		return
	}

	outputPath := filepath.Join(tempDir, req.BookID+".mp4")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "concat", "-safe", "0", "-i", "inputs.txt",
		"-map", "0:v:0", "-map", "0:a?",
	}
	if req.Speed != 1 {
		args = append(args,
			"-vf", fmt.Sprintf("setpts=PTS/%.6f", req.Speed),
			"-af", fmt.Sprintf("atempo=%.6f", req.Speed),
		)
	}
	args = append(args,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
		"-c:a", "aac", "-movflags", "+faststart",
		filepath.Base(outputPath),
	)
	command := exec.CommandContext(ctx, ffmpegPath, args...)
	command.Dir = tempDir
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if ctx.Err() != nil {
			message = "视频合并超过 110 秒，请减少单次合并内容后重试"
		} else if message == "" {
			message = err.Error()
		}
		if len(message) > 1000 {
			message = message[:1000]
		}
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "FFmpeg 合并失败：" + message})
		return
	}

	outputFile, err := os.Open(outputPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取合并成品失败"})
		return
	}
	defer outputFile.Close()
	stat, err := outputFile.Stat()
	if err != nil || stat.Size() <= 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "合并成品文件无效"})
		return
	}
	key, err := shuihuostorage.ObjectKey(user.ID, req.ProjectID, "exports", req.BookID+".mp4")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成合并成品存储路径失败"})
		return
	}
	if _, err := api.deps.Objects.Put(ctx, key, outputFile, "video/mp4"); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "保存合并成品失败"})
		return
	}

	var mergedDurationMS *int64
	var sourceDurationValue any
	if hasCompleteDuration && sourceDurationMS > 0 {
		value := int64(float64(sourceDurationMS) / req.Speed)
		mergedDurationMS = &value
		sourceDurationValue = sourceDurationMS
	}
	merged, err := mediaRepo.Create(r.Context(), user.ID, req.ProjectID, domain.Media{
		Kind:           "video",
		ObjectKey:      key,
		Source:         batchFactoryMergeSource,
		ManuallyEdited: true,
		DurationMS:     mergedDurationMS,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "记录合并成品失败"})
		return
	}

	// The object key is stable ({bookId}.mp4). Create the new row first so a
	// database failure never removes the previous usable merge record. Then
	// retire only older merge rows; original VIDEO media remain untouched.
	if existing, listErr := mediaRepo.ListByProject(r.Context(), user.ID, req.ProjectID); listErr == nil {
		for _, item := range existing {
			if item.ID != merged.ID && item.Kind == "video" && item.Source == batchFactoryMergeSource {
				_ = mediaRepo.Delete(r.Context(), user.ID, item.ID)
			}
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"media": map[string]any{
			"id":           merged.ID,
			"projectId":    merged.ProjectID,
			"durationMs":   merged.DurationMS,
			"source":       merged.Source,
			"downloadPath": "/api/shuihuo-production/media/" + strconv.FormatInt(merged.ID, 10) + "/download",
		},
		"filename":         req.BookID + ".mp4",
		"speed":            req.Speed,
		"sourceDurationMs": sourceDurationValue,
		"ffmpeg":           true,
	})
}
