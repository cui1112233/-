package mergeworker

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
)

type Handler struct {
	apiKey string
	store  Store
	queue  Queue
}

func NewHandler(apiKey string, store Store, queue Queue) *Handler {
	return &Handler{apiKey: strings.TrimSpace(apiKey), store: store, queue: queue}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if r.URL.Path == "/v1/merge" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		h.submit(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/merge/") {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		h.poll(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func (h *Handler) authorized(r *http.Request) bool {
	if h == nil || h.apiKey == "" {
		return false
	}
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	candidate := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	return len(candidate) == len(h.apiKey) && subtle.ConstantTimeCompare([]byte(candidate), []byte(h.apiKey)) == 1
}

func (h *Handler) submit(w http.ResponseWriter, r *http.Request) {
	if h.store == nil || h.queue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "merge worker unavailable"})
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	var request SubmitRequest
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid merge request"})
		return
	}
	if err := validateSubmitRequest(request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	id, err := newTaskID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create merge task"})
		return
	}
	mode := normalizeTimingMode(request.TimingMode)
	speed := request.Speed
	if mode == "speed" && speed == 0 {
		speed = 1
	}
	job := Job{
		ID:                   id,
		BatchID:              strings.TrimSpace(request.BatchID),
		Status:               StateQueued,
		Sources:              append([]Source(nil), request.Sources...),
		TimingMode:           mode,
		Speed:                speed,
		TTSSpeed:             normalizeSpeed(request.TTSSpeed, 1.7),
		AudioDurationSeconds: request.AudioDurationSeconds,
	}
	job, err = h.store.Create(r.Context(), job)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not persist merge task"})
		return
	}
	if err := h.queue.Enqueue(r.Context(), job.ID); err != nil {
		job.Status = StateFailed
		job.ErrorMessage = "could not queue merge task"
		_, _ = h.store.Update(r.Context(), job)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": job.ErrorMessage})
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (h *Handler) poll(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "merge worker unavailable"})
		return
	}
	id := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/merge/"))
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	job, err := h.store.Get(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read merge task"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func validateSubmitRequest(request SubmitRequest) error {
	if strings.TrimSpace(request.BatchID) == "" {
		return fmt.Errorf("batchId is required")
	}
	if len(request.Sources) == 0 || len(request.Sources) > 200 {
		return fmt.Errorf("sources must contain between 1 and 200 items")
	}
	for index, source := range request.Sources {
		if strings.TrimSpace(source.ProductionJobID) == "" || strings.TrimSpace(source.VideoID) == "" || strings.TrimSpace(source.MediaURL) == "" {
			return fmt.Errorf("source identity and mediaUrl are required")
		}
		if source.Order != index {
			return fmt.Errorf("source order must be contiguous")
		}
		parsed, err := url.ParseRequestURI(strings.TrimSpace(source.MediaURL))
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return fmt.Errorf("source mediaUrl must be a safe https URL")
		}
	}
	mode := normalizeTimingMode(request.TimingMode)
	if mode != "speed" && mode != "audio" {
		return fmt.Errorf("unsupported timingMode")
	}
	if request.Speed != 0 && (math.IsNaN(request.Speed) || math.IsInf(request.Speed, 0) || request.Speed < 0.25 || request.Speed > 4) {
		return fmt.Errorf("speed must be between 0.25 and 4")
	}
	if mode == "audio" && request.AudioDurationSeconds <= 0 {
		return fmt.Errorf("audioDurationSeconds must be positive for audio timing")
	}
	if math.IsNaN(request.AudioDurationSeconds) || math.IsInf(request.AudioDurationSeconds, 0) || request.AudioDurationSeconds < 0 {
		return fmt.Errorf("audioDurationSeconds is invalid")
	}
	if speed := normalizeSpeed(request.TTSSpeed, 1.7); speed < 0.5 || speed > 4 {
		return fmt.Errorf("ttsSpeed must be between 0.5 and 4")
	}
	return nil
}

func normalizeTimingMode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "speed"
	}
	return value
}

func normalizeSpeed(value, fallback float64) float64 {
	if value == 0 {
		return fallback
	}
	return value
}

func newTaskID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "merge-task-" + hex.EncodeToString(raw[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
