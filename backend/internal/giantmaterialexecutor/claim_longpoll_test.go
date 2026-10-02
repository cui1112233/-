package giantmaterialexecutor

import (
	"context"
	"errors"
	"testing"
	"time"
)

// 长轮询：没活时请求在服务器侧等待，任务在等待期间出现后要立刻领到，
// 不能让执行器每秒空敲门。
func TestClaimLongPollReturnsWhenJobArrives(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 11, 0, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.5.3")
	heartbeatExecutorVersion(t, service, token, "windows", "win-box", "0.5.3")

	originalInterval := claimLongPollInterval
	claimLongPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { claimLongPollInterval = originalInterval })

	go func() {
		time.Sleep(25 * time.Millisecond)
		if _, err := service.CreateJob(context.Background(), "alice", testJobInput("m-lp1", "b-lp1")); err != nil {
			t.Errorf("create job: %v", err)
		}
	}()

	start := time.Now()
	claim, err := service.ClaimWhenAvailable(context.Background(), token, time.Second)
	if err != nil {
		t.Fatalf("long poll claim err=%v", err)
	}
	if claim.Job.MaterialID != "m-lp1" {
		t.Fatalf("claimed unexpected job %+v", claim.Job)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("long poll took %v, job should be claimed near immediately", elapsed)
	}
}

// 等待窗口内一直没活：到点返回 ErrNoClaimableJob，且不会无限挂住请求。
func TestClaimLongPollTimesOutWithNoJob(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 11, 5, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.5.3")
	heartbeatExecutorVersion(t, service, token, "windows", "win-box", "0.5.3")

	originalInterval := claimLongPollInterval
	claimLongPollInterval = 5 * time.Millisecond
	t.Cleanup(func() { claimLongPollInterval = originalInterval })

	start := time.Now()
	_, err := service.ClaimWhenAvailable(context.Background(), token, 30*time.Millisecond)
	if !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("err=%v want ErrNoClaimableJob", err)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("long poll timeout took %v", elapsed)
	}
}

// wait<=0 保持旧行为：立刻返回，不等。
func TestClaimLongPollZeroWaitIsImmediate(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 11, 10, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.5.3")
	heartbeatExecutorVersion(t, service, token, "windows", "win-box", "0.5.3")

	_, err := service.ClaimWhenAvailable(context.Background(), token, 0)
	if !errors.Is(err, ErrNoClaimableJob) {
		t.Fatalf("err=%v want ErrNoClaimableJob", err)
	}
}

// 等待期间客户端断开（ctx 取消）要立刻退出，不能继续占着数据库翻查。
func TestClaimLongPollStopsOnContextCancel(t *testing.T) {
	clock := &testClock{now: time.Date(2026, 10, 1, 11, 15, 0, 0, time.UTC)}
	service := NewService(NewMemoryStore(), clock.Now)
	token := pairExecutorVersion(t, service, "alice", "windows", "win-box", "0.5.3")
	heartbeatExecutorVersion(t, service, token, "windows", "win-box", "0.5.3")

	originalInterval := claimLongPollInterval
	claimLongPollInterval = 50 * time.Millisecond
	t.Cleanup(func() { claimLongPollInterval = originalInterval })

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	_, err := service.ClaimWhenAvailable(ctx, token, 5*time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v want context.Canceled", err)
	}
}
