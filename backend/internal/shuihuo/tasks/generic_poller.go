package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

type GenericPollProvider interface {
	Poll(context.Context, models.Definition, string) (models.GenericPollResult, error)
}

type GenericPoller struct {
	Tasks          PollerTaskRepository
	Models         PollerModelRepository
	Provider       GenericPollProvider
	Objects        WorkerObjects
	DownloadResult func(context.Context, string) ([]byte, string, error)
	Now            func() time.Time
	Interval       time.Duration
	BatchSize      int
}

func (p GenericPoller) Run(ctx context.Context) error {
	interval := p.interval()
	_ = p.PollDue(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := p.PollDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				continue
			}
		}
	}
}

func (p GenericPoller) PollDue(ctx context.Context) error {
	if p.Tasks == nil {
		return fmt.Errorf("generic poller task repository is not configured")
	}
	batch := p.BatchSize
	if batch <= 0 {
		batch = defaultPollBatchSize
	}
	tasks, err := p.Tasks.ListRunningByProvider(ctx, models.AdapterGenericHTTP, p.now(), batch)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		if err := p.PollOnce(ctx, task); err != nil && !errors.Is(err, ErrTaskAlreadyCompleted) {
			return err
		}
	}
	return nil
}

func (p GenericPoller) PollOnce(ctx context.Context, task domain.Task) error {
	if task.Status != domain.TaskRunning {
		return ErrTaskAlreadyCompleted
	}
	if p.Tasks == nil || p.Models == nil || p.Provider == nil || p.Objects == nil {
		return fmt.Errorf("generic poller is not configured")
	}
	if task.Kind != "video" || task.Provider != models.AdapterGenericHTTP || task.ModelID == nil || task.ModelVersionID == nil || task.ProviderTaskID == "" {
		return p.fail(ctx, task, "invalid_async_task", "通用视频异步任务快照不完整")
	}
	model, err := p.Models.GetVersion(ctx, *task.ModelID, *task.ModelVersionID)
	if err != nil {
		return p.fail(ctx, task, "model_unavailable", "视频模型不可用")
	}
	result, err := p.Provider.Poll(ctx, model, task.ProviderTaskID)
	if err != nil {
		return p.fail(ctx, task, "model_poll_failed", err.Error())
	}
	switch result.State {
	case models.GenericPollRunning:
		return p.Tasks.SetNextPoll(ctx, task.ID, p.now().Add(p.interval()))
	case models.GenericPollFailed:
		return p.fail(ctx, task, "provider_task_failed", result.Message)
	case models.GenericPollSucceeded:
		return p.persistResult(ctx, task, result.ResultURL)
	default:
		return p.fail(ctx, task, "invalid_provider_status", "视频服务返回未知状态")
	}
}

func (p GenericPoller) persistResult(ctx context.Context, task domain.Task, resultURL string) error {
	download := p.DownloadResult
	if download == nil {
		download = downloadModelResult
	}
	body, contentType, err := download(ctx, resultURL)
	if err != nil {
		return p.fail(ctx, task, "download_result_failed", "下载视频结果失败")
	}
	category, kind, filename := generatedObjectDetails("video", contentType, task.ID)
	key, err := shuihuostorage.ObjectKey(task.UserID, task.ProjectID, category, filename)
	if err != nil {
		return p.fail(ctx, task, "object_key_failed", "生成视频存储路径失败")
	}
	if err := p.Objects.PutGenerated(ctx, key, body, contentType); err != nil {
		return p.fail(ctx, task, "store_result_failed", "保存视频结果失败")
	}
	output, _ := json.Marshal(map[string]any{"objectKey": key, "providerTaskId": task.ProviderTaskID})
	completed, err := p.Tasks.CompleteWithGeneratedMedia(ctx, task.ID, domain.Media{ProjectID: task.ProjectID, SegmentID: task.SegmentID, TaskID: &task.ID, Kind: kind, ObjectKey: key, Source: "generated"}, string(output))
	if err != nil {
		return err
	}
	if !completed {
		return ErrTaskAlreadyCompleted
	}
	return nil
}

func (p GenericPoller) fail(ctx context.Context, task domain.Task, code, message string) error {
	if message == "" {
		message = "视频生成失败"
	}
	if err := p.Tasks.SetFailure(ctx, task.ID, code, message); err != nil {
		return err
	}
	return p.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskRunning, domain.TaskFailed, message)
}

func (p GenericPoller) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now().UTC()
}

func (p GenericPoller) interval() time.Duration {
	if p.Interval > 0 {
		return p.Interval
	}
	return defaultPollInterval
}
