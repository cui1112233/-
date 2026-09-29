package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"qiantie/giant-material-executor/internal/agent"
	"qiantie/giant-material-executor/internal/credential"
	"qiantie/giant-material-executor/internal/httpapi"
	"qiantie/giant-material-executor/internal/modelcache"
	"qiantie/giant-material-executor/internal/worker"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	nonce, err := loadOrCreateNonce()
	if err != nil {
		log.Fatalf("load executor nonce: %v", err)
	}
	publicURL := envOr("GIANT_MATERIAL_PUBLIC_API_URL", "http://127.0.0.1:4000")
	origin := envOr("GIANT_MATERIAL_EXECUTOR_ORIGIN", "http://127.0.0.1:5173")
	deviceName := envOr("GIANT_MATERIAL_EXECUTOR_DEVICE_NAME", localDeviceName())
	python := envOr("GIANT_MATERIAL_PYTHON", "python")
	script := envOr("GIANT_MATERIAL_WORKER_SCRIPT", filepath.Join(executableDir(), "worker", "ocr_worker.py"))
	supervisor := &worker.Supervisor{Command: []string{python, script}, Dir: filepath.Dir(script)}
	prepareModel := modelPreparer(supervisor)
	var stateMu sync.RWMutex
	var runningAgent *agent.Agent
	bindingState := agent.BindingUnpaired
	setBindingState := func(next agent.BindingState) {
		stateMu.Lock()
		bindingState = next
		stateMu.Unlock()
	}
	snapshot := func() agent.Snapshot {
		stateMu.RLock()
		defer stateMu.RUnlock()
		var current agent.Snapshot
		if runningAgent != nil {
			current = runningAgent.Snapshot()
		} else {
			current = agent.NewStateMachine().Snapshot()
		}
		current.BindingState = bindingState
		return current
	}
	publicClient := agent.NewHTTPClient(publicURL, http.DefaultClient)
	credentialStore, err := newCredentialStore()
	if err != nil {
		log.Fatalf("load executor credential store: %v", err)
	}
	startAgent := func(token string) {
		stateMu.Lock()
		if runningAgent != nil {
			stateMu.Unlock()
			return
		}
		bindingState = agent.BindingConnecting
		stateMu.Unlock()
		go func() {
			for {
				next, newErr := agent.New(agent.Config{
					Client:         publicClient,
					Supervisor:     supervisor,
					PrepareModel:   prepareModel,
					OnBindingState: setBindingState,
					Token:          token,
					DeviceName:     deviceName,
					OS:             "windows",
					Version:        version,
				})
				if newErr != nil {
					setBindingState(agent.BindingOffline)
					log.Printf("agent configuration failed: %v", newErr)
					return
				}
				stateMu.Lock()
				runningAgent = next
				stateMu.Unlock()
				runErr := next.Run(ctx)
				stateMu.Lock()
				if runningAgent == next {
					runningAgent = nil
				}
				stateMu.Unlock()
				if ctx.Err() != nil {
					return
				}
				if nextState := handleAgentRunError(credentialStore, runErr); nextState == agent.BindingNeedsPairing {
					setBindingState(nextState)
					log.Printf("executor credential rejected; pairing required")
					return
				}
				setBindingState(agent.BindingOffline)
				if runErr != nil {
					log.Printf("agent stopped; retrying connection: %v", runErr)
				}
				timer := time.NewTimer(5 * time.Second)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
					setBindingState(agent.BindingConnecting)
				}
			}
		}()
	}
	pair := func(pairCtx context.Context, code string) error {
		result, pairErr := publicClient.Pair(pairCtx, agent.PairInput{Code: code, DeviceName: deviceName, OS: "windows", Version: version, Platform: "giant_material"})
		if pairErr != nil {
			return pairErr
		}
		if strings.TrimSpace(result.Token) == "" {
			return &pairError{message: "public pair returned no executor token"}
		}
		if err := savePairResult(credentialStore, result); err != nil {
			return err
		}
		startAgent(result.Token)
		return nil
	}
	server, err := httpapi.NewServer(httpapi.ServerConfig{Addr: "127.0.0.1:17861", Origin: origin, Nonce: nonce, Version: version, Snapshot: snapshot, Callbacks: httpapi.Callbacks{Pair: pair}})
	if err != nil {
		log.Fatalf("create loopback server: %v", err)
	}
	if token := strings.TrimSpace(os.Getenv("GIANT_MATERIAL_EXECUTOR_TOKEN")); token != "" {
		startAgent(token)
	} else if record, loadErr := loadExecutorCredential(credentialStore); loadErr == nil {
		startAgent(record.Token)
	} else if !errors.Is(loadErr, credential.ErrNotFound) {
		log.Printf("saved executor credential unavailable; pairing required: %v", loadErr)
	}
	go func() {
		if serveErr := server.ListenAndServe(ctx); serveErr != nil && ctx.Err() == nil {
			log.Printf("loopback server stopped: %v", serveErr)
		}
	}()
	log.Printf("giant material executor started version=%s loopback=127.0.0.1:17861 workerResident=true", version)
	<-ctx.Done()
	log.Printf("giant material executor stopped")
}

