package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ReleaseManifest 是服务器上的最新版本说明书（latest.json）。
// 执行器定期读取它，发现比自己新的版本就自动下载替换。
type ReleaseManifest struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
	URL     string `json:"url,omitempty"`
}

// SelfUpdater 负责执行器的自动更新：
// 定期拉取 latest.json → 版本比当前新且空闲时 → 下载 zip → SHA256 校验 →
// 解压到 .updates/<version>/ → 生成 apply-update.cmd → 通过 Apply 回调重启生效。
type SelfUpdater struct {
	// Root 是执行器 exe 所在目录，更新文件就绪后从这里覆盖回去。
	Root string
	// CurrentVersion 是当前运行版本（编译时注入，如 0.4.0）。
	CurrentVersion string
	// Origin 每次检查时调用，返回控制服务地址（如 http://115.190.156.223）。
	Origin func() string
	// HTTPClient 用于下载；nil 时用默认客户端。
	HTTPClient *http.Client
	// Idle 返回执行器当前是否空闲（没有在跑 OCR 任务）。
	Idle func() bool
	// Apply 在新版本就绪后被调用：主程序应停掉后台任务、启动 apply-update.cmd、退出。
	Apply func(nextVersion string)
}

const (
	checkInterval    = 30 * time.Minute
	firstCheckDelay  = time.Minute
	maxDownloadBytes = 128 << 20
)

// applyUpdateScript 是自动替换脚本。Windows 不允许覆盖正在运行的 exe，
// 所以由主程序启动这个脚本后退出；脚本等主程序进程消失后复制新文件并重启。
const applyUpdateScript = "@echo off\r\n" +
	"set \"APPDIR=%s\"\r\n" +
	"set \"NEWDIR=%s\"\r\n" +
	"set /a TRIES=0\r\n" +
	":waitloop\r\n" +
	"tasklist /FI \"IMAGENAME eq GiantMaterialExecutor.exe\" 2>nul | find /I \"GiantMaterialExecutor.exe\" >nul\r\n" +
	"if errorlevel 1 goto dopatch\r\n" +
	"set /a TRIES+=1\r\n" +
	"if %%TRIES%% GEQ 60 goto dopatch\r\n" +
	"ping -n 2 127.0.0.1 >nul\r\n" +
	"goto waitloop\r\n" +
	":dopatch\r\n" +
	"xcopy /E /I /Y \"%%NEWDIR%%\\*\" \"%%APPDIR%%\\\" >nul\r\n" +
	"cd /d \"%%APPDIR%%\"\r\n" +
	"start \"\" \"%%APPDIR%%\\GiantMaterialExecutor.exe\"\r\n"

func (u *SelfUpdater) manifestURL() string {
	return strings.TrimRight(u.Origin(), "/") + "/downloads/giant-material-executor/latest.json"
}

func (u *SelfUpdater) defaultZipURL() string {
	return strings.TrimRight(u.Origin(), "/") + "/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip"
}

// Run 周期性检查更新，直到 ctx 取消。第一次检查在启动一分钟后。
func (u *SelfUpdater) Run(ctx context.Context) {
	timer := time.NewTimer(firstCheckDelay)
	defer timer.Stop()
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-ticker.C:
		}
		if _, err := u.check(ctx); err != nil {
			log.Printf("self update check skipped: %v", err)
		}
	}
}

// CheckNow 立即检查并执行一次更新（配对页“检查更新”按钮触发）。
// 返回新版本号；已是最新时返回空字符串。
func (u *SelfUpdater) CheckNow(ctx context.Context) (string, error) {
	return u.check(ctx)
}

func (u *SelfUpdater) check(ctx context.Context) (string, error) {
	if u == nil || u.Apply == nil || u.Origin == nil || strings.TrimSpace(u.Origin()) == "" {
		return "", errors.New("self update is not configured")
	}
	if strings.TrimSpace(u.Root) == "" {
		return "", errors.New("self update root is not configured")
	}
	if u.Idle != nil && !u.Idle() {
		return "", errors.New("执行器正在跑任务，等空闲后再更新")
	}
	client := u.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	manifest, err := fetchManifest(ctx, client, u.manifestURL())
	if err != nil {
		return "", err
	}
	if !validVersion(manifest.Version) {
		return "", fmt.Errorf("manifest version %q is not a valid release version", manifest.Version)
	}
	if len(strings.TrimSpace(manifest.SHA256)) != 64 {
		return "", fmt.Errorf("manifest sha256 for %s is missing or malformed", manifest.Version)
	}
	if compareVersions(manifest.Version, u.CurrentVersion) <= 0 {
		return "", nil // 已经是最新版本，不用更新
	}
	if u.Idle != nil && !u.Idle() {
		return "", errors.New("executor busy; update deferred")
	}
	if err := u.stage(ctx, client, manifest); err != nil {
		return "", err
	}
	log.Printf("self update %s staged; applying now", manifest.Version)
	u.Apply(manifest.Version)
	return manifest.Version, nil
}

func fetchManifest(ctx context.Context, client *http.Client, url string) (ReleaseManifest, error) {
	var manifest ReleaseManifest
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return manifest, err
	}
	response, err := client.Do(req)
	if err != nil {
		return manifest, errors.New("无法连接更新清单地址：" + err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return manifest, fmt.Errorf("更新清单返回 HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return manifest, err
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, errors.New("更新清单不是合法的 JSON")
	}
	return manifest, nil
}

// stage 下载新版本 zip，校验 SHA256，解压到 .updates/<version>/，并生成 apply-update.cmd。
func (u *SelfUpdater) stage(ctx context.Context, client *http.Client, manifest ReleaseManifest) error {
	downloadURL := strings.TrimSpace(manifest.URL)
	if downloadURL == "" {
		downloadURL = u.defaultZipURL()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(req)
	if err != nil {
		return errors.New("下载新版本失败：" + err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("下载新版本返回 HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxDownloadBytes))
	if err != nil {
		return errors.New("下载新版本失败：" + err.Error())
	}
	sum := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(manifest.SHA256)) {
		return errors.New("新版本文件校验失败（SHA256 不匹配），已放弃更新")
	}
	stageDir := filepath.Join(u.Root, ".updates", manifest.Version)
	if err := os.RemoveAll(stageDir); err != nil {
		return err
	}
	if err := unzip(data, stageDir); err != nil {
		_ = os.RemoveAll(stageDir)
		return errors.New("解压新版本失败：" + err.Error())
	}
	script := fmt.Sprintf(applyUpdateScript, u.Root, stageDir)
	scriptPath := filepath.Join(u.Root, ".updates", "apply-update.cmd")
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return err
	}
	return nil
}

// unzip 把 zip 内容解到 dest 目录，拒绝条目路径逃出 dest。
func unzip(data []byte, dest string) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	dest = filepath.Clean(dest)
	for _, entry := range reader.File {
		name := filepath.FromSlash(strings.ReplaceAll(entry.Name, "\\", "/"))
		target := filepath.Join(dest, name)
		if !strings.HasPrefix(target, dest+string(os.PathSeparator)) {
			continue
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return err
		}
		content, err := io.ReadAll(io.LimitReader(source, maxDownloadBytes))
		_ = source.Close()
		if err != nil {
			return err
		}
		if err := os.WriteFile(target, content, 0o644); err != nil {
			return err
		}
	}
	return nil
}
