package models

import "testing"

func TestGenericHTTPReferenceImageCapabilityRequiresAReferencePlaceholder(t *testing.T) {
	model := Definition{AdapterKind: AdapterGenericHTTP, RequestTemplate: `{"body":{"images":"{{reference_image_urls}}"}}`}
	if !model.SupportsReferenceImages() {
		t.Fatal("generic image model with reference list placeholder must support reference images")
	}

	model.RequestTemplate = `{"body":{"prompt":"{{prompt}}"}}`
	if model.SupportsReferenceImages() {
		t.Fatal("generic image model without a reference placeholder must not claim support")
	}
}

func TestOnlyViduVideoModelsRequireAnImage(t *testing.T) {
	if !(&Definition{Kind: KindVideo, AdapterKind: AdapterViduImageToVideo}).RequiresVideoImage() {
		t.Fatal("Vidu image-to-video model must require an image")
	}
	if (&Definition{Kind: KindVideo, AdapterKind: AdapterGenericHTTP}).RequiresVideoImage() {
		t.Fatal("generic video model must allow prompt-only generation")
	}
}
