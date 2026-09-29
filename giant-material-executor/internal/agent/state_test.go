package agent

import "testing"

func TestSuccessfulJobReturnsToIdleAndKeepsWorkerResident(t *testing.T) {
	machine := NewStateMachine()
	for _, state := range []State{StateReady, StateRunning, StateCleaning, StateUploading} {
		if err := machine.Transition(state); err != nil {
			t.Fatal(err)
		}
	}
	if err := machine.Transition(StateIdle); err != nil {
		t.Fatal(err)
	}
	if got := machine.Snapshot().State; got != StateIdle {
		t.Fatalf("state=%s", got)
	}
	if !machine.Snapshot().WorkerResident {
		t.Fatal("expected OCR worker to remain resident")
	}
}

func TestInvalidTransitionDoesNotSilentlyStopTheAgent(t *testing.T) {
	machine := NewStateMachine()
	if err := machine.Transition(StateUploading); err == nil {
		t.Fatal("expected invalid transition")
	}
	if got := machine.Snapshot().State; got != StateIdle {
		t.Fatalf("state=%s", got)
	}
}

func TestFailedJobCanRecoverToIdleAfterWorkerRestart(t *testing.T) {
	machine := NewStateMachine()
	for _, state := range []State{StateReady, StateRunning, StateFailed, StateIdle} {
		if err := machine.Transition(state); err != nil {
			t.Fatal(err)
		}
	}
	if got := machine.Snapshot().State; got != StateIdle {
		t.Fatalf("state=%s", got)
	}
}
