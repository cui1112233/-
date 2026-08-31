package httpapi

import "net/http"

type Capability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

func CapabilitiesForSlice(slice int) map[string]Capability {
	caps := map[string]Capability{
		"batch.read":        {Reason: "V11 settings slice not released"},
		"settings.edit":     {Reason: "V11 settings slice not released"},
		"director.run":      {Reason: "Director slice not released"},
		"hook.review":       {Reason: "Director slice not released"},
		"production.submit": {Reason: "Production slice not released"},
		"merge.run":         {Reason: "Merge slice not released"},
		"publish.121":       {Reason: "121 is not enabled"},
		"publish.yadi":      {Reason: "Yadi is not enabled"},
	}
	if slice >= 1 {
		caps["batch.read"] = Capability{Available: true}
		caps["settings.edit"] = Capability{Available: true}
	}
	if slice >= 2 {
		caps["director.run"] = Capability{Available: true}
		caps["hook.review"] = Capability{Available: true}
	}
	return caps
}

func capabilityHandler(slice int) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) { writeJSON(w, http.StatusOK, CapabilitiesForSlice(slice)) }
}
