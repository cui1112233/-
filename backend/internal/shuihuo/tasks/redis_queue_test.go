package tasks

import "testing"

func TestEncodeCommandUsesRESPBulkStrings(t *testing.T) {
	got := string(encodeCommand("LPUSH", "shuihuo:tasks", "12"))
	want := "*3\r\n$5\r\nLPUSH\r\n$13\r\nshuihuo:tasks\r\n$2\r\n12\r\n"
	if got != want {
		t.Fatalf("encodeCommand() = %q, want %q", got, want)
	}
}
