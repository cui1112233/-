//go:build windows

package ui

import (
	"context"
	"errors"
	"os/exec"
)

const setupURL = "http://127.0.0.1:17861/setup"

// Run starts the resident executor UI in the user's default browser. The
// executor itself remains a small background EXE; the browser handles text
// input, button clicks, and readable error/status rendering.
func Run(ctx context.Context, config Config) error {
	if err := validateConfig(config); err != nil {
		return err
	}
	if err := openSetupPage(); err != nil {
		return err
	}
	<-ctx.Done()
	return nil
}

func openSetupPage() error {
	if err := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", setupURL).Start(); err != nil {
		return errors.New("无法打开执行器配对页面：" + err.Error())
	}
	return nil
}
