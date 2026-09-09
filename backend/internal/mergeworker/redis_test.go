package mergeworker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestEncodeRESPCommand(t *testing.T) {
	got := string(encodeRESPCommand("SET", "job:key", "value"))
	want := "*3\r\n$3\r\nSET\r\n$7\r\njob:key\r\n$5\r\nvalue\r\n"
	if got != want {
		t.Fatalf("got=%q want=%q", got, want)
	}
}

func TestReadRESPArray(t *testing.T) {
	reader := bufio.NewReader(bytes.NewBufferString("*2\r\n$5\r\nqueue\r\n$8\r\ntask-123\r\n"))
	value, err := readRESP(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(value, []any{"queue", "task-123"}) {
		t.Fatalf("value=%#v", value)
	}
}

func TestRedisStoreCommandContract(t *testing.T) {
	fake := &fakeRedisDo{}
	store := &RedisStore{Prefix: "qiantie:test:merge", Do: fake.Do}
	job := Job{ID: "task-1", BatchID: "batch-1", Status: StateQueued, Sources: []Source{{ProductionJobID: "p1", VideoID: "v1", MediaURL: "https://media.example/1.mp4", Order: 0}}}
	created, err := store.Create(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != job.ID {
		t.Fatalf("created=%+v", created)
	}
	if err := store.Enqueue(context.Background(), job.ID); err != nil {
		t.Fatal(err)
	}
	fake.next = []any{"qiantie:test:merge:queue", "task-1"}
	id, err := store.Dequeue(context.Background(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if id != "task-1" {
		t.Fatalf("id=%q", id)
	}
	if len(fake.commands) < 3 || fake.commands[0][0] != "SET" || fake.commands[1][0] != "RPUSH" || fake.commands[2][0] != "BLPOP" {
		t.Fatalf("commands=%v", fake.commands)
	}
	var persisted Job
	if err := json.Unmarshal([]byte(fake.commands[0][2]), &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Status != StateQueued || len(persisted.Sources) != 1 {
		t.Fatalf("persisted=%+v", persisted)
	}
}

type fakeRedisDo struct {
	commands [][]string
	next     any
}

func (f *fakeRedisDo) Do(_ context.Context, args ...string) (any, error) {
	f.commands = append(f.commands, append([]string(nil), args...))
	if f.next != nil {
		value := f.next
		f.next = nil
		return value, nil
	}
	return "OK", nil
}
