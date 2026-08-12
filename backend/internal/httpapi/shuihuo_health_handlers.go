package httpapi

import (
	"net/http"
	"sort"
	"strings"
)

var requiredShuihuoModelKinds = []string{"text", "image", "video"}

type ShuihuoDependencyHealth struct {
	Ready  bool   `json:"ready"`
	Reason string `json:"reason,omitempty"`
}

// ShuihuoHealth is a startup readiness snapshot. It intentionally excludes
// connection strings, credential references, request templates, and secrets.
type ShuihuoHealth struct {
	Database     ShuihuoDependencyHealth `json:"database"`
	Redis        ShuihuoDependencyHealth `json:"redis"`
	Storage      ShuihuoDependencyHealth `json:"storage"`
	EnabledKinds []string                `json:"enabledModelKinds"`
	Models       ShuihuoDependencyHealth `json:"models"`
}

func (health ShuihuoHealth) Ready() bool {
	return health.Database.Ready && health.Redis.Ready && health.Storage.Ready && health.Models.Ready
}

func (api *API) handleShuihuoHealth(w http.ResponseWriter, r *http.Request) {
	health := api.deps.Health
	if health.Ready() {
		writeJSON(w, http.StatusOK, health)
		return
	}
	writeJSON(w, http.StatusServiceUnavailable, health)
}

func NewShuihuoHealth(database, redis, storage ShuihuoDependencyHealth, enabledKinds []string) ShuihuoHealth {
	enabled := make(map[string]struct{}, len(enabledKinds))
	for _, kind := range enabledKinds {
		if kind != "" {
			enabled[kind] = struct{}{}
		}
	}
	missing := make([]string, 0, len(requiredShuihuoModelKinds))
	for _, kind := range requiredShuihuoModelKinds {
		if _, ok := enabled[kind]; !ok {
			missing = append(missing, kind)
		}
	}
	models := ShuihuoDependencyHealth{Ready: len(missing) == 0}
	if len(missing) > 0 {
		models.Reason = "缺少已启用的模型类型：" + joinHealthValues(missing)
	}
	publicKinds := make([]string, 0, len(enabled))
	for kind := range enabled {
		publicKinds = append(publicKinds, kind)
	}
	sort.Strings(publicKinds)
	return ShuihuoHealth{Database: database, Redis: redis, Storage: storage, EnabledKinds: publicKinds, Models: models}
}

func joinHealthValues(values []string) string { return strings.Join(values, "、") }
