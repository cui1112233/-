package novelfetchworkshop

import "testing"

func TestBodyCodecRoundTrip(t *testing.T) {
	text := "第一章\n你好，世界。"
	blob, hash, chars, err := encodeBody(text)
	if err != nil {
		t.Fatal(err)
	}
	if chars != int64(len([]rune(text))) {
		t.Fatalf("chars=%d", chars)
	}
	if len(hash) != 64 {
		t.Fatalf("hash=%q", hash)
	}
	got, err := decodeBody(blob, "gzip")
	if err != nil {
		t.Fatal(err)
	}
	if got != text {
		t.Fatalf("got=%q", got)
	}
}
