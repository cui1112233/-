package pet

import "testing"

func TestSupportedPetIDs(t *testing.T) {
	for _, id := range []string{"stacky", "pixiu"} {
		if !IsSupported(id) {
			t.Fatalf("expected %q to be supported", id)
		}
	}
	if IsSupported("dragon") {
		t.Fatal("unexpected support for unknown pet")
	}
}

func TestNormalizeIDUsesSelectedSupportedPet(t *testing.T) {
	if got := NormalizeID("pixiu", "stacky"); got != "pixiu" {
		t.Fatalf("NormalizeID(pixiu, stacky) = %q, want pixiu", got)
	}
}

func TestNormalizeIDPreservesSupportedFallback(t *testing.T) {
	if got := NormalizeID("unknown", "pixiu"); got != "pixiu" {
		t.Fatalf("NormalizeID(unknown, pixiu) = %q, want pixiu", got)
	}
}

func TestNormalizeIDFallsBackToDefault(t *testing.T) {
	for _, tc := range []struct {
		value    string
		fallback string
	}{
		{"", ""},
		{"unknown", ""},
		{"unknown", "also-unknown"},
	} {
		if got := NormalizeID(tc.value, tc.fallback); got != DefaultID {
			t.Fatalf("NormalizeID(%q, %q) = %q, want %q", tc.value, tc.fallback, got, DefaultID)
		}
	}
}
