package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestV11CapabilitiesRejectUnsignedRequest(t *testing.T) {
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return time.Unix(1700000000, 0) }})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/capabilities", nil)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestV11CapabilitiesAreFalseBeforeSliceOne(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/capabilities", nil)
	SignBridgeRequest(req, "alpha-user", false, now, "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"settings.edit":{"available":false`) {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestV11CapabilitiesRejectExpiredSignature(t *testing.T) {
	now := time.Unix(1700000000, 0)
	api := NewRouter(RouterOptions{BridgeSecret: "secret", Now: func() time.Time { return now }})
	req := httptest.NewRequest(http.MethodGet, "/api/batch-factory/v11/capabilities", nil)
	SignBridgeRequest(req, "alpha-user", false, now.Add(-6*time.Minute), "secret")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestSliceThreeUnlocksCompilerPreviewOnly(t *testing.T) {
	caps := CapabilitiesForSlice(3)
	if !caps["compiler.preview"].Available {
		t.Fatalf("compiler.preview=%+v", caps["compiler.preview"])
	}
	for _, key := range []string{"production.submit", "merge.run", "publish.121", "publish.yadi"} {
		if caps[key].Available {
			t.Fatalf("%s must remain unavailable in Slice 3", key)
		}
	}
}

func TestSliceSixKeeps121UnavailableUntilVideoUploadIsVerified(t *testing.T) {
	caps := capabilitiesForRuntime(6, true, true, false, false)
	if caps["publish.121"].Available {
		t.Fatalf("121 publish must stay unavailable without verified video upload: %+v", caps["publish.121"])
	}
	if caps["publish.121"].Reason != "121 视频上传接口尚未验证" {
		t.Fatalf("reason=%q", caps["publish.121"].Reason)
	}
}
