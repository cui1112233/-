package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qiantie/giant-material-executor/internal/update"
)

type releaseInput struct {
	Version, Platform, Architecture, URL, SHA256, MinimumExecutorVersion, PublishedAt string
}

func signedManifest(input releaseInput, privateKey ed25519.PrivateKey) (update.ReleaseManifest, error) {
	manifest := update.ReleaseManifest{SchemaVersion: 1, Version: input.Version, Platform: input.Platform, Architecture: input.Architecture, URL: input.URL, SHA256: input.SHA256, MinimumExecutorVersion: input.MinimumExecutorVersion, PublishedAt: input.PublishedAt}
	payload, err := manifest.SigningBytes()
	if err != nil {
		return update.ReleaseManifest{}, err
	}
	if len(privateKey) != ed25519.PrivateKeySize {
		return update.ReleaseManifest{}, errors.New("release signing key is invalid")
	}
	manifest.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return manifest, nil
}

func main() {
	artifact := flag.String("artifact", "", "release archive")
	privateKeyPath := flag.String("private-key", "", "base64 Ed25519 private-key file")
	output := flag.String("output", "", "manifest output path")
	version := flag.String("version", "", "release version")
	platform := flag.String("platform", "", "windows or macos")
	architecture := flag.String("architecture", "", "amd64 or universal")
	url := flag.String("url", "", "public archive URL")
	minimum := flag.String("minimum-version", "0.5.0", "minimum executor version")
	flag.Parse()
	if *artifact == "" || *privateKeyPath == "" || *output == "" || *version == "" || *platform == "" || *architecture == "" || *url == "" {
		flag.Usage()
		os.Exit(2)
	}
	archive, err := os.ReadFile(*artifact)
	if err != nil {
		panic(err)
	}
	keyText, err := os.ReadFile(*privateKeyPath)
	if err != nil {
		panic(err)
	}
	privateKeyBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(keyText)))
	if err != nil {
		panic("release signing key is not base64")
	}
	hash := sha256.Sum256(archive)
	manifest, err := signedManifest(releaseInput{Version: *version, Platform: *platform, Architecture: *architecture, URL: *url, SHA256: hex.EncodeToString(hash[:]), MinimumExecutorVersion: *minimum, PublishedAt: time.Now().UTC().Format(time.RFC3339)}, ed25519.PrivateKey(privateKeyBytes))
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Dir(*output), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(*output, append(data, '\n'), 0o644); err != nil {
		panic(err)
	}
}
