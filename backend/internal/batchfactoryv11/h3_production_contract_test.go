package batchfactoryv11

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestH3ProductionUsesServerManagedAdapterInsteadOfPersonalRegistry(t *testing.T) {
	store, batch, book, _ := seedCompiledVideo(t)
	adapter := &recordingProductionAdapter{ref: ProviderTaskRef{State: ProductionSucceeded, MediaURL: "https://media.example/h3.mp4"}}
	service := &ProductionService{
		Store: store,
		Compiler: &PromptCompilerService{Store: store},
		Adapter: adapter,
		Enabled: true,
		Model: FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15},
	}
	job, err := service.SubmitBookProductionWithProvider(context.Background(), "alice", batch.ID, book.ID, "request-h3", "autodl_comfyui")
	if err != nil { t.Fatal(err) }
	if adapter.calls != 1 || len(job.Tasks) != 1 || job.Tasks[0].Provider != "autodl_comfyui" {
		t.Fatalf("adapter.calls=%d job=%+v", adapter.calls, job)
	}
}

func TestHTTPVideoAdapterH3ChoosesNoPicWorkflowWhenImagesAreEmpty(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
		_, _ = w.Write([]byte(`{"data":{"id":"h3-task-1"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	prompt := FinalPrompt{CompiledPrompt: "雨夜街道", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{}}}
	if _, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt); err != nil { t.Fatal(err) }
	if received["workflow"] != "minimax_h3_lightx2v_no_pic" {
		t.Fatalf("workflow=%v payload=%+v", received["workflow"], received)
	}
	images, ok := received["imageUrls"].([]any)
	if !ok || len(images) != 0 { t.Fatalf("imageUrls=%#v", received["imageUrls"]) }
}

func TestHTTPVideoAdapterH3ChoosesImageWorkflowForValidHTTPSImages(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
		_, _ = w.Write([]byte(`{"data":{"id":"h3-task-2"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	prompt := FinalPrompt{CompiledPrompt: "人物回头", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
		"imageUrls": json.RawMessage(`["https://cdn.example/ref.png"]`),
	}}}
	if _, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt); err != nil { t.Fatal(err) }
	if received["workflow"] != "minimax_h3_lightx2v_v5_15s" {
		t.Fatalf("workflow=%v payload=%+v", received["workflow"], received)
	}
	images, ok := received["imageUrls"].([]any)
	if !ok || len(images) != 1 || images[0] != "https://cdn.example/ref.png" { t.Fatalf("imageUrls=%#v", received["imageUrls"]) }
}

func TestHTTPVideoAdapterH3RejectsInvalidSuppliedImageInsteadOfDowngrading(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("invalid H3 image must fail before upstream request")
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	prompt := FinalPrompt{CompiledPrompt: "人物回头", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
		"imageUrls": json.RawMessage(`["http://unsafe.example/ref.png"]`),
	}}}
	if _, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt); err == nil {
		t.Fatal("expected invalid H3 image error")
	}
}

func TestH3ProviderAndModelSaveReadBack(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	batch, err := store.CreateBatch(ctx, "alice", CreateBatchInput{Title: "h3", Books: []CreateBookInput{{Title: "book"}}})
	if err != nil { t.Fatal(err) }
	_, err = store.SaveSettings(ctx, "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{
		Patch: SettingsPatch{
			"videoProvider": raw("autodl_comfyui"),
			"videoModelId": raw("minimax-h3"),
		},
		ExpectedRevision: batch.Revision,
	})
	if err != nil { t.Fatal(err) }
	got, err := store.GetBatch(ctx, "alice", batch.ID)
	if err != nil { t.Fatal(err) }
	if string(got.SettingsState.Patch["videoProvider"]) != `"autodl_comfyui"` || string(got.SettingsState.Patch["videoModelId"]) != `"minimax-h3"` {
		t.Fatalf("settings=%+v", got.SettingsState)
	}
}
