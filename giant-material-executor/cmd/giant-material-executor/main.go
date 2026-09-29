package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"qiantie/giant-material-executor/internal/agent"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	machine := agent.NewStateMachine()
	log.Printf("giant material executor started version=%s state=%s workerResident=%t", version, machine.Snapshot().State, machine.Snapshot().WorkerResident)
	<-ctx.Done()

	if err := machine.Transition(agent.StateStopping); err != nil {
		log.Printf("executor stopping: %v", err)
		return
	}
	log.Printf("giant material executor stopped")
}
