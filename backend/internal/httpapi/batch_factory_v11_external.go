package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"qiantie/backend/internal/batchfactoryv11"
	"qiantie/backend/internal/batchfactoryv11/external"
)

type externalCredentialInput struct { Name string `json:"name"`; Secret string `json:"secret"` }
type externalIntentInput struct { BatchID string `json:"batchId"`; BookID string `json:"bookId"`; Payload json.RawMessage `json:"payload"` }

func registerExternalRoutes(mux *http.ServeMux, service *external.Service) {
	mux.HandleFunc("GET /api/batch-factory/v11/publish/{provider}/credential", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		ref, err := service.CredentialStatus(r.Context(), owner, r.PathValue("provider")); if err != nil { writeExternalError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"credential": ref})
	})
	mux.HandleFunc("PUT /api/batch-factory/v11/publish/{provider}/credential", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input externalCredentialInput; if !decodeJSON(w, r, &input) { return }
		ref, err := service.SaveCredential(r.Context(), owner, r.PathValue("provider"), external.CredentialInput{Name: input.Name, Secret: input.Secret}); if err != nil { writeExternalError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"credential": ref})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/publish/{provider}/intents", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		var input externalIntentInput; if !decodeJSON(w, r, &input) { return }
		intent, err := service.CreateIntent(r.Context(), owner, r.PathValue("provider"), input.BatchID, input.BookID, input.Payload); if err != nil { writeExternalError(w, err); return }
		writeJSON(w, http.StatusCreated, map[string]any{"intent": intent})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/publish/{provider}/intents/{intentId}/confirm", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		intent, err := service.ConfirmIntent(r.Context(), owner, r.PathValue("intentId")); if err != nil { writeExternalError(w, err); return }
		if string(intent.Provider) != strings.ToLower(strings.TrimSpace(r.PathValue("provider"))) { writeExternalError(w, external.ErrConflict); return }
		writeJSON(w, http.StatusOK, map[string]any{"intent": intent})
	})
	mux.HandleFunc("POST /api/batch-factory/v11/publish/{provider}/intents/{intentId}/submit", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		ref, err := service.Submit(r.Context(), owner, r.PathValue("provider"), r.PathValue("intentId")); if err != nil { writeExternalError(w, err); return }
		writeJSON(w, http.StatusOK, map[string]any{"reference": ref})
	})
	mux.HandleFunc("GET /api/batch-factory/v11/publish/{provider}/intents/{intentId}/audits", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := bridgeOwner(r); if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error":"unauthorized"}); return }
		if service.Audits == nil { writeExternalError(w, external.ErrUnavailable); return }
		provider := strings.ToLower(strings.TrimSpace(r.PathValue("provider")))
		audits, err := service.Audits.ListAudits(r.Context(), owner, r.PathValue("intentId")); if err != nil { writeExternalError(w, err); return }
		filtered := make([]external.AuditRecord, 0, len(audits)); for _, audit := range audits { if string(audit.Provider) == provider { filtered = append(filtered, audit) } }
		writeJSON(w, http.StatusOK, map[string]any{"audits": filtered})
	})
}

func writeExternalError(w http.ResponseWriter, err error) {
	status, message := http.StatusInternalServerError, "internal error"
	switch {
	case errors.Is(err, external.ErrUnavailable): status, message = http.StatusServiceUnavailable, "capability unavailable"
	case errors.Is(err, external.ErrNotFound), errors.Is(err, batchfactoryv11.ErrNotFound): status, message = http.StatusNotFound, "not found"
	case errors.Is(err, external.ErrConflict), errors.Is(err, external.ErrNotConfirmed): status, message = http.StatusConflict, "submission confirmation or ownership conflict"
	case errors.Is(err, external.ErrIntentExpired): status, message = http.StatusGone, "submission intent expired"
	case errors.Is(err, external.ErrInvalid): status, message = http.StatusBadRequest, "invalid input"
	}
	writeJSON(w, status, map[string]string{"error": message})
}
