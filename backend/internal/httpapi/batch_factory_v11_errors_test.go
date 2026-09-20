package httpapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"qiantie/backend/internal/batchfactoryv11"
)

func TestWriteStoreErrorKeepsSpecificConflictReason(t *testing.T) {
	rec := httptest.NewRecorder()
	writeStoreError(rec, fmt.Errorf("%w: current book has no failed stage", batchfactoryv11.ErrConflict))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "current book has no failed stage") {
		t.Fatalf("body must retain the actionable conflict reason, got %s", rec.Body.String())
	}
}
