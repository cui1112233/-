// Package documents parses source documents accepted by the commentary
// workbench. It deliberately uses only the standard library so deployments do
// not need a native office conversion dependency.
package documents

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"strings"

	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

const MaxDocumentBytes = 5 << 20

var (
	ErrUnsupportedDocument = errors.New("unsupported source document")
	ErrUnsafeFilename      = errors.New("unsafe source filename")
	ErrInvalidMIMEType     = errors.New("invalid source document MIME type")
	ErrInvalidDocument     = errors.New("invalid source document")
	ErrDocumentTooLarge    = errors.New("source document exceeds 5 MiB")
)

// ParseUpload converts an accepted source document into durable project text.
// The returned kind is deliberately narrow because it is stored only as input
// provenance, not used to dispatch executable behavior.
func ParseUpload(filename, contentType string, body []byte) (text, kind string, err error) {
	if !safeFilename(filename) {
		return "", "", ErrUnsafeFilename
	}
	if len(body) == 0 {
		return "", "", ErrInvalidDocument
	}
	if len(body) > MaxDocumentBytes {
		return "", "", ErrDocumentTooLarge
	}

	extension := strings.ToLower(path.Ext(filename))
	mediaType, _, mediaTypeErr := mime.ParseMediaType(contentType)
	if mediaTypeErr != nil || mediaType == "" {
		return "", "", ErrInvalidMIMEType
	}
	mediaType = strings.ToLower(mediaType)

	switch extension {
	case ".txt":
		if mediaType != "text/plain" {
			return "", "", ErrInvalidMIMEType
		}
		if bytes.IndexByte(body, 0) >= 0 {
			return "", "", ErrInvalidDocument
		}
		return finalizeText(stripUTF8BOM(body), "txt")
	case ".srt":
		if mediaType != "application/x-subrip" && mediaType != "text/srt" && mediaType != "text/plain" {
			return "", "", ErrInvalidMIMEType
		}
		if bytes.IndexByte(body, 0) >= 0 {
			return "", "", ErrInvalidDocument
		}
		return finalizeText([]byte(parseSRT(string(stripUTF8BOM(body)))), "srt")
	case ".docx":
		if mediaType != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
			return "", "", ErrInvalidMIMEType
		}
		text, err := parseDOCX(body)
		if err != nil {
			return "", "", err
		}
		return finalizeText([]byte(text), "docx")
	default:
		return "", "", ErrUnsupportedDocument
	}
}

func safeFilename(filename string) bool {
	return shuihuostorage.ValidObjectKey("shuihuo-production/1/1/source/"+filename) &&
		path.Ext(filename) != ""
}

func stripUTF8BOM(body []byte) []byte {
	return bytes.TrimPrefix(body, []byte{0xef, 0xbb, 0xbf})
}

func finalizeText(body []byte, kind string) (string, string, error) {
	if bytes.IndexByte(body, 0) >= 0 {
		return "", "", ErrInvalidDocument
	}
	text := normalizeText(string(body))
	if text == "" {
		return "", "", ErrInvalidDocument
	}
	return text, kind, nil
}

func normalizeText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.TrimSpace(text)
}

func parseSRT(text string) string {
	blocks := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n\n")
	cues := make([]string, 0, len(blocks))
	for _, block := range blocks {
		lines := strings.Split(block, "\n")
		start := 0
		for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
			start++
		}
		if start < len(lines) && isCueNumber(lines[start]) {
			start++
		}
		if start < len(lines) && strings.Contains(lines[start], "-->") {
			start++
		}
		content := make([]string, 0, len(lines)-start)
		for _, line := range lines[start:] {
			if line = strings.TrimSpace(line); line != "" {
				content = append(content, line)
			}
		}
		if len(content) > 0 {
			cues = append(cues, strings.Join(content, "\n"))
		}
	}
	return strings.Join(cues, "\n")
}

func isCueNumber(line string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return false
	}
	for _, character := range line {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func parseDOCX(body []byte) (string, error) {
	// A DOCX is a ZIP container and its binary headers legitimately contain NUL
	// bytes. Validate the decompressed XML payload instead of rejecting a valid
	// archive before it can be parsed.
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return "", fmt.Errorf("%w: DOCX 文件无法打开", ErrInvalidDocument)
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		body, err := file.Open()
		if err != nil {
			return "", fmt.Errorf("%w: DOCX 正文无法打开", ErrInvalidDocument)
		}
		contents, readErr := io.ReadAll(io.LimitReader(body, MaxDocumentBytes+1))
		closeErr := body.Close()
		if readErr != nil || closeErr != nil {
			return "", fmt.Errorf("%w: DOCX 正文无法读取", ErrInvalidDocument)
		}
		if len(contents) > MaxDocumentBytes || bytes.IndexByte(contents, 0) >= 0 {
			return "", ErrInvalidDocument
		}
		return parseDOCXDocumentXML(contents)
	}
	return "", fmt.Errorf("%w: DOCX 缺少正文", ErrInvalidDocument)
}

func parseDOCXDocumentXML(contents []byte) (string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(contents))
	paragraphs := make([]string, 0)
	var paragraph strings.Builder
	inParagraph := false
	inText := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("%w: DOCX 正文 XML 无效", ErrInvalidDocument)
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "p":
				inParagraph = true
				paragraph.Reset()
			case "t":
				inText = inParagraph
			}
		case xml.CharData:
			if inText {
				paragraph.Write([]byte(value))
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				inText = false
			case "p":
				if text := strings.TrimSpace(paragraph.String()); text != "" {
					paragraphs = append(paragraphs, text)
				}
				inParagraph = false
			}
		}
	}
	text := strings.Join(paragraphs, "\n")
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("%w: DOCX 不含可导入正文", ErrInvalidDocument)
	}
	return text, nil
}
