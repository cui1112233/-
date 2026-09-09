package batchfactoryv11

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

const (
	H3WorkflowNoPicture   = "minimax_h3_lightx2v_no_pic"
	H3WorkflowWithPicture = "minimax_h3_lightx2v_v5_15s"
	maxH3ReferenceImages  = 3
)

func H3WorkflowForValidImages(imageURLs []string) string {
	if len(imageURLs) == 0 {
		return H3WorkflowNoPicture
	}
	return H3WorkflowWithPicture
}

func h3ImageURLs(values SettingsPatch) ([]string, error) {
	raw, ok := values["imageUrls"]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return []string{}, nil
	}
	var input []string
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, fmt.Errorf("%w: H3 imageUrls must be an array", ErrInvalid)
	}
	if len(input) > maxH3ReferenceImages {
		return nil, fmt.Errorf("%w: H3 accepts at most %d reference images", ErrInvalid, maxH3ReferenceImages)
	}
	result := make([]string, 0, len(input))
	for _, item := range input {
		value := strings.TrimSpace(item)
		if value == "" {
			return nil, fmt.Errorf("%w: H3 reference image URL is empty", ErrInvalid)
		}
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
			return nil, fmt.Errorf("%w: H3 reference images must use absolute HTTPS URLs", ErrInvalid)
		}
		result = append(result, parsed.String())
	}
	return result, nil
}
