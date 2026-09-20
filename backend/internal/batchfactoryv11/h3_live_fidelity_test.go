package batchfactoryv11

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func TestH3DirectorRejectsUnresolvedRichParticipant(t *testing.T) {
	document := mustH3DirectorFixture(t)
	document.DirectorCards[0].MicroShots[0].Participants = []H3Participant{{SlotID: "UNKNOWN"}}
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseH3DirectorDocument(raw, acceptanceH3VideoSource()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unresolved participant was accepted: %v", err)
	}
}

// The live sample is independent of our V12 schema. Decoding and persisting a
// director card must not silently discard the original director information.
func TestH3LiveDirectorCardRetainsStructuredInformation(t *testing.T) {
	raw, err := os.ReadFile("testdata/h3-live-20260920-card1.json")
	if err != nil {
		t.Fatal(err)
	}
	var card H3DirectorCard
	if err := json.Unmarshal(raw, &card); err != nil {
		t.Fatal(err)
	}
	saved, err := json.Marshal(card)
	if err != nil {
		t.Fatal(err)
	}
	var want, got map[string]any
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(saved, &got); err != nil {
		t.Fatal(err)
	}
	assertH3LiveSubset(t, "card", want, got)
}

func assertH3LiveSubset(t *testing.T, path string, want, got any) {
	t.Helper()
	switch expected := want.(type) {
	case map[string]any:
		actual, ok := got.(map[string]any)
		if !ok {
			t.Errorf("%s: lost structured object", path)
			return
		}
		for key, value := range expected {
			assertH3LiveSubset(t, path+"."+key, value, actual[key])
		}
	case []any:
		actual, ok := got.([]any)
		if !ok || len(actual) != len(expected) {
			t.Errorf("%s: lost array: want %v got %v", path, expected, got)
			return
		}
		for i := range expected {
			assertH3LiveSubset(t, path+"[]", expected[i], actual[i])
		}
	default:
		if !reflect.DeepEqual(want, got) {
			t.Errorf("%s: want %v got %v", path, want, got)
		}
	}
}
