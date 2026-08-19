package models

import (
	"reflect"
	"testing"
)

func TestRenderTemplateValueRendersReferenceImageURLsAsAnArray(t *testing.T) {
	request := Request{ReferenceImageURLs: []string{"https://assets.example/one.png", "https://assets.example/two.png"}}
	got := renderTemplateValue(map[string]any{"images": "{{reference_image_urls}}"}, request, "").(map[string]any)
	want := []any{"https://assets.example/one.png", "https://assets.example/two.png"}
	if !reflect.DeepEqual(got["images"], want) {
		t.Fatalf("images = %#v, want %#v", got["images"], want)
	}
}
