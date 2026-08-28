package models

import "testing"

func TestMaxVideoDurationFromPublicSchema(t *testing.T) {
	tests := []struct {
		name   string
		schema string
		want   int
	}{
		{name: "top-level", schema: `{"maxVideoDuration":15}`, want: 15},
		{name: "json-schema maximum", schema: `{"properties":{"duration":{"type":"integer","maximum":10}}}`, want: 10},
		{name: "json-schema enum", schema: `{"properties":{"duration":{"enum":[5,10,15]}}}`, want: 15},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := Definition{Kind: KindVideo, ParameterSchema: tt.schema}
			if got := model.MaxVideoDuration(); got != tt.want {
				t.Fatalf("MaxVideoDuration() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestMaxVideoDurationFallsBackToRuntimePolicy(t *testing.T) {
	model := Definition{Kind: KindVideo, ParameterSchema: `{}`, RuntimePolicyJSON: `{"maxVideoDuration":12}`}
	if got := model.MaxVideoDuration(); got != 12 {
		t.Fatalf("MaxVideoDuration() = %d, want 12", got)
	}
}

func TestMaxVideoDurationRejectsInvalidCapability(t *testing.T) {
	for _, schema := range []string{
		`{"maxVideoDuration":0}`,
		`{"maxVideoDuration":61}`,
		`{"maxVideoDuration":9.5}`,
		`{"maxVideoDuration":"15"}`,
	} {
		model := Definition{Kind: KindVideo, ParameterSchema: schema}
		if got := model.MaxVideoDuration(); got != 0 {
			t.Fatalf("MaxVideoDuration(%s) = %d, want 0", schema, got)
		}
	}
}

func TestPublicModelExposesOnlyDerivedVideoDurationCapability(t *testing.T) {
	model := Definition{
		Kind:              KindVideo,
		ParameterSchema:   `{"maxVideoDuration":15}`,
		RuntimePolicyJSON: `{"secret":"must-not-be-public"}`,
	}
	public := ToPublic(model)
	if public.MaxVideoDuration != 15 {
		t.Fatalf("public.MaxVideoDuration = %d, want 15", public.MaxVideoDuration)
	}
}
