package models

import (
	"errors"
	"sort"
	"strings"
)

type CredentialReference struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Configured bool   `json:"configured"`
}

type CredentialReferenceConfig struct {
	Label               string
	EnvironmentVariable string
}

type CredentialRegistry struct {
	environment map[string]string
	references  map[string]CredentialReferenceConfig
}

func NewCredentialRegistry(env map[string]string, references map[string]CredentialReferenceConfig) *CredentialRegistry {
	registry := &CredentialRegistry{
		environment: make(map[string]string, len(env)),
		references:  make(map[string]CredentialReferenceConfig, len(references)),
	}
	for key, value := range env {
		registry.environment[key] = value
	}
	for id, config := range references {
		registry.references[id] = config
	}
	return registry
}

func (registry *CredentialRegistry) List() []CredentialReference {
	ids := make([]string, 0, len(registry.references))
	for id := range registry.references {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	items := make([]CredentialReference, 0, len(ids))
	for _, id := range ids {
		config := registry.references[id]
		items = append(items, CredentialReference{
			ID:         id,
			Label:      config.Label,
			Configured: registry.configured(config),
		})
	}
	return items
}

func (registry *CredentialRegistry) Resolve(referenceID string) (string, error) {
	config, ok := registry.references[referenceID]
	if !ok || !registry.configured(config) {
		return "", errors.New("credential reference unavailable")
	}
	return registry.environment[config.EnvironmentVariable], nil
}

func (registry *CredentialRegistry) configured(config CredentialReferenceConfig) bool {
	value, ok := registry.environment[config.EnvironmentVariable]
	return ok && strings.TrimSpace(value) != ""
}
