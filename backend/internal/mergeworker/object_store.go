package mergeworker

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"
)

type ObjectStore interface {
	PutMerged(context.Context, string, string) (string, error)
}

type PutFileFunc func(context.Context, string, string, string, string) error

type TOSObjectStore struct {
	Bucket        string
	PublicBaseURL string
	PutFile       PutFileFunc
}

var safeTaskID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func MergeObjectKey(taskID string) (string, error) {
	taskID = strings.TrimSpace(taskID)
	if !safeTaskID.MatchString(taskID) {
		return "", fmt.Errorf("invalid merge task id")
	}
	return "batch-factory-v11/merged/" + taskID + ".mp4", nil
}

func (s *TOSObjectStore) PutMerged(ctx context.Context, taskID, filePath string) (string, error) {
	if s == nil || s.PutFile == nil || strings.TrimSpace(s.Bucket) == "" || strings.TrimSpace(s.PublicBaseURL) == "" {
		return "", fmt.Errorf("TOS output store is not configured")
	}
	key, err := MergeObjectKey(taskID)
	if err != nil {
		return "", err
	}
	if err := s.PutFile(ctx, strings.TrimSpace(s.Bucket), key, filePath, "video/mp4"); err != nil {
		return "", fmt.Errorf("upload merged video failed")
	}
	base, err := url.Parse(strings.TrimSpace(s.PublicBaseURL))
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" {
		return "", fmt.Errorf("invalid TOS public base URL")
	}
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + path.Clean(key)
	base.RawQuery = ""
	base.Fragment = ""
	return base.String(), nil
}
