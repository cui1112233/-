package ui

import (
	"context"
	"errors"
	"strings"

	"qiantie/giant-material-executor/internal/agent"
)

type Config struct {
	Pair     func(context.Context, string) error
	Snapshot func() agent.Snapshot
	Shutdown func()
}

func validateConfig(config Config) error {
	if config.Pair == nil {
		return errors.New("executor UI pair callback is required")
	}
	if config.Snapshot == nil {
		return errors.New("executor UI snapshot callback is required")
	}
	return nil
}

func bindingStatusLabel(state agent.BindingState) string {
	switch strings.TrimSpace(string(state)) {
	case string(agent.BindingUnpaired):
		return "未绑定"
	case string(agent.BindingConnecting):
		return "连接中"
	case string(agent.BindingOnline):
		return "在线"
	case string(agent.BindingOffline):
		return "已绑定但离线"
	case string(agent.BindingNeedsPairing):
		return "需要重新绑定"
	default:
		return "未连接"
	}
}
