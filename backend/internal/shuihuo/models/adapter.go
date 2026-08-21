package models

import (
	"context"
	"fmt"
)

type Request struct {
	Prompt             string
	OwnerID            int64
	ImageURL           string
	ReferenceImageURLs []string
	Duration           string
	AspectRatio        string
	Resolution         string
	CallbackURL        string
	Voice              string
	SpeechRate         float64
	Pitch              float64
}

type Response struct {
	ProviderTaskID    string
	ResultURL         string
	ResultData        []byte
	ResultContentType string
}

type Adapter interface {
	Submit(ctx context.Context, model Definition, request Request) (Response, error)
}

// AdapterRouter permits only explicitly registered server-side adapters.
// Catalog values never select arbitrary HTTP behavior at runtime.
type AdapterRouter map[string]Adapter

func (r AdapterRouter) Submit(ctx context.Context, model Definition, request Request) (Response, error) {
	adapter := r[model.AdapterKind]
	if adapter == nil {
		return Response{}, fmt.Errorf("model adapter %q is not configured", model.AdapterKind)
	}
	return adapter.Submit(ctx, model, request)
}
