package pet

import "strings"

const DefaultID = "stacky"

var supportedIDs = map[string]struct{}{
	"stacky": {},
	"pixiu":  {},
}

func IsSupported(value string) bool {
	_, ok := supportedIDs[strings.TrimSpace(value)]
	return ok
}

func NormalizeID(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if IsSupported(value) {
		return value
	}
	fallback = strings.TrimSpace(fallback)
	if IsSupported(fallback) {
		return fallback
	}
	return DefaultID
}
