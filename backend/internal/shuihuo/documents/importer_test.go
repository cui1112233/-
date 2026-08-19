package documents

import (
	"archive/zip"
	"bytes"
	"errors"
	"testing"
)

func TestParseUploadSupportsTXTAndSRT(t *testing.T) {
	t.Run("txt removes utf8 bom", func(t *testing.T) {
		text, kind, err := ParseUpload("source.txt", "text/plain; charset=utf-8", []byte("\xef\xbb\xbf第一段\r\n第二段"))
		if err != nil || kind != "txt" || text != "第一段\n第二段" {
			t.Fatalf("ParseUpload() = %q, %q, %v", text, kind, err)
		}
	})
	t.Run("srt keeps cue content", func(t *testing.T) {
		text, kind, err := ParseUpload("source.srt", "application/x-subrip", []byte("1\n00:00:00,000 --> 00:00:02,000\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n世界\n"))
		if err != nil || kind != "srt" || text != "你好\n世界" {
			t.Fatalf("ParseUpload() = %q, %q, %v", text, kind, err)
		}
	})
}

func TestParseUploadSupportsDOCXParagraphText(t *testing.T) {
	var body bytes.Buffer
	writer := zip.NewWriter(&body)
	entry, err := writer.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	_, err = entry.Write([]byte(`<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二</w:t></w:r><w:r><w:t>段</w:t></w:r></w:p></w:body></w:document>`))
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	text, kind, err := ParseUpload("source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body.Bytes())
	if err != nil || kind != "docx" || text != "第一段\n第二段" {
		t.Fatalf("ParseUpload() = %q, %q, %v", text, kind, err)
	}
}

func TestParseUploadRejectsUnsafeOrInvalidDocuments(t *testing.T) {
	tests := []struct {
		name        string
		filename    string
		contentType string
		body        []byte
		want        error
	}{
		{name: "pdf", filename: "source.pdf", contentType: "application/pdf", body: []byte("%PDF"), want: ErrUnsupportedDocument},
		{name: "unsafe filename", filename: "../source.txt", contentType: "text/plain", body: []byte("内容"), want: ErrUnsafeFilename},
		{name: "leading tab filename", filename: "\tsource.txt", contentType: "text/plain", body: []byte("内容"), want: ErrUnsafeFilename},
		{name: "trailing whitespace filename", filename: "source.txt ", contentType: "text/plain", body: []byte("内容"), want: ErrUnsafeFilename},
		{name: "control character filename", filename: "source\x7f.txt", contentType: "text/plain", body: []byte("内容"), want: ErrUnsafeFilename},
		{name: "wrong mime", filename: "source.txt", contentType: "application/pdf", body: []byte("内容"), want: ErrInvalidMIMEType},
		{name: "nul", filename: "source.txt", contentType: "text/plain", body: []byte("a\x00b"), want: ErrInvalidDocument},
		{name: "empty", filename: "source.txt", contentType: "text/plain", body: nil, want: ErrInvalidDocument},
		{name: "oversized", filename: "source.txt", contentType: "text/plain", body: bytes.Repeat([]byte("a"), MaxDocumentBytes+1), want: ErrDocumentTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := ParseUpload(tt.filename, tt.contentType, tt.body)
			if !errors.Is(err, tt.want) {
				t.Fatalf("ParseUpload() error = %v, want %v", err, tt.want)
			}
		})
	}
}
