package models

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type GenericTaskState string

const (
	GenericTaskRunning   GenericTaskState = "running"
	GenericTaskSucceeded GenericTaskState = "succeeded"
	GenericTaskFailed    GenericTaskState = "failed"
)

type GenericTask struct {
	State     GenericTaskState
	ResultURL string
	Message   string
}

type GenericPollError struct {
	Transient bool
	Err       error
}

func (e *GenericPollError) Error() string {
	if e == nil || e.Err == nil {
		return "generic model polling failed"
	}
	return e.Err.Error()
}

func (e *GenericPollError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func IsTransientGenericPollError(err error) bool {
	var pollErr *GenericPollError
	return errors.As(err, &pollErr) && pollErr.Transient
}

// Poll executes the declarative pollingTemplate for asynchronous generic_http
// models. A minimal template looks like:
//
//	{
//	  "method": "GET",
//	  "endpoint": "https://provider.example/tasks/{{provider_task_id}}",
//	  "headers": {"Authorization": "Bearer {{credential}}"},
//	  "statusPath": "status",
//	  "resultUrl": "content.video_url"
//	}
func (a *GenericHTTPAdapter) Poll(ctx context.Context, model Definition, providerTaskID string) (GenericTask, error) {
	if model.AdapterKind != AdapterGenericHTTP {
		return GenericTask{}, pollConfigError("model adapter is not generic_http")
	}
	providerTaskID = strings.TrimSpace(providerTaskID)
	if providerTaskID == "" {
		return GenericTask{}, pollConfigError("provider task ID is required")
	}
	if strings.TrimSpace(model.PollingTemplate) == "" {
		return GenericTask{}, pollConfigError("generic async model polling template is required")
	}

	credential := ""
	if strings.TrimSpace(model.CredentialRef) != "" {
		if a.credentials == nil {
			return GenericTask{}, pollConfigError("credential resolver is required")
		}
		resolved, err := a.credentials(model.CredentialRef)
		if err != nil {
			return GenericTask{}, &GenericPollError{Err: fmt.Errorf("resolve model credential: %w", err)}
		}
		credential = resolved
	}

	var template struct {
		Method      string            `json:"method"`
		Endpoint    string            `json:"endpoint"`
		URL         string            `json:"url"`
		Path        string            `json:"path"`
		Headers     map[string]string `json:"headers"`
		Body        any               `json:"body"`
		StatusPath  string            `json:"statusPath"`
		Status      string            `json:"status"`
		ResultURL   string            `json:"resultUrl"`
		MessagePath string            `json:"messagePath"`
		Message     string            `json:"message"`
		States      struct {
			Running   []string `json:"running"`
			Succeeded []string `json:"succeeded"`
			Failed    []string `json:"failed"`
		} `json:"states"`
		ResponseMapping struct {
			Status    string `json:"status"`
			ResultURL string `json:"resultUrl"`
			Message   string `json:"message"`
		} `json:"responseMapping"`
	}
	if err := json.Unmarshal([]byte(model.PollingTemplate), &template); err != nil {
		return GenericTask{}, &GenericPollError{Err: fmt.Errorf("decode polling template: %w", err)}
	}

	method := strings.ToUpper(strings.TrimSpace(template.Method))
	if method == "" {
		method = http.MethodGet
	}
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodPut {
		return GenericTask{}, pollConfigError(fmt.Sprintf("unsupported polling method %q", method))
	}
	endpoint, err := a.genericPollingEndpoint(model, firstPollingValue(template.Endpoint, template.URL), template.Path, providerTaskID, credential)
	if err != nil {
		return GenericTask{}, &GenericPollError{Err: err}
	}

	var bodyReader io.Reader
	if template.Body != nil {
		body, err := json.Marshal(renderPollingValue(template.Body, providerTaskID, credential))
		if err != nil {
			return GenericTask{}, &GenericPollError{Err: fmt.Errorf("encode polling request: %w", err)}
		}
		bodyReader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bodyReader)
	if err != nil {
		return GenericTask{}, &GenericPollError{Err: err}
	}
	if bodyReader != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range template.Headers {
		request.Header.Set(key, renderPollingString(value, providerTaskID, credential))
	}

	response, err := a.client.Do(request)
	if err != nil {
		return GenericTask{}, &GenericPollError{Transient: true, Err: fmt.Errorf("poll model: %w", err)}
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxModelResponseBytes+1))
	if err != nil {
		return GenericTask{}, &GenericPollError{Transient: true, Err: fmt.Errorf("read polling response: %w", err)}
	}
	if len(responseBody) > maxModelResponseBytes {
		return GenericTask{}, pollConfigError("polling response exceeds size limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		transient := response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		return GenericTask{}, &GenericPollError{Transient: transient, Err: fmt.Errorf("model polling returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))}
	}

	var payload any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return GenericTask{}, &GenericPollError{Err: fmt.Errorf("decode polling response JSON: %w", err)}
	}
	statusPath := firstPollingValue(template.StatusPath, template.Status, template.ResponseMapping.Status, "status")
	resultPath := firstPollingValue(template.ResultURL, template.ResponseMapping.ResultURL)
	messagePath := firstPollingValue(template.MessagePath, template.Message, template.ResponseMapping.Message, "message")
	status := strings.ToLower(lookupPollingString(payload, statusPath))
	if status == "" {
		return GenericTask{}, pollConfigError(fmt.Sprintf("polling response did not contain configured status %q", statusPath))
	}

	state := genericTaskState(status, template.States.Running, template.States.Succeeded, template.States.Failed)
	result := GenericTask{State: state, Message: lookupPollingString(payload, messagePath)}
	switch state {
	case GenericTaskRunning:
		return result, nil
	case GenericTaskFailed:
		if result.Message == "" {
			result.Message = "视频生成失败"
		}
		return result, nil
	case GenericTaskSucceeded:
		if resultPath == "" {
			return GenericTask{}, pollConfigError("polling template requires resultUrl for succeeded tasks")
		}
		result.ResultURL = lookupPollingString(payload, resultPath)
		if result.ResultURL == "" {
			return GenericTask{}, pollConfigError(fmt.Sprintf("completed polling response did not contain configured result URL %q", resultPath))
		}
		validateURL := a.validateURL
		if validateURL == nil {
			validateURL = ValidateOutboundURL
		}
		if _, err := validateURL(result.ResultURL); err != nil {
			return GenericTask{}, &GenericPollError{Err: fmt.Errorf("validate polling result URL: %w", err)}
		}
		return result, nil
	default:
		return GenericTask{}, pollConfigError(fmt.Sprintf("polling response returned unconfigured status %q", status))
	}
}

