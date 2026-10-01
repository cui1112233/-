//go:build windows

package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sync"

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
	publicKey, err := update.PublicKeyFromBase64(bakedUpdatePublicKey)
	if err != nil {
		log.Printf("self update disabled: signed update key unavailable")
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
		PublicKey: publicKey,
		Target:    update.ReleaseTarget{Platform: "windows", Architecture: "amd64"},
		// Apply is assigned with the PID-scoped updater helper in Task 3. Until
		// then this is deliberately nil, so a signed check cannot revive the old
		// image-name-wide replacement script.
	}
	_ = stop
	go updater.Run(ctx)
	log.Printf("self update enabled root=%s current=%s", root, version)
	return updater
}
