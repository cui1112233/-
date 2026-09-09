package batchfactoryv11

import "testing"

func TestNormalizeVideoProviderRecognizesAutoDLComfyUI(t *testing.T) {
	for _, input := range []string{"autodl", "autodl_comfyui", "AUTODL_COMFYUI"} {
		if got := NormalizeVideoProviderForHTTP(input); got != "autodl_comfyui" {
			t.Fatalf("NormalizeVideoProviderForHTTP(%q)=%q want=%q", input, got, "autodl_comfyui")
		}
	}
}
