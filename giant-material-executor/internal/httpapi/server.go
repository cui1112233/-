package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"qiantie/giant-material-executor/internal/agent"
)

type JobStatus struct {
	ID           string         `json:"id"`
	State        agent.State    `json:"state"`
	Progress     agent.Progress `json:"progress"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
}

type ServerConfig struct {
	Addr       string
	Origin     string
	Nonce      string
	Version    string
	Snapshot   func() agent.Snapshot
	ModelReady func() bool
	Callbacks  Callbacks
}

type Callbacks struct {
	Pair     func(context.Context, string) error
	StartJob func(context.Context, string) error
	GetJob   func(context.Context, string) (JobStatus, error)
	Cancel   func(context.Context, string) error
}

type Server struct {
	config ServerConfig
}

func NewServer(config ServerConfig) (*Server, error) {
	if err := validateLoopbackAddr(config.Addr); err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.Origin) == "" || strings.TrimSpace(config.Nonce) == "" {
		return nil, errors.New("loopback origin and nonce are required")
	}
	if config.Snapshot == nil {
		config.Snapshot = func() agent.Snapshot { return agent.Snapshot{State: agent.StateIdle, WorkerResident: true} }
	}
	return &Server{config: config}, nil
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.config.Addr)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: s.Handler()}
	go func() {
		<-ctx.Done()
		_ = server.Shutdown(context.Background())
	}()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", s.health)
	mux.HandleFunc("GET /v1/capabilities", s.capabilities)
	mux.HandleFunc("POST /v1/pair", s.pair)
	mux.HandleFunc("POST /v1/jobs", s.startJob)
	mux.HandleFunc("GET /v1/jobs/{id}", s.getJob)
	mux.HandleFunc("POST /v1/jobs/{id}/cancel", s.cancelJob)
	return s.guard(mux)
}

func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		originOK := req.Header.Get("Origin") == s.config.Origin
		nonceOK := req.Header.Get("X-Giant-Executor-Nonce") == s.config.Nonce
		bootstrapPair := req.Method == http.MethodPost && req.URL.Path == "/v1/pair" && strings.TrimSpace(req.Header.Get("X-Giant-Executor-Nonce")) == ""
		if !originOK || (!nonceOK && !bootstrapPair) {
			writeError(w, http.StatusForbidden, "loopback origin or nonce rejected")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", s.config.Origin)
		w.Header().Set("Vary", "Origin")
		next.ServeHTTP(w, req)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.config.Snapshot()
	modelReady := snapshot.State != agent.StateDownloadingModel
	if s.config.ModelReady != nil {
		modelReady = s.config.ModelReady()
	}
	writeJSON(w, http.StatusOK, map[string]any{"online": true, "version": s.config.Version, "state": snapshot.State, "modelReady": modelReady, "workerResident": snapshot.WorkerResident})
}

func (s *Server) capabilities(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.config.Snapshot()
	modelReady := snapshot.State != agent.StateDownloadingModel
	if s.config.ModelReady != nil {
		modelReady = s.config.ModelReady()
	}
	writeJSON(w, http.StatusOK, map[string]any{"platform": "windows", "ocr": true, "modelVersion": snapshot.ModelVersion, "modelReady": modelReady})
}

func (s *Server) pair(w http.ResponseWriter, req *http.Request) {
	var input struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, req, &input); err != nil || strings.TrimSpace(input.Code) == "" {
		writeError(w, http.StatusBadRequest, "pairing code is required")
		return
	}
	if s.config.Callbacks.Pair == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not configured")
		return
	}
	if err := s.config.Callbacks.Pair(req.Context(), strings.TrimSpace(input.Code)); err != nil {
		writeError(w, http.StatusConflict, "pairing failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"paired": true, "nonce": s.config.Nonce})
}

func (s *Server) startJob(w http.ResponseWriter, req *http.Request) {
	var input struct {
		JobID string `json:"jobId"`
	}
	if err := decodeJSON(w, req, &input); err != nil || strings.TrimSpace(input.JobID) == "" {
		writeError(w, http.StatusBadRequest, "jobId is required")
		return
	}
	if s.config.Callbacks.StartJob == nil {
		writeError(w, http.StatusNotImplemented, "job start is not configured")
		return
	}
	if err := s.config.Callbacks.StartJob(req.Context(), strings.TrimSpace(input.JobID)); err != nil {
		writeError(w, http.StatusConflict, "job start failed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": strings.TrimSpace(input.JobID), "accepted": true})
}

func (s *Server) getJob(w http.ResponseWriter, req *http.Request) {
	if s.config.Callbacks.GetJob == nil {
		writeError(w, http.StatusNotImplemented, "job status is not configured")
		return
	}
	job, err := s.config.Callbacks.GetJob(req.Context(), req.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) cancelJob(w http.ResponseWriter, req *http.Request) {
	if s.config.Callbacks.Cancel == nil {
		writeError(w, http.StatusNotImplemented, "job cancellation is not configured")
		return
	}
	if err := s.config.Callbacks.Cancel(req.Context(), req.PathValue("id")); err != nil {
		writeError(w, http.StatusConflict, "job cancellation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cancelled": true})
}

func validateLoopbackAddr(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host != "127.0.0.1" {
		return fmt.Errorf("loopback server must bind to 127.0.0.1: %s", addr)
	}
	return nil
}

func decodeJSON(w http.ResponseWriter, req *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 2<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
