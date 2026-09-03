package httpapi

import (
	"errors"
	"net/http"

	"qiantie/backend/internal/localexecutor"
)

func RegisterLocalExecutorJobRoutes(root *http.ServeMux, auth BridgeAuth, service *localexecutor.Service) {
	if root == nil || service == nil {
		return
	}

	root.Handle("POST /api/shuihuo-production/local-executor-jobs", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input localexecutor.CreateJobInput
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		job, err := service.CreateJob(req.Context(), identity.Username, input)
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusCreated, job)
	})))

	root.Handle("GET /api/shuihuo-production/local-executor-jobs/{id}", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
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
		writeExecutorJSON(w, http.StatusOK, job)
	})))

	root.Handle("PUT /api/shuihuo-production/local-executor-jobs/{id}/cancel", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		job, err := service.CancelJob(req.Context(), identity.Username, req.PathValue("id"))
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, job)
	})))

	root.HandleFunc("POST /api/local-executor/v1/jobs/claim", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		claim, err := service.ClaimJob(req.Context(), token)
		if errors.Is(err, localexecutor.ErrNoClaimableJob) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, claim)
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/renew", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input localexecutor.LeaseCredential
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		lease, err := service.RenewJob(req.Context(), token, req.PathValue("id"), input)
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, lease)
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/progress", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			localexecutor.LeaseCredential
			State localexecutor.JobState `json:"state"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err := service.RecordProgress(req.Context(), token, req.PathValue("id"), input.LeaseCredential, input.State); err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/acceptance", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			localexecutor.LeaseCredential
			AccountID    string `json:"accountId"`
			SubmissionID string `json:"submissionId"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		err := service.RecordAcceptance(req.Context(), token, req.PathValue("id"), input.LeaseCredential, localexecutor.AcceptanceInput{AccountID: input.AccountID, SubmissionID: input.SubmissionID})
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/release", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			localexecutor.LeaseCredential
			Reason string `json:"reason"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err := service.ReleaseJob(req.Context(), token, req.PathValue("id"), input.LeaseCredential, input.Reason); err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/fail", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			localexecutor.LeaseCredential
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		err := service.FailJob(req.Context(), token, req.PathValue("id"), input.LeaseCredential, localexecutor.FailureInput{Code: input.Code, Message: input.Message})
		if err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	root.HandleFunc("POST /api/local-executor/v1/jobs/{id}/result", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			localexecutor.LeaseCredential
			ArtifactID string `json:"artifactId"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err := service.CompleteJob(req.Context(), token, req.PathValue("id"), input.LeaseCredential, localexecutor.ResultInput{ArtifactID: input.ArtifactID}); err != nil {
			writeLocalJobError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func writeLocalJobError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, localexecutor.ErrInvalidPlatform), errors.Is(err, localexecutor.ErrInvalidInput):
		writeExecutorError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, localexecutor.ErrExecutorUnauthorized):
		writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
	case errors.Is(err, localexecutor.ErrJobNotFound):
		writeExecutorError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, localexecutor.ErrStaleLease), errors.Is(err, localexecutor.ErrJobCancelled), errors.Is(err, localexecutor.ErrAcceptedJobPinned), errors.Is(err, localexecutor.ErrInvalidJobState), errors.Is(err, localexecutor.ErrJobConflict):
		writeExecutorError(w, http.StatusConflict, err.Error())
	default:
		writeExecutorError(w, http.StatusInternalServerError, "local executor job service error")
	}
}
