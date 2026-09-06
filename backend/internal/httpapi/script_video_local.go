package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
)

func RegisterScriptVideoLocalRoutes(root *http.ServeMux, auth BridgeAuth, service *localexecutor.Service, files *localartifact.Store) {
	if root == nil || service == nil {
		return
	}

	root.Handle("POST /api/script-videos/local", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			Prompt string `json:"prompt"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		prompt := strings.TrimSpace(input.Prompt)
		if prompt == "" {
			writeExecutorError(w, http.StatusBadRequest, "video prompt is required")
			return
		}
		sourceTaskID, err := newScriptVideoSourceID()
		if err != nil {
			writeExecutorError(w, http.StatusInternalServerError, "script video task id generation failed")
			return
		}
		job, err := service.CreateJob(req.Context(), identity.Username, localexecutor.CreateJobInput{
			SourceTaskID: sourceTaskID,
			Platform:     localexecutor.PlatformDoubao,
			Payload:      map[string]any{"prompt": prompt},
		})
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusCreated, scriptVideoJobResponse(job))
	})))

	root.Handle("GET /api/script-videos/{id}", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		job, err := service.GetJob(req.Context(), identity.Username, req.PathValue("id"))
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, scriptVideoJobResponse(job))
	})))

	if files != nil {
		root.Handle("GET /api/script-videos/{id}/download", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			identity, ok := BridgeIdentityFromContext(req.Context())
			if !ok {
				writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			job, err := service.GetJob(req.Context(), identity.Username, req.PathValue("id"))
			if err != nil {
				writeLocalJobError(w, err)
				return
			}
			if job.State != localexecutor.JobSucceeded || strings.TrimSpace(job.ArtifactID) == "" {
				writeExecutorError(w, http.StatusConflict, "script video is not ready")
				return
			}
			artifact, err := service.GetArtifact(req.Context(), identity.Username, job.ArtifactID)
			if err != nil {
				writeArtifactDomainError(w, err)
				return
			}
			file, err := files.Open(artifact.StorageRef)
			if err != nil {
				if errors.Is(err, localartifact.ErrInvalidID) {
					writeExecutorError(w, http.StatusInternalServerError, "invalid artifact storage reference")
					return
				}
				writeExecutorError(w, http.StatusNotFound, "artifact file not found")
				return
			}
			defer file.Close()
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.ServeContent(w, req, artifact.ID+".mp4", artifact.CreatedAt, file)
		})))
	}
}

func scriptVideoJobResponse(job localexecutor.JobView) map[string]any {
	status := "processing"
	response := map[string]any{
		"ok":     true,
		"taskId": job.ID,
		"status": status,
		"stage":  string(job.State),
	}

	switch job.State {
	case localexecutor.JobSucceeded:
		response["status"] = "succeeded"
		response["videoUrl"] = "/api/script-video/" + url.PathEscape(job.ID) + "/download"
	case localexecutor.JobFailed:
		response["status"] = "failed"
		response["error"] = firstNonBlank(job.ErrorMessage, "视频生成失败")
	case localexecutor.JobCancelled:
		response["status"] = "failed"
		response["error"] = "视频任务已取消"
	}
	if job.ErrorCode != "" {
		response["errorCode"] = job.ErrorCode
	}
	return response
}

func newScriptVideoSourceID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "script-video-" + hex.EncodeToString(raw), nil
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
