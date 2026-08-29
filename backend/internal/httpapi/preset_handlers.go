package httpapi

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// handleEmbeddedPresets exposes the read-only built-in catalog during the
// single-binary migration. Mutable draft/publish operations remain on the
// legacy gateway until their MySQL-backed Go implementation is complete.
func (api *API) handleEmbeddedPresets(w http.ResponseWriter, r *http.Request) {
	module := strings.TrimSpace(r.URL.Query().Get("module"))
	if module != "batch-factory" || api.deps.WebFS == nil {
		writeJSON(w, http.StatusOK, map[string]any{"presets": []any{}})
		return
	}
	entries, err := fs.ReadDir(api.deps.WebFS, "prompts")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取提示词目录失败"})
		return
	}
	presets := make([]map[string]any, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "批量工厂-") || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		body, readErr := fs.ReadFile(api.deps.WebFS, path.Join("prompts", entry.Name()))
		if readErr != nil {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".md")
		presets = append(presets, map[string]any{"id": id, "module": module, "name": id, "kind": "base", "version": 1, "status": "published", "body": string(body)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": presets})
}
