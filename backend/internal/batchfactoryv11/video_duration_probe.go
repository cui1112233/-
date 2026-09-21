package batchfactoryv11

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const maxVideoDurationProbeBytes = 512 << 20

// HTTPVideoDurationProbe downloads a completed HTTPS video to a bounded
// stream, then uses ffprobe to inspect the real container duration.
type HTTPVideoDurationProbe struct {
	Client *http.Client
}

func (p HTTPVideoDurationProbe) DurationSeconds(ctx context.Context, rawURL string) (float64, error) {
	endpoint, err := validateProductionURL(strings.TrimSpace(rawURL))
	if err != nil {
		return 0, fmt.Errorf("invalid completed media URL: %w", err)
	}
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Minute}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return 0, err
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("media download returned HTTP %d", response.StatusCode)
	}
	video, err := io.ReadAll(io.LimitReader(response.Body, maxVideoDurationProbeBytes+1))
	if err != nil {
		return 0, err
	}
	if len(video) == 0 || len(video) > maxVideoDurationProbeBytes {
		return 0, fmt.Errorf("media duration probe requires 1-%d bytes", maxVideoDurationProbeBytes)
	}
	durationMS, err := (FFprobeH3AudioDuration{}).DurationMS(ctx, video)
	if err != nil {
		return 0, err
	}
	seconds := float64(durationMS) / 1000
	if seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, fmt.Errorf("media duration probe returned invalid duration")
	}
	return seconds, nil
}
