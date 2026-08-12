package providers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"qiantie/backend/internal/shuihuo/models"
)

const (
	jimengEndpoint      = "https://visual.volcengineapi.com/?Action=CVProcess&Version=2022-08-31"
	jimengHost          = "visual.volcengineapi.com"
	jimengRegion        = "cn-north-1"
	jimengService       = "cv"
	jimengRequestKey    = "high_aes_general_v30l"
	maxJimengReplyBytes = 2 << 20
)

// Jimeng is a fixed Volcengine image adapter. It deliberately accepts no
// endpoint or request-template from the model catalog.
type Jimeng struct {
	client            *http.Client
	credentials       models.CredentialResolver
	validateResultURL func(string) (*url.URL, error)
	now               func() time.Time
}

func NewJimeng(client *http.Client, credentials models.CredentialResolver) *Jimeng {
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	return &Jimeng{
		client:            client,
		credentials:       credentials,
		validateResultURL: models.ValidateOutboundURL,
		now:               time.Now,
	}
}

func (p *Jimeng) Submit(ctx context.Context, model models.Definition, request models.Request) (models.Response, error) {
	if model.AdapterKind != models.AdapterJimengImage || model.Kind != models.KindImage {
		return models.Response{}, fmt.Errorf("model adapter is not jimeng_image")
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return models.Response{}, fmt.Errorf("image prompt is required")
	}
	if p.credentials == nil {
		return models.Response{}, fmt.Errorf("Volcengine credential resolver is required")
	}
	accessKeyID, err := p.credentials("VOLCENGINE_ACCESS_KEY_ID")
	if err != nil || strings.TrimSpace(accessKeyID) == "" {
		return models.Response{}, fmt.Errorf("Volcengine access key is not configured")
	}
	secretAccessKey, err := p.credentials("VOLCENGINE_SECRET_ACCESS_KEY")
	if err != nil || strings.TrimSpace(secretAccessKey) == "" {
		return models.Response{}, fmt.Errorf("Volcengine secret key is not configured")
	}
	body, err := json.Marshal(map[string]string{"req_key": jimengRequestKey, "prompt": strings.TrimSpace(request.Prompt)})
	if err != nil {
		return models.Response{}, fmt.Errorf("encode Jimeng request: %w", err)
	}
	requestURL, err := url.Parse(jimengEndpoint)
	if err != nil {
		return models.Response{}, fmt.Errorf("parse Jimeng endpoint: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), bytes.NewReader(body))
	if err != nil {
		return models.Response{}, err
	}
	signed := SignVolcengineRequest(accessKeyID, secretAccessKey, p.now().UTC(), body)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Host", jimengHost)
	httpRequest.Header.Set("X-Date", signed.XDate)
	httpRequest.Header.Set("X-Content-Sha256", signed.ContentSHA256)
	httpRequest.Header.Set("Authorization", signed.Authorization)

	response, err := p.client.Do(httpRequest)
	if err != nil {
		return models.Response{}, fmt.Errorf("call Jimeng: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxJimengReplyBytes+1))
	if err != nil {
		return models.Response{}, fmt.Errorf("read Jimeng response: %w", err)
	}
	if len(payload) > maxJimengReplyBytes {
		return models.Response{}, fmt.Errorf("Jimeng response exceeds size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return models.Response{}, fmt.Errorf("Jimeng returned HTTP %d", response.StatusCode)
	}
	result, err := ParseJimengResult(string(payload))
	if err != nil {
		return models.Response{}, err
	}
	validateResultURL := p.validateResultURL
	if validateResultURL == nil {
		validateResultURL = models.ValidateOutboundURL
	}
	if _, err := validateResultURL(result.ResultURL); err != nil {
		return models.Response{}, fmt.Errorf("validate Jimeng result URL: %w", err)
	}
	return result, nil
}

type VolcengineSignature struct {
	Authorization string
	XDate         string
	ContentSHA256 string
}

// SignVolcengineRequest signs the fixed Jimeng CVProcess request using the
// documented Volcengine HMAC-SHA256 canonical-request scheme.
func SignVolcengineRequest(accessKeyID, secretAccessKey string, at time.Time, body []byte) VolcengineSignature {
	xDate := at.UTC().Format("20060102T150405Z")
	date := at.UTC().Format("20060102")
	payloadHash := sha256Hex(body)
	canonicalHeaders := "content-type:application/json\n" +
		"host:" + jimengHost + "\n" +
		"x-content-sha256:" + payloadHash + "\n" +
		"x-date:" + xDate + "\n"
	signedHeaders := "content-type;host;x-content-sha256;x-date"
	canonicalRequest := strings.Join([]string{
		http.MethodPost,
		"/",
		"Action=CVProcess&Version=2022-08-31",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := date + "/" + jimengRegion + "/" + jimengService + "/request"
	stringToSign := strings.Join([]string{"HMAC-SHA256", xDate, scope, sha256Hex([]byte(canonicalRequest))}, "\n")
	signingKey := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte(secretAccessKey), date), jimengRegion), jimengService), "request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	return VolcengineSignature{
		Authorization: "HMAC-SHA256 Credential=" + accessKeyID + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
		XDate:         xDate,
		ContentSHA256: payloadHash,
	}
}

func ParseJimengResult(raw string) (models.Response, error) {
	var payload struct {
		Code int `json:"code"`
		Data struct {
			ImageURLs []string `json:"image_urls"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return models.Response{}, fmt.Errorf("decode Jimeng response: %w", err)
	}
	if payload.Code != 10000 {
		return models.Response{}, fmt.Errorf("Jimeng rejected image request")
	}
	if len(payload.Data.ImageURLs) == 0 || strings.TrimSpace(payload.Data.ImageURLs[0]) == "" {
		return models.Response{}, fmt.Errorf("Jimeng response did not contain an image URL")
	}
	return models.Response{ResultURL: strings.TrimSpace(payload.Data.ImageURLs[0])}, nil
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
