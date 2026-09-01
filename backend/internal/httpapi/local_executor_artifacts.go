package httpapi

import (
	"errors"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"qiantie/backend/internal/localartifact"
	"qiantie/backend/internal/localexecutor"
)

func RegisterLocalExecutorArtifactRoutes(root *http.ServeMux, auth BridgeAuth, service *localexecutor.Service, files *localartifact.Store) {
	if root == nil || service == nil || files == nil {
		return
	}

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/artifact", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		mediaType, _, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
		if err != nil || strings.ToLower(mediaType) != "video/mp4" {
			writeExecutorError(w, http.StatusBadRequest, "artifact must be video/mp4")
			return
		}
		generation, err := strconv.ParseInt(strings.TrimSpace(req.Header.Get("X-Lease-Generation")), 10, 64)
		if err != nil || generation < 1 {
			writeExecutorError(w, http.StatusBadRequest, "invalid lease generation")
			return
		}
		lease := localexecutor.LeaseCredential{
			Token: strings.TrimSpace(req.Header.Get("X-Lease-Token")),
			Generation: generation,
		}
		if lease.Token == "" {
			writeExecutorError(w, http.StatusBadRequest, "missing lease token")
			return
		}
		jobID := req.PathValue("id")
		if err := service.RecordProgress(req.Context(), token, jobID, lease, localexecutor.JobUploading); err != nil {
			writeLocalJobError(w, err)
			return
		}

		artifactID, err := localexecutor.NewArtifactID()
		if err != nil {
			writeExecutorError(w, http.StatusInternalServerError, "artifact id generation failed")
			return
		}
		saved, err := files.SaveMP4(artifactID, req.Body)
		if err != nil {
			writeArtifactStoreError(w, err)
			return
		}

		bound, err := service.RecordArtifact(req.Context(), token, jobID, lease, localexecutor.ArtifactInput{
			ID: saved.ID, MediaType: saved.MediaType, ByteSize: saved.ByteSize,
			SHA256: saved.SHA256, StorageRef: saved.StorageRef,
		})
		if err != nil {
			_ = files.Remove(saved.StorageRef)
			writeLocalJobError(w, err)
			return
		}
		status := http.StatusCreated
		if bound.ID != saved.ID {
			_ = files.Remove(saved.StorageRef)
			status = http.StatusOK
		}
		writeExecutorJSON(w, status, bound)
	})

	root.Handle("GET /api/shuihuo-production/local-executor-artifacts/{id}", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		artifact, err := service.GetArtifact(req.Context(), identity.Username, req.PathValue("id"))
		if err != nil {
			writeLocalJobError(w, err)
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

func writeArtifactStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, localartifact.ErrInvalidMP4), errors.Is(err, localartifact.ErrInvalidID):
		writeExecutorError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, localartifact.ErrTooLarge):
		writeExecutorError(w, http.StatusRequestEntityTooLarge, err.Error())
	case errors.Is(err, localartifact.ErrAlreadyExists):
		writeExecutorError(w, http.StatusConflict, err.Error())
	default:
		writeExecutorError(w, http.StatusInternalServerError, "artifact storage error")
	}
}
