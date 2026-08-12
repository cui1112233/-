package models

import "time"

type Kind string

const (
	KindText  Kind = "text"
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindAudio Kind = "audio"
)

type Definition struct {
	ID              int64
	VersionID       int64
	Name            string
	Kind            Kind
	AdapterKind     string
	Enabled         bool
	AllowedRoles    []string
	ParameterSchema string
	CredentialRef   string
	RequestTemplate string
	CreatedAt       time.Time
}

type PublicModel struct {
	ID              int64    `json:"id"`
	VersionID       int64    `json:"versionId"`
	Name            string   `json:"name"`
	Kind            Kind     `json:"kind"`
	AdapterKind     string   `json:"adapterKind"`
	ParameterSchema string   `json:"parameterSchema"`
	AllowedRoles    []string `json:"allowedRoles"`
}

func ToPublic(model Definition) PublicModel {
	return PublicModel{ID: model.ID, VersionID: model.VersionID, Name: model.Name, Kind: model.Kind, AdapterKind: model.AdapterKind, ParameterSchema: model.ParameterSchema, AllowedRoles: append([]string(nil), model.AllowedRoles...)}
}
