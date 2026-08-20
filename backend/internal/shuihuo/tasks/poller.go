package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	"qiantie/backend/internal/shuihuo/providers"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

const defaultPollInterval = 10 * time.Second
const defaultPollBatchSize = 25

var ErrTaskAlreadyCompleted = errors.New("shuihuo task is already completed")

type PollerTaskRepository interface {
	ListRunningByProvider(context.Context, string, time.Time, int) ([]domain.Task, error)
	SetNextPoll(context.Context, int64, time.Time) error
	SetFailure(context.Context, int64, string, string) error
	TransitionForWorker(context.Context, int64, domain.TaskStatus, domain.TaskStatus, string) error
	CompleteWithGeneratedMedia(context.Context, int64, domain.Media, string) (bool, error)
}

type PollerModelRepository interface {
	GetVersion(context.Context, int64, int64) (models.Definition, error)
}

type Poller struct {
	Tasks          PollerTaskRepository
	Models         PollerModelRepository
	Providers      map[string]providers.AsyncVideoProvider
	Objects        WorkerObjects
	DownloadResult func(context.Context, string) ([]byte, string, error)
	Now            func() time.Time
	Interval       time.Duration
	BatchSize      int
}

func (p Poller) Run(ctx context.Context) error {
	interval := p.Interval
	if interval <= 0 {
		interval = defaultPollInterval
	}
	// A database/provider outage at boot must not disable restart recovery.
	// Continue at the bounded interval until the application context closes.
	_ = p.PollDue(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := p.PollDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				// Individual task failures are persisted by PollOnce. A repository
				// outage is retried on the next bounded scan.
				continue
			}
		}
	}
}

func (p Poller) PollDue(ctx context.Context) error {
	if p.Tasks == nil {
		return fmt.Errorf("shuihuo poller task repository is not configured")
	}
	now := p.now()
	batch := p.BatchSize
	if batch <= 0 {
		batch = defaultPollBatchSize
	}
	providerKeys := make([]string, 0, len(p.Providers))
	for providerKey := range p.Providers {
		providerKeys = append(providerKeys, providerKey)
	}
	sort.Strings(providerKeys)
	for _, providerKey := range providerKeys {
		tasks, err := p.Tasks.ListRunningByProvider(ctx, providerKey, now, batch)
		if err != nil {
			return err
		}
		for _, task := range tasks {
			if err := p.PollOnce(ctx, task); err != nil && !errors.Is(err, ErrTaskAlreadyCompleted) {
				return err
			}
		}
	}
	return nil
}

func (p Poller) PollOnce(ctx context.Context, task domain.Task) error {
	if task.Status != domain.TaskRunning {
		return ErrTaskAlreadyCompleted
	}
	if p.Tasks == nil || p.Models == nil || p.Providers == nil || p.Objects == nil {
		return fmt.Errorf("shuihuo poller is not configured")
	}
	if task.Kind != "video" || task.Provider == "" || task.ModelID == nil || task.ModelVersionID == nil || task.ProviderTaskID == "" {
		return p.fail(ctx, task, "invalid_async_task", "视频异步任务快照不完整")
	}
	model, err := p.Models.GetVersion(ctx, *task.ModelID, *task.ModelVersionID)
	if err != nil {
		return p.fail(ctx, task, "model_unavailable", "视频模型不可用")
	}
	if model.Kind != models.KindVideo || model.AdapterKind != task.Provider {
		return p.fail(ctx, task, "invalid_async_task", "视频异步任务与模型适配器不匹配")
	}
	provider := p.Providers[task.Provider]
	if provider == nil {
		return p.fail(ctx, task, "provider_unavailable", "视频服务未配置")
	}
	result, err := provider.Poll(ctx, model, task.ProviderTaskID)
	if err != nil {
		return p.fail(ctx, task, "model_poll_failed", "视频任务查询失败")
	}
	switch result.State {
	case providers.AsyncVideoRunning:
		return p.Tasks.SetNextPoll(ctx, task.ID, p.now().Add(p.interval()))
	case providers.AsyncVideoFailed:
		return p.fail(ctx, task, "provider_task_failed", result.Message)
	case providers.AsyncVideoSucceeded:
		return p.persistResult(ctx, task, result)
	default:
		return p.fail(ctx, task, "invalid_provider_status", "视频服务返回未知状态")
	}
}

func (p Poller) persistResult(ctx context.Context, task domain.Task, result providers.AsyncVideoTask) error {
	download := p.DownloadResult
	if download == nil {
		download = downloadModelResult
	}
	body, contentType, err := download(ctx, result.ResultURL)
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

func (p Poller) fail(ctx context.Context, task domain.Task, code, message string) error {
	if message == "" {
		message = "视频生成失败"
	}
	if err := p.Tasks.SetFailure(ctx, task.ID, code, message); err != nil {
		return err
	}
	return p.Tasks.TransitionForWorker(ctx, task.ID, domain.TaskRunning, domain.TaskFailed, message)
}

func (p Poller) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now().UTC()
}

func (p Poller) interval() time.Duration {
	if p.Interval > 0 {
		return p.Interval
	}
	return defaultPollInterval
}
