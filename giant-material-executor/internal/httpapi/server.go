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
	SetPublicURL func(string) error
	Pair         func(context.Context, string) error
	StartJob     func(context.Context, string) error
	GetJob       func(context.Context, string) (JobStatus, error)
	Cancel       func(context.Context, string) error
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
	mux.HandleFunc("GET /setup", s.setupPage)
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
		if req.Method == http.MethodGet && req.URL.Path == "/setup" {
			next.ServeHTTP(w, req)
			return
		}
		originOK := req.Header.Get("Origin") == s.config.Origin || req.Header.Get("Origin") == "http://"+s.config.Addr
		nonceOK := req.Header.Get("X-Giant-Executor-Nonce") == s.config.Nonce
		bootstrapPair := req.Method == http.MethodPost && req.URL.Path == "/v1/pair" && strings.TrimSpace(req.Header.Get("X-Giant-Executor-Nonce")) == ""
		localHealthProbe := req.Method == http.MethodGet && req.URL.Path == "/v1/health" && isLoopbackRemote(req.RemoteAddr)
		localSetupRequest := isLoopbackRemote(req.RemoteAddr) && sameHostPort(req.Host, s.config.Addr) && (req.URL.Path == "/v1/pair" || req.URL.Path == "/v1/health")
		if (!originOK && !localHealthProbe && !localSetupRequest) || (!nonceOK && !bootstrapPair && !localHealthProbe && !localSetupRequest) {
			writeError(w, http.StatusForbidden, "loopback origin or nonce rejected")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", s.config.Origin)
		w.Header().Set("Vary", "Origin")
		next.ServeHTTP(w, req)
	})
}

func isLoopbackRemote(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func sameHostPort(left, right string) bool {
	leftHost, leftPort, leftErr := net.SplitHostPort(strings.TrimSpace(left))
	rightHost, rightPort, rightErr := net.SplitHostPort(strings.TrimSpace(right))
	return leftErr == nil && rightErr == nil && leftHost == rightHost && leftPort == rightPort
}

func (s *Server) setupPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>巨量素材执行器</title><style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;background:#08151e;color:#e8f0f6;min-height:100vh;display:grid;place-items:center}.card{width:min(560px,calc(100vw - 40px));padding:32px;border:1px solid #20566d;border-radius:18px;background:#0d2230;box-sizing:border-box}h1{margin:0 0 8px;font-size:28px}.muted{color:#9bb1c0;line-height:1.6}label{display:block;margin-top:22px;font-weight:600}input{display:block;margin-top:8px;width:100%;height:42px;box-sizing:border-box;border:1px solid #326a80;border-radius:9px;background:#071720;color:#f6fbff;padding:0 12px;font-size:15px}button{margin-top:24px;width:100%;height:44px;border:0;border-radius:9px;background:#64dfc0;color:#062119;font-size:16px;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#status{margin-top:18px;padding:12px;border-radius:8px;background:#102c3b;color:#b7cbd7;white-space:pre-wrap}.error{background:#3b1820!important;color:#ffc1c7!important}.ok{background:#10382d!important;color:#abf4d9!important}</style></head>
<body><main class="card"><h1>巨量素材执行器</h1><p class="muted">填写平台控制服务地址与网页生成的配对码。绑定完成后，执行器会继续在后台运行。</p>
<form id="pairForm"><label for="publicURL">控制服务地址</label><input id="publicURL" name="publicURL" autocomplete="url" placeholder="https://你的平台域名" required><label for="code">配对码</label><input id="code" name="code" autocomplete="one-time-code" placeholder="例如 ABCDE-12345" required><button id="submit" type="submit">绑定执行器</button></form><div id="status">正在检查本机执行器状态…</div></main>
<script>const status=document.getElementById('status'),submit=document.getElementById('submit');function setStatus(message,kind=''){status.textContent=message;status.className=kind}async function health(){try{const r=await fetch('/v1/health');if(!r.ok)throw new Error();const d=await r.json();if(d.bindingState==='online')setStatus('已绑定并在线，执行器正在后台等待任务。','ok');else if(!submit.disabled)setStatus('执行器已启动，请填写地址和配对码。')}catch{if(!submit.disabled)setStatus('执行器已启动；等待绑定。')}}document.getElementById('pairForm').addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;setStatus('正在绑定，请保持此页面打开…');try{const r=await fetch('/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicURL:document.getElementById('publicURL').value.trim(),code:document.getElementById('code').value.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error||'绑定失败');setStatus('绑定成功，执行器正在连接后台。','ok');document.getElementById('code').value=''}catch(err){setStatus('绑定失败：'+err.message,'error')}finally{submit.disabled=false}});health();setInterval(health,1000);</script></body></html>`))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.config.Snapshot()
	modelReady := snapshot.State != agent.StateDownloadingModel
	if s.config.ModelReady != nil {
		modelReady = s.config.ModelReady()
	}
	writeJSON(w, http.StatusOK, map[string]any{"online": true, "version": s.config.Version, "state": snapshot.State, "bindingState": snapshot.BindingState, "modelReady": modelReady, "workerResident": snapshot.WorkerResident})
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
		PublicURL string `json:"publicURL"`
		Code      string `json:"code"`
	}
	if err := decodeJSON(w, req, &input); err != nil || strings.TrimSpace(input.Code) == "" {
		writeError(w, http.StatusBadRequest, "pairing code is required")
		return
	}
	if s.config.Callbacks.Pair == nil {
		writeError(w, http.StatusNotImplemented, "pairing is not configured")
		return
	}
	if publicURL := strings.TrimSpace(input.PublicURL); publicURL != "" && s.config.Callbacks.SetPublicURL != nil {
		if err := s.config.Callbacks.SetPublicURL(publicURL); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
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
