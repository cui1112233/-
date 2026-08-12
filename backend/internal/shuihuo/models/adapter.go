package models

import "context"

type Request struct {
	Prompt      string
	ImageURL    string
	Duration    string
	AspectRatio string
	Resolution  string
	CallbackURL string
}

type Response struct {
	ProviderTaskID string
	ResultURL      string
}

type Adapter interface {
	Submit(ctx context.Context, model Definition, request Request) (Response, error)
}
