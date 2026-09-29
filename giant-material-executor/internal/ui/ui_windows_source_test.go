package ui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsImplementationContainsPairingWindowControls(t *testing.T) {
	path := filepath.Join("ui_windows.go")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read Windows UI source: %v", err)
	}
	source := string(data)
	for _, want := range []string{"CreateWindowExW", "WM_COMMAND", "ShowWindow", "控制服务地址", "绑定", "最小化到后台"} {
		if !strings.Contains(source, want) {
			t.Fatalf("Windows UI source missing %q", want)
		}
	}
}
