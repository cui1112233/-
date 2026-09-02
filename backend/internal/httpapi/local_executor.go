package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"qiantie/backend/internal/localexecutor"
)

const localExecutorBodyLimit = 64 << 10

func RegisterLocalExecutorRoutes(root *http.ServeMux, auth BridgeAuth, service *localexecutor.Service) {
	if root == nil || service == nil {
		return
	}
	root.Handle("GET /api/shuihuo-production/local-executors", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		executors, err := service.List(req.Context(), identity.Username)
		if err != nil {
			writeExecutorServiceError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"executors": executors, "items": executors})
	})))

	root.Handle("POST /api/shuihuo-production/local-executors/pairings", auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		identity, ok := BridgeIdentityFromContext(req.Context())
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input struct {
			Platform string `json:"platform"`
		}
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		pairing, err := service.CreatePairing(req.Context(), identity.Username, input.Platform)
		if err != nil {
			writeExecutorServiceError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusCreated, pairing)
	})))

	root.HandleFunc("POST /api/local-executor/v1/pair", func(w http.ResponseWriter, req *http.Request) {
		var input localexecutor.PairInput
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		result, err := service.Pair(req.Context(), input)
		if err != nil {
			writeExecutorServiceError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, result)
	})

	root.HandleFunc("POST /api/local-executor/v1/heartbeat", func(w http.ResponseWriter, req *http.Request) {
		token, ok := executorBearerToken(req)
		if !ok {
			writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		var input localexecutor.HeartbeatInput
		if err := decodeExecutorJSON(w, req, &input); err != nil {
			writeExecutorError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err := service.Heartbeat(req.Context(), token, input); err != nil {
			writeExecutorServiceError(w, err)
			return
		}
		writeExecutorJSON(w, http.StatusOK, map[string]any{"ok": true, "heartbeatIntervalSeconds": localexecutor.HeartbeatIntervalSeconds})
	})
}

func executorBearerToken(req *http.Request) (string, bool) {
	parts := strings.Fields(req.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", false
	}
	return parts[1], true
}

func decodeExecutorJSON(w http.ResponseWriter, req *http.Request, target any) error {
	req.Body = http.MaxBytesReader(w, req.Body, localExecutorBodyLimit)
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("multiple json values")
	}
	return nil
}

func writeExecutorServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, localexecutor.ErrInvalidPlatform), errors.Is(err, localexecutor.ErrInvalidInput), errors.Is(err, localexecutor.ErrInvalidAccountStats):
		writeExecutorError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, localexecutor.ErrPairingInvalid):
		writeExecutorError(w, http.StatusConflict, err.Error())
	case errors.Is(err, localexecutor.ErrExecutorUnauthorized):
		writeExecutorError(w, http.StatusUnauthorized, "unauthorized")
	default:
		writeExecutorError(w, http.StatusInternalServerError, "local executor service error")
	}
}

func writeExecutorError(w http.ResponseWriter, status int, message string) {
	writeExecutorJSON(w, status, map[string]any{"error": message})
}

func writeExecutorJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
