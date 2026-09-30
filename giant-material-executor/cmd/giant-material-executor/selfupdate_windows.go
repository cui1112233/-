//go:build windows

package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"

	"qiantie/giant-material-executor/internal/agent"
	"qiantie/giant-material-executor/internal/update"
)

func startSelfUpdater(ctx context.Context, stop context.CancelFunc, snapshot func() agent.Snapshot, originMu *sync.RWMutex, origin *string) *update.SelfUpdater {
	root := ""
	if exe, err := os.Executable(); err == nil {
		root = filepath.Dir(exe)
	}
	if root == "" {
		log.Printf("self update disabled: executable path unavailable")
		return nil
	}
	updater := &update.SelfUpdater{
		Root:           root,
		CurrentVersion: version,
		Origin: func() string {
			originMu.RLock()
			defer originMu.RUnlock()
			return *origin
		},
		Idle: func() bool {
			state := snapshot().State
			return state == agent.StateReady || state == agent.StateFailed || state == agent.StateIdle
		},
		Apply: func(nextVersion string) {
			log.Printf("self update %s ready; restarting executor", nextVersion)
			applyPath := filepath.Join(root, ".updates", "apply-update.cmd")
			command := exec.Command("cmd", "/C", applyPath)
			// Start the handoff script before stopping this process.
			command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
			if err := command.Start(); err != nil {
				log.Printf("start apply-update.cmd failed: %v; keep running on %s", err, version)
				return
			}
			log.Printf("apply-update.cmd started; exiting for update")
			stop()
		},
	}
	go updater.Run(ctx)
	log.Printf("self update enabled root=%s current=%s", root, version)
	return updater
}
