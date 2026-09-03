package novelfetchworkshop

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
)

func encodeBody(content string) ([]byte, string, int64, error) {
	raw := []byte(content)
	sum := sha256.Sum256(raw)

	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(raw); err != nil {
		_ = writer.Close()
		return nil, "", 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, "", 0, err
	}

	return buffer.Bytes(), hex.EncodeToString(sum[:]), int64(len([]rune(content))), nil
}

func decodeBody(blob []byte, encoding string) (string, error) {
	if encoding != "gzip" {
		return "", errors.New("unsupported body encoding")
	}
	reader, err := gzip.NewReader(bytes.NewReader(blob))
	if err != nil {
		return "", err
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