func newCredentialStore() (credential.Store, error) {
	path := strings.TrimSpace(os.Getenv("GIANT_MATERIAL_EXECUTOR_CREDENTIAL_PATH"))
	if path == "" {
		root, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(root, "YizhanShengming", "GiantMaterialExecutor", "credential.bin")
	}
	return credential.NewProtectedStore(path), nil
}

func savePairResult(store credential.Store, result agent.PairResult) error {
	if store == nil {
		return errors.New("executor credential store is required")
	}
	return store.Save(credential.Record{ExecutorID: strings.TrimSpace(result.ExecutorID), Token: strings.TrimSpace(result.Token)})
}

func loadExecutorCredential(store credential.Store) (credential.Record, error) {
	if store == nil {
		return credential.Record{}, errors.New("executor credential store is required")
	}
	return store.Load()
}

func handleAgentRunError(store credential.Store, runErr error) agent.BindingState {
	if errors.Is(runErr, agent.ErrUnauthorized) {
		if store != nil {
			_ = store.Clear()
		}
		return agent.BindingNeedsPairing
	}
	return agent.BindingOffline
}

type pairError struct{ message string }

func (e *pairError) Error() string { return e.message }

func loadOrCreateNonce() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("GIANT_MATERIAL_EXECUTOR_NONCE")); configured != "" {
		return configured, nil
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, "YizhanShengming", "GiantMaterialExecutor", "nonce")
	if data, readErr := os.ReadFile(path); readErr == nil && strings.TrimSpace(string(data)) != "" {
		return strings.TrimSpace(string(data)), nil
	}
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	nonce := hex.EncodeToString(bytes)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(nonce+"\n"), 0o600); err != nil {
		return "", err
	}
	return nonce, nil
}

func executableDir() string {
	path, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(path)
}

func localDeviceName() string {
	if current, err := user.Current(); err == nil && strings.TrimSpace(current.Username) != "" {
		return current.Username
	}
	if hostname, err := os.Hostname(); err == nil && strings.TrimSpace(hostname) != "" {
		return hostname
	}
	return "windows-executor"
}

func modelPreparer(supervisor *worker.Supervisor) func(context.Context, string) error {
	manifestPath := strings.TrimSpace(os.Getenv("GIANT_MATERIAL_MODEL_MANIFEST"))
	if manifestPath == "" {
		return nil
	}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		log.Printf("OCR model manifest unavailable: %v", err)
		return func(context.Context, string) error { return err }
	}
	var manifest modelcache.Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		log.Printf("OCR model manifest invalid: %v", err)
		return func(context.Context, string) error { return err }
	}
	root := strings.TrimSpace(os.Getenv("GIANT_MATERIAL_MODEL_ROOT"))
	if root == "" {
		configRoot, configErr := os.UserConfigDir()
		if configErr != nil {
			return func(context.Context, string) error { return configErr }
		}
		root = filepath.Join(configRoot, "YizhanShengming", "GiantMaterialExecutor", "models")
	}
	return func(ctx context.Context, _ string) error {
		install, ensureErr := (modelcache.Cache{Root: root}).Ensure(ctx, manifest, func(progress modelcache.DownloadProgress) {
			log.Printf("OCR model download %d/%d (%d%%)", progress.Completed, progress.Total, progress.Percent)
		})
		if ensureErr != nil {
			return ensureErr
		}
		return supervisor.EnsureModel(ctx, install.Dir, install.Version)
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
