package uploads

import (
	"encoding/base64"
	"testing"
)

func dataURL(contentType string, body []byte) string {
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(body)
}

func TestDecodeDataURLImage(t *testing.T) {
	decoded, err := DecodeDataURL(dataURL("image/png", []byte("png-data")), "cover.png", "image")
	if err != nil {
		t.Fatalf("DecodeDataURL() error = %v", err)
	}
	if decoded.Category != "images" || decoded.Filename != "cover.png" || decoded.ContentType != "image/png" {
		t.Fatalf("unexpected decoded upload: %#v", decoded)
	}
	if string(decoded.Body) != "png-data" {
		t.Fatalf("unexpected body: %q", decoded.Body)
	}
}

func TestDecodeDataURLRejectsTraversal(t *testing.T) {
	if _, err := DecodeDataURL(dataURL("video/mp4", []byte("video")), "../clip.mp4", "video"); err == nil {
		t.Fatal("expected traversal filename to be rejected")
	}
}

func TestDecodeDataURLRejectsMimeExtensionMismatch(t *testing.T) {
	if _, err := DecodeDataURL(dataURL("image/png", []byte("image")), "cover.mp4", "image"); err == nil {
		t.Fatal("expected MIME/extension mismatch to be rejected")
	}
}

func TestDecodeDataURLRejectsUnsupportedKind(t *testing.T) {
	if _, err := DecodeDataURL(dataURL("application/pdf", []byte("pdf")), "file.pdf", "document"); err == nil {
		t.Fatal("expected unsupported kind to be rejected")
	}
}
