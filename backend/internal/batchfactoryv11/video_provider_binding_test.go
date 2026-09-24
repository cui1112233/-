package batchfactoryv11

import "testing"

func TestVideoModelProviderBindingUsesTheModelAsTheSourceOfTruth(t *testing.T) {
	cases := []struct {
		name     string
		modelID  string
		fallback string
		want     string
	}{
		{name: "H3 catalog model", modelID: "minimax-h3-video", fallback: VideoProviderPersonalAPI, want: VideoProviderAutoDLH3},
		{name: "YD catalog model", modelID: "yd2-mini-video", fallback: VideoProviderAutoDLH3, want: VideoProviderPersonalAPI},
		{name: "YFAI Seedance catalog model", modelID: "seedance-2-0-official", fallback: VideoProviderPersonalAPI, want: VideoProviderYFAISeedance},
		{name: "local executor catalog model", modelID: "local-doubao-executor-video", fallback: VideoProviderPersonalAPI, want: VideoProviderDoubaoLocal},
		{name: "unknown model keeps saved provider", modelID: "custom-video", fallback: VideoProviderAutoDLH3, want: VideoProviderAutoDLH3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := VideoProviderForModel(tc.modelID, tc.fallback); got != tc.want {
				t.Fatalf("VideoProviderForModel(%q, %q) = %q, want %q", tc.modelID, tc.fallback, got, tc.want)
			}
		})
	}
}

func TestVideoModelMatchesProviderModelAcceptsCatalogAliases(t *testing.T) {
	if !VideoModelMatchesProviderModel("yd2-mini-video", "yd2.0-mini", VideoProviderPersonalAPI) {
		t.Fatal("YD catalog id must match the personal API provider model")
	}
	if !VideoModelMatchesProviderModel("local-doubao-executor-video", "doubao-seedance", VideoProviderDoubaoLocal) {
		t.Fatal("local catalog id must match the local executor provider model")
	}
	if VideoModelMatchesProviderModel("minimax-h3-video", "yd2.0-mini", VideoProviderPersonalAPI) {
		t.Fatal("H3 model must not match the personal API provider model")
	}
	if !VideoModelMatchesProviderModel("seedance-2-0-official", "seedance-2-0-official", VideoProviderYFAISeedance) {
		t.Fatal("Seedance catalog and provider model should match")
	}
}
