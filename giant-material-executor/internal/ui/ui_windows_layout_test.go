//go:build windows

package ui

import (
	"testing"
	"unsafe"
)

func TestNativeMessageMatchesWindows64MessageLayout(t *testing.T) {
	// MSG has a four-byte alignment gap after message on 64-bit Windows.
	// Without it WM_COMMAND wParam is read from the wrong offset and button
	// clicks appear to do nothing.
	if got := unsafe.Offsetof(nativeMessage{}.wParam); got != 16 {
		t.Fatalf("wParam offset=%d, want 16", got)
	}
	if got := unsafe.Offsetof(nativeMessage{}.lParam); got != 24 {
		t.Fatalf("lParam offset=%d, want 24", got)
	}
}
