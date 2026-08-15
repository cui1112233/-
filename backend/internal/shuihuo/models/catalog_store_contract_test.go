package models

import (
	"os"
	"strings"
	"testing"
)

func TestModelVersionStoreQueryIncludesRuntimeAdapterFields(t *testing.T) {
	body, err := os.ReadFile("../store/models.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"COALESCE(v.endpoint, '')", "COALESCE(v.response_mapping, '')", "func (s *Models) GetVersion"} {
		if !strings.Contains(string(body), expected) {
			t.Fatalf("model store must include %q for runtime execution", expected)
		}
	}
}
