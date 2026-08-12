package domain

import "testing"

func TestValidateTaskStatusRejectsUnknownValue(t *testing.T) {
	if err := ValidateTaskStatus(TaskStatus("finished")); err == nil {
		t.Fatal("unknown task status was accepted")
	}
}

func TestValidateTaskStatusAcceptsLifecycleStatuses(t *testing.T) {
	for _, status := range []TaskStatus{TaskDraft, TaskQueued, TaskRunning, TaskSucceeded, TaskFailed, TaskCancelled} {
		if err := ValidateTaskStatus(status); err != nil {
			t.Fatalf("ValidateTaskStatus(%q) error = %v", status, err)
		}
	}
}
