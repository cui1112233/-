package web

import "embed"

// Assets contains the frontend bundle and prompt snapshots prepared by the
// release build. The HTTP serving adapter is added when the Go page routes are
// migrated; keeping the filesystem here makes the binary boundary explicit.
//
//go:embed dist prompts
var Assets embed.FS