func (a *GenericHTTPAdapter) genericPollingEndpoint(model Definition, endpointTemplate, pathTemplate, providerTaskID, credential string) (*url.URL, error) {
	raw := strings.TrimSpace(endpointTemplate)
	if raw != "" {
		raw = renderPollingString(raw, providerTaskID, credential)
	} else {
		if strings.TrimSpace(pathTemplate) == "" {
			return nil, fmt.Errorf("polling template requires endpoint/url or path")
		}
		if strings.TrimSpace(model.BaseDomain) == "" {
			return nil, fmt.Errorf("polling path requires model baseDomain")
		}
		base, err := url.Parse(strings.TrimRight(strings.TrimSpace(model.BaseDomain), "/"))
		if err != nil || base.Scheme == "" || base.Host == "" {
			return nil, fmt.Errorf("invalid model baseDomain")
		}
		pathValue := renderPollingString(pathTemplate, providerTaskID, credential)
		relative, err := url.Parse(pathValue)
		if err != nil || relative.IsAbs() || relative.Host != "" {
			return nil, fmt.Errorf("invalid polling path")
		}
		base.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimLeft(relative.Path, "/")
		base.RawQuery = relative.RawQuery
		raw = base.String()
	}
	validateURL := a.validateURL
	if validateURL == nil {
		validateURL = ValidateOutboundURL
	}
	endpoint, err := validateURL(raw)
	if err != nil {
		return nil, fmt.Errorf("validate polling endpoint: %w", err)
	}
	return endpoint, nil
}

func renderPollingValue(value any, providerTaskID, credential string) any {
	switch typed := value.(type) {
	case string:
		return renderPollingString(typed, providerTaskID, credential)
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = renderPollingValue(item, providerTaskID, credential)
		}
		return result
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[key] = renderPollingValue(item, providerTaskID, credential)
		}
		return result
	default:
		return value
	}
}

func renderPollingString(value, providerTaskID, credential string) string {
	return strings.NewReplacer(
		"{{provider_task_id}}", providerTaskID,
		"{{providerTaskId}}", providerTaskID,
		"{{task_id}}", providerTaskID,
		"{{credential}}", credential,
	).Replace(value)
}

func lookupPollingString(value any, rawPath string) string {
	path := strings.Trim(strings.TrimSpace(rawPath), ".")
	if path == "" {
		return ""
	}
	path = strings.ReplaceAll(path, "[", ".")
	path = strings.ReplaceAll(path, "]", "")
	current := value
	for _, key := range strings.Split(path, ".") {
		switch typed := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = typed[key]
			if !ok {
				return ""
			}
		case []any:
			index, err := strconv.Atoi(key)
			if err != nil || index < 0 || index >= len(typed) {
				return ""
			}
			current = typed[index]
		default:
			return ""
		}
	}
	text, ok := current.(string)
	if ok {
		return strings.TrimSpace(text)
	}
	if current == nil {
		return ""
	}
	switch current.(type) {
	case float64, bool, json.Number:
		return strings.TrimSpace(fmt.Sprint(current))
	default:
		return ""
	}
}

func genericTaskState(status string, running, succeeded, failed []string) GenericTaskState {
	if len(running) == 0 {
		running = []string{"queued", "pending", "running", "processing", "in_progress"}
	}
	if len(succeeded) == 0 {
		succeeded = []string{"success", "succeeded", "completed", "complete"}
	}
	if len(failed) == 0 {
		failed = []string{"failed", "error", "cancelled", "canceled"}
	}
	if pollingContains(succeeded, status) {
		return GenericTaskSucceeded
	}
	if pollingContains(failed, status) {
		return GenericTaskFailed
	}
	if pollingContains(running, status) {
		return GenericTaskRunning
	}
	return ""
}

func pollingContains(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func firstPollingValue(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func pollConfigError(message string) error {
	return &GenericPollError{Err: errors.New(message)}
}
