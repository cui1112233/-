package providers

import "testing"

func TestTextCompletionRejectsNonJSONArray(t *testing.T) {
	_, err := ParseSegmentCandidates(`{"subtitle":"not array"}`)
	if err == nil {
		t.Fatal("accepted non-array response")
	}
}

func TestTextCompletionParsesNonEmptyCandidateArray(t *testing.T) {
	candidates, err := ParseSegmentCandidates(`[{"text":"第一段"},{"text":"第二段"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 || candidates[0].Text != "第一段" || candidates[1].Text != "第二段" {
		t.Fatalf("candidates = %#v", candidates)
	}
}
