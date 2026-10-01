package agent

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"qiantie/giant-material-executor/internal/worker"
)

func TestHTTPClientMapsUnauthorizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, server.Client())
	if _, err := client.Claim(context.Background(), "executor-token"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("claim error=%v, want ErrUnauthorized", err)
	}
}

func TestHTTPClientMapsEmptyClaimAndSendsBearerToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/giant-material-executor/v1/jobs/claim" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer executor-token" {
			t.Fatalf("authorization=%q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, server.Client())
	if _, err := client.Claim(context.Background(), "executor-token"); err != ErrNoClaimableJob {
		t.Fatalf("claim error=%v", err)
	}
}

func TestProcessReportsCleaningAndUploadingBeforeCompleting(t *testing.T) {
	client := &recordingClient{}
	t.Setenv("GIANT_AGENT_TEST_HELPER", "1")
	supervisor := &worker.Supervisor{Command: []string{os.Args[0], "-test.run=TestAgentWorkerHelperProcess", "--"}}
	if err := supervisor.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = supervisor.Stop(context.Background()) }()

	agent, err := New(Config{Client: client, Supervisor: supervisor, Token: "executor-token"})
	if err != nil {
		t.Fatal(err)
	}
	if err := agent.state.Transition(StateReady); err != nil {
		t.Fatal(err)
	}
	claim := ClaimResult{Job: Job{ID: "job-1", VideoURL: "https://material.hnqingyuwen.top/video.mp4", DurationSeconds: 1}, LeaseToken: "lease", LeaseGeneration: 1}
	if err := agent.process(context.Background(), claim); err != nil {
		t.Fatal(err)
	}
	want := []State{StateRunning, StateCleaning, StateUploading}
	if !reflect.DeepEqual(client.progressStates, want) {
		t.Fatalf("progress states=%v want=%v", client.progressStates, want)
	}
	if !client.completed {
		t.Fatal("completion was not reported")
	}
}

func TestAgentWorkerHelperProcess(t *testing.T) {
	if os.Getenv("GIANT_AGENT_TEST_HELPER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		os.Exit(2)
	}
	for _, event := range []string{
		`{"type":"progress","jobId":"job-1","completed":1,"total":1,"percent":100}`,
		`{"type":"complete","jobId":"job-1","text":"正文","characters":2}`,
		`{"type":"idle","jobId":"job-1"}`,
	} {
		fmt.Fprintln(os.Stdout, event)
	}
	os.Exit(0)
}

type recordingClient struct {
	progressStates []State
	completed      bool
}

func (c *recordingClient) Heartbeat(context.Context, string, HeartbeatRequest) error { return nil }
func (c *recordingClient) Claim(context.Context, string) (ClaimResult, error) {
	return ClaimResult{}, ErrNoClaimableJob
}
func (c *recordingClient) Renew(context.Context, string, string, LeaseCredential) error { return nil }
func (c *recordingClient) Progress(_ context.Context, _ string, _ string, _ LeaseCredential, state State, _ JobProgress) error {
	c.progressStates = append(c.progressStates, state)
	return nil
}
func (c *recordingClient) Complete(context.Context, string, string, LeaseCredential, Result) error {
	c.completed = true
	return nil
}
func (c *recordingClient) Fail(context.Context, string, string, LeaseCredential, string, string) error {
	return nil
}
