package batchfactoryv11

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestHTTPVideoAdapterH3ChoosesTextWorkflowAndEmptyPlaceholderWhenImagesAreEmpty(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
		_, _ = w.Write([]byte(`{"data":{"id":"h3-task-1"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	prompt := FinalPrompt{CompiledPrompt: "雨夜街道", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{}}}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt)
	if err != nil { t.Fatal(err) }
	if ref.ProviderTaskID != "h3-task-1" || ref.State != ProductionQueued {
		t.Fatalf("ref=%+v", ref)
	}
	if received["workflow"] != H3WorkflowNoPicture {
		t.Fatalf("workflow=%v payload=%+v", received["workflow"], received)
	}
	if received["ref_image_0"] != H3EmptyReferenceImageURL {
		t.Fatalf("ref_image_0=%#v payload=%+v", received["ref_image_0"], received)
	}
	if _, ok := received["imageUrls"]; ok {
		t.Fatalf("legacy imageUrls leaked into H3 payload: %+v", received)
	}
	if _, ok := received["ref_image_1"]; ok {
		t.Fatalf("unexpected ref_image_1 in text workflow: %+v", received)
	}
}

func TestHTTPVideoAdapterH3MapsNineHTTPSImagesToRefImageFields(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil { t.Fatal(err) }
		_, _ = w.Write([]byte(`{"data":{"id":"h3-task-2"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	images := make([]string, 9)
	for index := range images { images[index] = fmt.Sprintf("https://cdn.example/ref-%d.png", index) }
	rawImages, err := json.Marshal(images)
	if err != nil { t.Fatal(err) }
	prompt := FinalPrompt{CompiledPrompt: "人物回头", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{
		"imageUrls": rawImages,
	}}}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt)
	if err != nil { t.Fatal(err) }
	if ref.ProviderTaskID != "h3-task-2" || ref.State != ProductionQueued {
		t.Fatalf("ref=%+v", ref)
	}
	if received["workflow"] != H3WorkflowWithPicture {
		t.Fatalf("workflow=%v payload=%+v", received["workflow"], received)
	}
	if _, ok := received["imageUrls"]; ok {
		t.Fatalf("legacy imageUrls leaked into H3 payload: %+v", received)
	}
	for index, imageURL := range images {
		key := fmt.Sprintf("ref_image_%d", index)
		if received[key] != imageURL { t.Fatalf("%s=%#v want=%q", key, received[key], imageURL) }
	}
	if _, ok := received["ref_image_9"]; ok {
		t.Fatalf("unexpected ref_image_9: %+v", received)
	}
}

func TestHTTPVideoAdapterH3RejectsTenthReferenceImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("ten H3 references must fail before upstream request")
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	images := make([]string, 10)
	for index := range images { images[index] = fmt.Sprintf("https://cdn.example/ref-%d.png", index) }
	rawImages, err := json.Marshal(images)
	if err != nil { t.Fatal(err) }
	prompt := FinalPrompt{CompiledPrompt: "人物回头", EffectiveSettings: EffectiveSettings{Values: SettingsPatch{"imageUrls": rawImages}}}
	if _, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "minimax-h3", MaxDuration: 15}, prompt); err == nil {
		t.Fatal("expected H3 reference image limit error")
	}
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

func TestHTTPVideoAdapterH3PollMapsRunningAndCompletedVideoURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tasks/running-task":
			_, _ = w.Write([]byte(`{"data":{"status":"RUNNING"}}`))
		case "/tasks/done-task":
			_, _ = w.Write([]byte(`{"data":{"status":"SUCCESS","video_url":"https://media.example/h3-final.mp4"}}`))
		default:
			t.Fatalf("unexpected poll path %q", r.URL.Path)
		}
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{
		Endpoint: server.URL,
		PollEndpoint: server.URL + "/tasks/{id}",
		APIKey: "server-secret",
		Model: "minimax-h3",
		Client: server.Client(),
		ValidateURL: testAdapterURL,
	}
	running, err := adapter.Poll(context.Background(), FrozenVideoModel{ID: "minimax-h3"}, ProviderTaskRef{ProviderTaskID: "running-task"})
	if err != nil { t.Fatal(err) }
	if running.State != ProductionRunning || running.MediaURL != "" { t.Fatalf("running=%+v", running) }
	done, err := adapter.Poll(context.Background(), FrozenVideoModel{ID: "minimax-h3"}, ProviderTaskRef{ProviderTaskID: "done-task"})
	if err != nil { t.Fatal(err) }
	if done.State != ProductionSucceeded || done.MediaURL != "https://media.example/h3-final.mp4" {
		t.Fatalf("done=%+v", done)
	}
}

func TestHTTPVideoAdapterH3CompletedWithoutVideoURLFailsClosed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"status":"SUCCESS"}}`))
	}))
	defer server.Close()
	adapter := &HTTPVideoAdapter{Endpoint: server.URL, PollEndpoint: server.URL + "/tasks/{id}", APIKey: "server-secret", Model: "minimax-h3", Client: server.Client(), ValidateURL: testAdapterURL}
	_, err := adapter.Poll(context.Background(), FrozenVideoModel{ID: "minimax-h3"}, ProviderTaskRef{ProviderTaskID: "done-no-url"})
	if err == nil || !strings.Contains(err.Error(), "media URL") { t.Fatalf("err=%v", err) }
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
