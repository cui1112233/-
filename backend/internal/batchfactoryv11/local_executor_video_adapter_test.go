package batchfactoryv11

import (
	"context"
	"strings"
	"testing"
)

type fakeLocalVideoClient struct {
	createdOwner string
	createdInput LocalVideoJobInput
	job          LocalVideoJob
}

func (f *fakeLocalVideoClient) CreateVideoJob(_ context.Context, owner string, input LocalVideoJobInput) (LocalVideoJob, error) {
	f.createdOwner, f.createdInput = owner, input
	if f.job.ID == "" {
		f.job = LocalVideoJob{ID: "lej_1", State: "queued"}
	}
	return f.job, nil
}

func (f *fakeLocalVideoClient) GetVideoJob(_ context.Context, owner, id string) (LocalVideoJob, error) {
	if owner != f.createdOwner || id != f.job.ID {
		return LocalVideoJob{}, ErrNotFound
	}
	return f.job, nil
}

func TestLocalExecutorVideoAdapterKeepsV11IdentityAndCompiledPrompt(t *testing.T) {
	client := &fakeLocalVideoClient{}
	adapter := NewLocalExecutorVideoAdapter(client, "https://platform.example")
	ref, err := adapter.Submit(context.Background(), "alice", LocalVideoJobInput{
		BatchID: "batch-1", BookID: "book-1", VideoID: "video-1",
		Model: "doubao-seedance", Prompt: "compiled prompt", Duration: 10, AspectRatio: "9:16",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ref.ProviderTaskID != "lej_1" || ref.State != ProductionQueued {
		t.Fatalf("ref=%+v", ref)
	}
	if client.createdOwner != "alice" || client.createdInput.SourceTaskID != "bf11:batch-1:book-1:video-1" || client.createdInput.Prompt != "compiled prompt" {
		t.Fatalf("owner=%q input=%+v", client.createdOwner, client.createdInput)
	}
}

func TestLocalExecutorVideoAdapterReturnsExactArtifactURLOnlyForSucceededJob(t *testing.T) {
	client := &fakeLocalVideoClient{
		createdOwner: "alice",
		job:          LocalVideoJob{ID: "lej_2", State: "succeeded", ArtifactID: "artifact_2"},
	}
	adapter := NewLocalExecutorVideoAdapter(client, "https://platform.example")
	ref, err := adapter.Poll(context.Background(), "alice", "lej_2")
	if err != nil {
		t.Fatal(err)
	}
	if ref.State != ProductionSucceeded || !strings.Contains(ref.MediaURL, "/api/shuihuo-production/local-executor-artifacts/artifact_2") {
		t.Fatalf("ref=%+v", ref)
	}
}
