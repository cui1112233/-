package batchfactoryv11

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

const (
	VideoProviderPersonalAPI       = "personal_api"
	VideoProviderDoubaoLocal       = "doubao_local_executor"
	VideoProviderAutoDLComfyUI     = "autodl_comfyui"
	PersonalVideoProviderID        = "yd_video"
	DefaultPersonalVideoModel      = "yd2.0-mini"
	DefaultPersonalVideoCreateURL  = "https://ydapi.yadiai.cn/openapi/v1/video/create"
	DefaultPersonalVideoTasksURL   = "https://ydapi.yadiai.cn/openapi/v1/video/tasks"
)

type VideoProviderConfig struct {
	Provider     string
	APIKey       string
	Model        string
	CreateURL    string
	TasksURL     string
	ResultURL    string
}

type VideoProviderRegistry interface {
	Put(context.Context, string, VideoProviderConfig) error
	Resolve(context.Context, string, string) (VideoProviderConfig, error)
	View(context.Context, string, string) (VideoProviderConfigView, error)
}

type VideoProviderConfigView struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Configured bool   `json:"configured"`
}

type MemoryVideoProviderRegistry struct {
	mu      sync.RWMutex
	values  map[string]VideoProviderConfig
}

func NewMemoryVideoProviderRegistry() *MemoryVideoProviderRegistry {
	return &MemoryVideoProviderRegistry{values: map[string]VideoProviderConfig{}}
}

func (r *MemoryVideoProviderRegistry) Put(_ context.Context, owner string, cfg VideoProviderConfig) error {
	if r == nil {
		return ErrUnavailable
	}
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	cfg.Provider = normalizeVideoProvider(cfg.Provider)
	switch cfg.Provider {
	case VideoProviderPersonalAPI:
		cfg.Model = strings.TrimSpace(cfg.Model)
		if cfg.Model == "" {
			cfg.Model = DefaultPersonalVideoModel
		}
		cfg.APIKey = strings.TrimSpace(cfg.APIKey)
		if cfg.APIKey == "" {
			return fmt.Errorf("%w: personal video API key is required", ErrInvalid)
		}
		if strings.TrimSpace(cfg.CreateURL) == "" {
			cfg.CreateURL = DefaultPersonalVideoCreateURL
		}
		if strings.TrimSpace(cfg.TasksURL) == "" {
			cfg.TasksURL = DefaultPersonalVideoTasksURL
		}
		if strings.TrimSpace(cfg.ResultURL) == "" {
			cfg.ResultURL = strings.TrimRight(cfg.TasksURL, "/") + "/{id}/result"
		}
	case VideoProviderDoubaoLocal:
		cfg.APIKey = ""
		cfg.Model = strings.TrimSpace(cfg.Model)
		if cfg.Model == "" {
			cfg.Model = "doubao-seedance"
		}
	default:
		return fmt.Errorf("%w: unsupported video provider", ErrInvalid)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.values[owner+"\x00"+cfg.Provider] = cfg
	return nil
}

func (r *MemoryVideoProviderRegistry) Resolve(_ context.Context, owner, provider string) (VideoProviderConfig, error) {
	if r == nil {
		return VideoProviderConfig{}, ErrUnavailable
	}
	owner = strings.TrimSpace(owner)
	provider = normalizeVideoProvider(provider)
	if owner == "" {
		return VideoProviderConfig{}, fmt.Errorf("%w: owner is required", ErrInvalid)
	}
	if provider == "" {
		provider = VideoProviderPersonalAPI
	}
	r.mu.RLock()
	cfg, ok := r.values[owner+"\x00"+provider]
	r.mu.RUnlock()
	if !ok {
		return VideoProviderConfig{}, fmt.Errorf("%w: video provider is not configured", ErrUnavailable)
	}
	return cfg, nil
}

func (r *MemoryVideoProviderRegistry) View(_ context.Context, owner, provider string) (VideoProviderConfigView, error) {
	cfg, err := r.Resolve(context.Background(), owner, provider)
	if err != nil {
		return VideoProviderConfigView{Provider: normalizeVideoProvider(provider)}, err
	}
	return VideoProviderConfigView{Provider: cfg.Provider, Model: cfg.Model, Configured: strings.TrimSpace(cfg.APIKey) != "" || cfg.Provider == VideoProviderDoubaoLocal}, nil
}

func normalizeVideoProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", "personal", "personal_api", "yd_video", "yadi":
		return VideoProviderPersonalAPI
	case "doubao", "doubao_local", "doubao_local_executor", "local-doubao-executor-video":
		return VideoProviderDoubaoLocal
	case "autodl", "autodl_comfyui":
		return VideoProviderAutoDLComfyUI
	default:
		return strings.ToLower(strings.TrimSpace(provider))
	}
}

// NormalizeVideoProviderForHTTP normalizes provider names accepted by HTTP clients.
func NormalizeVideoProviderForHTTP(provider string) string { return normalizeVideoProvider(provider) }
