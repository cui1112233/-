package uploads

import (
	"encoding/base64"
	"errors"
	"mime"
	"path/filepath"
	"strings"
)

const maxDecodedUploadBytes = 100 << 20

var errInvalidUpload = errors.New("invalid upload data")

type DecodedUpload struct {
	Filename    string
	Category    string
	ContentType string
	Body        []byte
}

var allowedContentTypes = map[string]map[string]struct{}{
	"image": {
		"image/jpeg": {},
		"image/png":  {},
		"image/webp": {},
		"image/gif":  {},
	},
	"video": {
		"video/mp4":       {},
		"video/webm":      {},
		"video/quicktime": {},
	},
	"audio": {
		"audio/mpeg":  {},
		"audio/mp3":   {},
		"audio/wav":   {},
		"audio/x-wav": {},
		"audio/mp4":   {},
		"audio/aac":   {},
		"audio/ogg":   {},
		"audio/webm":  {},
	},
}

var kindCategories = map[string]string{
	"image": "images",
	"video": "videos",
	"audio": "audio",
}

func DecodeDataURL(raw, filename, kind string) (DecodedUpload, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	category, ok := kindCategories[kind]
	if !ok {
		return DecodedUpload{}, errInvalidUpload
	}

	filename = strings.TrimSpace(filename)
	if !safeFilename(filename) {
		return DecodedUpload{}, errInvalidUpload
	}

	header, encoded, ok := strings.Cut(strings.TrimSpace(raw), ",")
	if !ok || !strings.HasPrefix(strings.ToLower(header), "data:") || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return DecodedUpload{}, errInvalidUpload
	}

	contentType := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64"))
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if _, ok := allowedContentTypes[kind][contentType]; !ok {
		return DecodedUpload{}, errInvalidUpload
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(decoded) == 0 || len(decoded) > maxDecodedUploadBytes {
		return DecodedUpload{}, errInvalidUpload
	}

	if !extensionMatchesContentType(filename, contentType) {
		return DecodedUpload{}, errInvalidUpload
	}

	return DecodedUpload{
		Filename:    filename,
		Category:    category,
		ContentType: contentType,
		Body:        decoded,
	}, nil
}

func safeFilename(filename string) bool {
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	if strings.ContainsAny(filename, "/\\\x00") {
		return false
	}
	return filepath.Base(filename) == filename
}

func extensionMatchesContentType(filename, contentType string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		return false
	}
	extensions, _ := mime.ExtensionsByType(contentType)
	for _, candidate := range extensions {
		if strings.EqualFold(candidate, ext) {
			return true
		}
	}

	// Go's MIME database varies by platform. Keep the formats qiantie accepts
	// deterministic across local machines and minimal containers.
	fallback := map[string][]string{
		"image/jpeg":      {".jpg", ".jpeg"},
		"image/png":       {".png"},
		"image/webp":      {".webp"},
		"image/gif":       {".gif"},
		"video/mp4":       {".mp4"},
		"video/webm":      {".webm"},
		"video/quicktime": {".mov"},
		"audio/mpeg":      {".mp3"},
		"audio/mp3":       {".mp3"},
		"audio/wav":       {".wav"},
		"audio/x-wav":     {".wav"},
		"audio/mp4":       {".m4a", ".mp4"},
		"audio/aac":       {".aac"},
		"audio/ogg":       {".ogg", ".oga"},
		"audio/webm":      {".webm"},
	}
	for _, candidate := range fallback[contentType] {
		if candidate == ext {
			return true
		}
	}
	return false
}
