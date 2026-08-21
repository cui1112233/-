package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/shuihuo/domain"
	"qiantie/backend/internal/shuihuo/models"
	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
	shuihuotasks "qiantie/backend/internal/shuihuo/tasks"
	"qiantie/backend/internal/store"
)

type memoryUserStore struct {
	users map[int64]store.User
}

func (s *memoryUserStore) EnsureBridgeUser(_ context.Context, username string, isOwner bool) (store.User, error) {
	for _, user := range s.users {
		if user.Username == username {
			return user, nil
		}
	}
	id := int64(len(s.users) + 100)
	user := store.User{ID: id, Username: username, IsOwner: isOwner, IsActive: true}
	s.users[id] = user
	return user, nil
}

func (s *memoryUserStore) FindByUsername(_ context.Context, username string) (store.User, error) {
	for _, user := range s.users {
		if user.Username == username {
			return user, nil
		}
	}
	return store.User{}, sql.ErrNoRows
}

func (s *memoryUserStore) FindByID(_ context.Context, id int64) (store.User, error) {
	user, ok := s.users[id]
	if !ok {
		return store.User{}, sql.ErrNoRows
	}
	return user, nil
}

func newShuihuoTestAPI(t *testing.T, users map[int64]store.User) (*API, string) {
	t.Helper()
	const secret = "test-secret"
	return New(Dependencies{
		TokenSecret:  secret,
		BridgeSecret: "bridge-test-secret",
		Users:        &memoryUserStore{users: users},
	}), secret
}

func bridgeRequest(t *testing.T, method, requestPath, username string, isOwner bool) *http.Request {
	t.Helper()
	issuedAt := strconv.FormatInt(time.Now().Unix(), 10)
	payload := strings.Join([]string{username, issuedAt, strconv.FormatBool(isOwner), method, requestPath}, "\n")
	mac := hmac.New(sha256.New, []byte("bridge-test-secret"))
	_, _ = mac.Write([]byte(payload))
	req := httptest.NewRequest(method, requestPath, nil)
	req.Header.Set("X-Qiantie-Username", username)
	req.Header.Set("X-Qiantie-Is-Owner", strconv.FormatBool(isOwner))
	req.Header.Set("X-Qiantie-Issued-At", issuedAt)
	req.Header.Set("X-Qiantie-Signature", hex.EncodeToString(mac.Sum(nil)))
	return req
}

func authorizedRequest(t *testing.T, secret string, user store.User, method, path string) *http.Request {
	t.Helper()
	token, err := auth.NewToken(secret, user.ID, user.Username)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

func TestShuihuoProjectsRequiresAuthentication(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, nil)
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/shuihuo-production/projects", nil))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestRenderSmartSegmentationPromptSubstitutesNovelText(t *testing.T) {
	got := renderSmartSegmentationPrompt("规则\n{{novel_text}}", "第一段\n第二段")
	if !strings.Contains(got, "规则\n第一段\n第二段") {
		t.Fatalf("rendered prompt should preserve novel text = %q", got)
	}
}

func TestRenderSmartSegmentationPromptRequiresSpeakerForEveryCandidate(t *testing.T) {
	prompt := renderSmartSegmentationPrompt("处理小说：{{novel_text}}", "都成年了，谁还装乖宝宝？")
	for _, required := range []string{"都成年了，谁还装乖宝宝？", `"speaker"`, "旁白"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("rendered smart segmentation prompt missing %q: %s", required, prompt)
		}
	}
}

func TestPromptCandidatesDoNotSupportNegativePromptKind(t *testing.T) {
	if _, ok := promptPurpose("negative"); ok {
		t.Fatal("negative prompt candidates must not be supported")
	}
}

func TestAccountAPITextModelUsesCurrentUserConfig(t *testing.T) {
	configs := &recordingConfigStore{config: store.APIConfig{
		BaseURL:          "https://models.example.com/v1",
		Model:            "account-text-model",
		APIKeyCiphertext: "test-only-secret",
	}}
	api := New(Dependencies{Configs: configs})
	model, provider, err := api.textCompletionForUser(context.Background(), 42, models.Definition{
		Name:          "当前账号 API 文本模型",
		Kind:          models.KindText,
		AdapterKind:   models.AdapterTextCompletion,
		CredentialRef: accountAPIConfigCredentialRef,
	})
	if err != nil {
		t.Fatalf("textCompletionForUser() error = %v", err)
	}
	if configs.userID != 42 {
		t.Fatalf("config user ID = %d, want 42", configs.userID)
	}
	if model.Endpoint != "https://models.example.com/v1" || model.Name != "account-text-model" {
		t.Fatalf("configured model = %#v", model)
	}
	if provider == nil {
		t.Fatal("account-configured text completion provider is required")
	}
}

type recordingConfigStore struct {
	config store.APIConfig
	userID int64
}

func (s *recordingConfigStore) Get(_ context.Context, userID int64) (store.APIConfig, error) {
	s.userID = userID
	return s.config, nil
}

func (s *recordingConfigStore) Save(_ context.Context, userID int64, config store.APIConfig) error {
	s.userID = userID
	s.config = config
	return nil
}

type recordingImageConfigStore struct {
	config store.ImageAPIConfig
	userID int64
}

func (s *recordingImageConfigStore) Get(_ context.Context, userID int64) (store.ImageAPIConfig, error) {
	s.userID = userID
	return s.config, nil
}

func (s *recordingImageConfigStore) Save(_ context.Context, userID int64, config store.ImageAPIConfig) error {
	s.userID = userID
	s.config = config
	return nil
}

func TestPlatformAccountAIConfigSyncPersistsCredentialWithoutExposingIt(t *testing.T) {
	configs := &recordingConfigStore{}
	api := New(Dependencies{
		BridgeSecret: "bridge-test-secret",
		Users:        &memoryUserStore{users: map[int64]store.User{}},
		Configs:      configs,
	})
	req := bridgeRequest(t, http.MethodPut, "/api/shuihuo-production/account-ai-config", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"provider":"custom","baseUrl":"https://models.example.com/v1","model":"example-text","apiKey":"test-account-key"}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("PUT account AI config status = %d, body = %s", response.Code, response.Body.String())
	}
	if configs.userID == 0 || configs.config.APIKeyCiphertext != "test-account-key" {
		t.Fatalf("saved config = %#v, userID = %d", configs.config, configs.userID)
	}
	if strings.Contains(response.Body.String(), "test-account-key") || !strings.Contains(response.Body.String(), `"hasApiKey":true`) {
		t.Fatalf("public response leaked or omitted credential state: %s", response.Body.String())
	}
}

func TestPlatformAccountAIConfigSyncPersistsImageCredentialWithoutExposingIt(t *testing.T) {
	configs := &recordingConfigStore{}
	imageConfigs := &recordingImageConfigStore{}
	api := New(Dependencies{
		BridgeSecret: "bridge-test-secret",
		Users:        &memoryUserStore{users: map[int64]store.User{}},
		Configs:      configs,
		ImageConfigs: imageConfigs,
	})
	req := bridgeRequest(t, http.MethodPut, "/api/shuihuo-production/account-ai-config", "image-producer", false)
	req.Body = io.NopCloser(strings.NewReader("{\"image\":{\"provider\":\"openai_compatible\",\"displayName\":\"Custom image gateway\",\"baseUrl\":\"https://images.example/v1\",\"model\":\"image-model\",\"apiKey\":\"image-secret\"}}"))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("PUT account image config status = %d, body = %s", response.Code, response.Body.String())
	}
	if imageConfigs.userID == 0 || imageConfigs.config.Provider != "openai_compatible" || imageConfigs.config.DisplayName != "Custom image gateway" || imageConfigs.config.BaseURL != "https://images.example/v1" || imageConfigs.config.Model != "image-model" || imageConfigs.config.APIKeyCiphertext != "image-secret" {
		t.Fatalf("saved image config = %#v, userID = %d", imageConfigs.config, imageConfigs.userID)
	}
	if strings.Contains(response.Body.String(), "image-secret") || !strings.Contains(response.Body.String(), "\"displayName\":\"Custom image gateway\"") || !strings.Contains(response.Body.String(), "\"hasApiKey\":true") {
		t.Fatalf("public response leaked or omitted image credential state: %s", response.Body.String())
	}
	if configs.userID != 0 {
		t.Fatalf("image-only bridge save unexpectedly updated text config for user %d", configs.userID)
	}
}

func TestPlatformAccountAIConfigSyncPersistsVideoCredentialWithoutExposingIt(t *testing.T) {
	configs := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	api := New(Dependencies{
		BridgeSecret:     "bridge-test-secret",
		Users:            &memoryUserStore{users: map[int64]store.User{}},
		Configs:          &recordingConfigStore{},
		VideoConfigs:     configs,
		CredentialCipher: testCredentialCipher(t),
	})
	req := bridgeRequest(t, http.MethodPut, "/api/shuihuo-production/account-ai-config", "video-producer", false)
	plaintext := "video-secret"
	req.Body = io.NopCloser(strings.NewReader(`{"video":{"provider":"yd_video","apiKey":"` + plaintext + `"}}`))
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("PUT account video config status = %d, body = %s", response.Code, response.Body.String())
	}
	userID := int64(100)
	saved := configs.configs[userID]
	if saved.Provider != store.YDVideoProvider || saved.APIKeyCiphertext == plaintext || saved.APIKeyCiphertext == "" {
		t.Fatalf("saved video config = %#v", saved)
	}
	decrypted, err := api.deps.CredentialCipher.Decrypt(saved.APIKeyCiphertext)
	if err != nil || decrypted != plaintext {
		t.Fatalf("saved video ciphertext decrypt = %q, %v", decrypted, err)
	}
	if strings.Contains(response.Body.String(), plaintext) || strings.Contains(response.Body.String(), saved.APIKeyCiphertext) || !strings.Contains(response.Body.String(), `"video":{"displayName":"中转亚迪","hasApiKey":true,"provider":"yd_video"}`) {
		t.Fatalf("public response leaked or omitted video credential state: %s", response.Body.String())
	}
}

func TestAccountOpenAICompatibleImageModelIsAvailableOnlyWithCompleteConfiguration(t *testing.T) {
	configs := &recordingImageConfigStore{config: store.ImageAPIConfig{
		Provider: store.OpenAICompatibleImageProvider, DisplayName: "Custom image gateway", BaseURL: "https://images.example/v1", Model: "image-model", APIKeyCiphertext: "image-secret",
	}}
	api := New(Dependencies{ImageConfigs: configs})

	model, configured, err := api.accountOpenAICompatibleImageModel(context.Background(), 42)

	if err != nil || !configured {
		t.Fatalf("configured account image model = %#v, %t, %v", model, configured, err)
	}
	if model.ID != accountOpenAICompatibleImageModelID || model.Kind != models.KindImage || model.AdapterKind != models.AdapterAccountOpenAICompatibleImage || model.Name != "当前账号 Custom image gateway 生图" {
		t.Fatalf("account image model = %#v", model)
	}
	configs.config.APIKeyCiphertext = ""
	_, configured, err = api.accountOpenAICompatibleImageModel(context.Background(), 42)
	if err != nil || configured {
		t.Fatalf("incomplete image config configured = %t, err = %v", configured, err)
	}
}

func TestShuihuoProjectExportRouteRequiresConfiguredDependencies(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects/1/export", "producer", false))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET project export status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestShuihuoProjectsAcceptPlatformGatewayIdentity(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects", "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("GET projects with gateway identity status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestShuihuoProjectsRejectBadPlatformGatewaySignature(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	req := bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects", "producer", false)
	req.Header.Set("X-Qiantie-Signature", "bad")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects with invalid gateway signature status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestAdminModelsRejectsActiveNonOwner(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/admin/models", "member", false))

	if response.Code != http.StatusForbidden {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestAdminModelsReturnsEmptyArrayForOwner(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/admin/models", "owner", true))

	if response.Code != http.StatusOK {
		t.Fatalf("GET admin models status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Models []json.RawMessage `json:"models"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Models == nil || len(payload.Models) != 0 {
		t.Fatalf("models = %#v, want empty array", payload.Models)
	}
}

func TestAdminModelCreateRejectsUnapprovedAdapterBeforePersistence(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	api.deps.DB = &sql.DB{}
	response := httptest.NewRecorder()
	req := bridgeRequest(t, http.MethodPost, "/api/shuihuo-production/admin/models", "owner", true)
	req.Body = io.NopCloser(strings.NewReader(`{"name":"危险模型","kind":"image","adapterKind":"arbitrary_shell","credentialRef":"MODEL_KEY"}`))
	req.Header.Set("Content-Type", "application/json")

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("POST unapproved model status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestAdminModelRequestMapsModelID(t *testing.T) {
	var req shuihuoAdminModelRequest
	if err := json.Unmarshal([]byte(`{"modelId":"video-vidu-admin","name":"Vidu","kind":"video","adapterKind":"vidu_image_to_video","enabled":true,"credentialRef":"VIDU_API_KEY"}`), &req); err != nil {
		t.Fatalf("unmarshal admin model request: %v", err)
	}

	definition := req.definition()
	if definition.ModelID != "video-vidu-admin" {
		t.Fatalf("definition modelId = %q, want video-vidu-admin", definition.ModelID)
	}
	if err := models.ValidateDefinition(definition); err != nil {
		t.Fatalf("ValidateDefinition() error = %v", err)
	}
}

func TestAdminModelRequestRejectsMissingModelID(t *testing.T) {
	var req shuihuoAdminModelRequest
	if err := json.Unmarshal([]byte(`{"name":"Vidu","kind":"video","adapterKind":"vidu_image_to_video","credentialRef":"VIDU_API_KEY"}`), &req); err != nil {
		t.Fatalf("unmarshal admin model request: %v", err)
	}

	if err := models.ValidateDefinition(req.definition()); err == nil {
		t.Fatal("ValidateDefinition() accepted a new admin model without modelId")
	}
}

func TestAdminModelWriteRejectsNonOwner(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()
	req := bridgeRequest(t, http.MethodPost, "/api/shuihuo-production/admin/models", "member", false)
	req.Body = io.NopCloser(strings.NewReader(`{"name":"图片模型","kind":"image","adapterKind":"generic_http"}`))
	req.Header.Set("Content-Type", "application/json")

	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusForbidden {
		t.Fatalf("POST admin model status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestShuihuoProjectsReturnsEmptyArrayForCurrentUser(t *testing.T) {
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, bridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects", "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("GET projects status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Projects []json.RawMessage `json:"projects"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Projects == nil || len(payload.Projects) != 0 {
		t.Fatalf("projects = %#v, want empty array", payload.Projects)
	}
}

func TestShuihuoProjectReadIncludesSourceUnitsAndMappings(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	project := batchTaskTestState.projects[1]
	project.SegmentationVersion = 2
	batchTaskTestState.projects[1] = project
	batchTaskTestState.sourceUnits = []domain.SourceUnit{
		{ID: 201, ProjectID: 1, Text: "旧版雨夜车站", SourceKind: "confirmed_candidate", SegmentationVersion: 1, SourceOrder: 1, CreatedAt: time.Now()},
		{ID: 202, ProjectID: 1, Text: "新版雨夜车站", SourceKind: "confirmed_candidate", SegmentationVersion: 2, SourceOrder: 1, CreatedAt: time.Now()},
	}
	batchTaskTestState.sourceMappings = map[int64][]int64{11: {201, 202}}
	response := httptest.NewRecorder()
	path := "/api/shuihuo-production/projects/1"
	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodGet, path, "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("GET project = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments             []domain.Segment    `json:"segments"`
		SourceUnits          []domain.SourceUnit `json:"sourceUnits"`
		SegmentSourceUnitIDs map[string][]int64  `json:"segmentSourceUnitIDs"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode project response: %v", err)
	}
	if len(payload.SourceUnits) != 1 || payload.SourceUnits[0].ID != 202 {
		t.Fatalf("sourceUnits = %#v", payload.SourceUnits)
	}
	if payload.SourceUnits[0].SegmentationVersion != 2 {
		t.Fatalf("source unit segmentation version = %d, want 2", payload.SourceUnits[0].SegmentationVersion)
	}
	if got := payload.SegmentSourceUnitIDs["11"]; len(got) != 1 || got[0] != 202 {
		t.Fatalf("segmentSourceUnitIDs = %#v", payload.SegmentSourceUnitIDs)
	}
	segmentIDs := make(map[int64]struct{}, len(payload.Segments))
	for _, segment := range payload.Segments {
		segmentIDs[segment.ID] = struct{}{}
	}
	sourceUnitIDs := make(map[int64]struct{}, len(payload.SourceUnits))
	for _, unit := range payload.SourceUnits {
		sourceUnitIDs[unit.ID] = struct{}{}
	}
	for segmentIDText, sourceIDs := range payload.SegmentSourceUnitIDs {
		segmentID, err := strconv.ParseInt(segmentIDText, 10, 64)
		if err != nil {
			t.Fatalf("invalid mapped segment ID %q: %v", segmentIDText, err)
		}
		if _, ok := segmentIDs[segmentID]; !ok {
			t.Fatalf("mapping references segment %d outside response %#v", segmentID, payload.Segments)
		}
		for _, sourceID := range sourceIDs {
			if _, ok := sourceUnitIDs[sourceID]; !ok {
				t.Fatalf("mapping references source unit %d outside response %#v", sourceID, payload.SourceUnits)
			}
		}
	}
}

func TestMergeStoryboardReturnsUpdatedReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	path := "/api/shuihuo-production/segments/12/merge-up"
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("merge storyboard = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments             []domain.Segment   `json:"segments"`
		SegmentSourceUnitIDs map[string][]int64 `json:"segmentSourceUnitIDs"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode merge response: %v", err)
	}
	if len(payload.Segments) != 1 || payload.Segments[0].ID != 11 || payload.Segments[0].SourceText != "第一句\n第二句" {
		t.Fatalf("merged segments = %#v", payload.Segments)
	}
	if got := payload.SegmentSourceUnitIDs["11"]; len(got) != 2 || got[0] != 201 || got[1] != 202 {
		t.Fatalf("merged mappings = %#v", payload.SegmentSourceUnitIDs)
	}
}

func TestSplitStoryboardReturnsUpdatedReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	delete(batchTaskTestState.segments, 12)
	delete(batchTaskTestState.sourceMappings, 12)
	batchTaskTestState.sourceMappings[11] = []int64{201, 202}
	path := "/api/shuihuo-production/segments/11/split"
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("split storyboard = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments             []domain.Segment   `json:"segments"`
		SegmentSourceUnitIDs map[string][]int64 `json:"segmentSourceUnitIDs"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode split response: %v", err)
	}
	if len(payload.Segments) != 2 || payload.Segments[0].SourceText != "第一句" || payload.Segments[1].SourceText != "第二句" {
		t.Fatalf("split segments = %#v", payload.Segments)
	}
	if got := payload.SegmentSourceUnitIDs["11"]; len(got) != 1 || got[0] != 201 {
		t.Fatalf("first split mapping = %#v", payload.SegmentSourceUnitIDs)
	}
	if got := payload.SegmentSourceUnitIDs[strconv.FormatInt(payload.Segments[1].ID, 10)]; len(got) != 1 || got[0] != 202 {
		t.Fatalf("second split mapping = %#v", payload.SegmentSourceUnitIDs)
	}
}

func TestInsertStoryboardReturnsUpdatedReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	path := "/api/shuihuo-production/segments/11/insert-after"
	request := batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"sourceText":"插入句","subtitleText":"插入字幕"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("insert storyboard = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments []domain.Segment `json:"segments"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode insert response: %v", err)
	}
	if len(payload.Segments) != 3 || payload.Segments[1].SourceText != "插入句" || payload.Segments[1].SubtitleText != "插入字幕" || payload.Segments[1].ImagePrompt != "" || payload.Segments[1].VideoPrompt != "" {
		t.Fatalf("inserted segments = %#v", payload.Segments)
	}
}

func TestStoryboardMutationsRejectActiveTasks(t *testing.T) {
	cases := []struct {
		name string
		path string
		body string
	}{
		{name: "merge", path: "/api/shuihuo-production/segments/12/merge-up"},
		{name: "split", path: "/api/shuihuo-production/segments/11/split"},
		{name: "insert", path: "/api/shuihuo-production/segments/11/insert-after", body: `{"sourceText":"插入句"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			api, _ := newBatchTaskTestAPI(t)
			seedBatchStoryboardMappings()
			batchTaskTestState.activeTasks[1] = true
			request := batchTaskBridgeRequest(t, http.MethodPost, tc.path, "producer", false)
			if tc.body != "" {
				request.Body = io.NopCloser(strings.NewReader(tc.body))
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()

			api.Router().ServeHTTP(response, request)

			if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "存在进行中的生成任务") {
				t.Fatalf("active %s = %d %s", tc.name, response.Code, response.Body.String())
			}
		})
	}
}

func TestStoryboardMutationsHideForeignSegments(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	path := "/api/shuihuo-production/segments/99/merge-up"
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false))

	if response.Code != http.StatusNotFound {
		t.Fatalf("foreign merge = %d %s", response.Code, response.Body.String())
	}
}

func TestCommentaryWorkbenchUpdateStoryboardReturnsReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	path := "/api/shuihuo-production/segments/11"
	request := batchTaskBridgeRequest(t, http.MethodPut, path, "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"subtitleText":"更新字幕","speaker":"班花","imagePrompt":"雨夜车站，电影感","videoPrompt":"镜头缓慢推进","imagePromptLocked":true,"videoPromptLocked":false}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("update storyboard = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments []domain.Segment `json:"segments"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if len(payload.Segments) != 2 || payload.Segments[0].SubtitleText != "更新字幕" || payload.Segments[0].Speaker != "班花" || !payload.Segments[0].ImagePromptLocked {
		t.Fatalf("updated segments = %#v", payload.Segments)
	}
}

func TestCommentaryWorkbenchDeleteStoryboardReturnsReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	path := "/api/shuihuo-production/segments/12"
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodDelete, path, "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("delete storyboard = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments []domain.Segment `json:"segments"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode delete response: %v", err)
	}
	if len(payload.Segments) != 1 || payload.Segments[0].ID != 11 {
		t.Fatalf("remaining segments = %#v", payload.Segments)
	}
}

func TestCommentaryWorkbenchReorderStoryboardsReturnsReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	path := "/api/shuihuo-production/projects/1/segments/order"
	request := batchTaskBridgeRequest(t, http.MethodPut, path, "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"segmentIds":[12,11]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("reorder storyboards = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Segments []domain.Segment `json:"segments"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode reorder response: %v", err)
	}
	if len(payload.Segments) != 2 || payload.Segments[0].ID != 12 || payload.Segments[1].ID != 11 {
		t.Fatalf("reordered segments = %#v", payload.Segments)
	}
}

func TestCommentaryWorkbenchReplaceStoryboardAssetsReturnsReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	batchTaskTestState.assets[301] = domain.Asset{ID: 301, ProjectID: 1, Name: "林晚", Prompt: "年轻女性"}
	path := "/api/shuihuo-production/segments/11/assets"
	request := batchTaskBridgeRequest(t, http.MethodPut, path, "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"assetIds":[301]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("replace storyboard assets = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		SegmentAssetIDs map[string][]int64 `json:"segmentAssetIDs"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode asset binding response: %v", err)
	}
	if got := payload.SegmentAssetIDs["11"]; len(got) != 1 || got[0] != 301 {
		t.Fatalf("segment asset IDs = %#v", payload.SegmentAssetIDs)
	}
}

func TestCommentaryWorkbenchStructuralEditsRejectActiveTasks(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "delete", method: http.MethodDelete, path: "/api/shuihuo-production/segments/12"},
		{name: "reorder", method: http.MethodPut, path: "/api/shuihuo-production/projects/1/segments/order", body: `{"segmentIds":[12,11]}`},
		{name: "assets", method: http.MethodPut, path: "/api/shuihuo-production/segments/11/assets", body: `{"assetIds":[301]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			api, _ := newBatchTaskTestAPI(t)
			seedBatchStoryboardMappings()
			batchTaskTestState.assets[301] = domain.Asset{ID: 301, ProjectID: 1, Name: "林晚"}
			batchTaskTestState.activeTasks[1] = true
			request := batchTaskBridgeRequest(t, tc.method, tc.path, "producer", false)
			if tc.body != "" {
				request.Body = io.NopCloser(strings.NewReader(tc.body))
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()

			api.Router().ServeHTTP(response, request)

			if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "存在进行中的生成任务") {
				t.Fatalf("active %s = %d %s", tc.name, response.Code, response.Body.String())
			}
		})
	}
}

func TestCommentaryWorkbenchHidesForeignStoryboardAndPreset(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	batchTaskTestState.assets[302] = domain.Asset{ID: 302, ProjectID: 2, Name: "外部预设"}
	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "foreign storyboard", method: http.MethodDelete, path: "/api/shuihuo-production/segments/99"},
		{name: "foreign preset", method: http.MethodPut, path: "/api/shuihuo-production/segments/11/assets", body: `{"assetIds":[302]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := batchTaskBridgeRequest(t, tc.method, tc.path, "producer", false)
			if tc.body != "" {
				request.Body = io.NopCloser(strings.NewReader(tc.body))
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()

			api.Router().ServeHTTP(response, request)

			if response.Code != http.StatusNotFound {
				t.Fatalf("%s = %d %s", tc.name, response.Code, response.Body.String())
			}
		})
	}
}

func TestCommentaryWorkbenchReadModelUsesFrontendFieldNames(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	seedBatchStoryboardMappings()
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects/1", "producer", false))

	if response.Code != http.StatusOK {
		t.Fatalf("GET project = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Project struct {
			ID int64 `json:"id"`
		} `json:"project"`
		Segments []struct {
			ID         int64  `json:"id"`
			SourceText string `json:"sourceText"`
		} `json:"segments"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode frontend response: %v", err)
	}
	if payload.Project.ID != 1 || len(payload.Segments) != 2 || payload.Segments[0].ID != 11 || payload.Segments[0].SourceText != "第一句" {
		t.Fatalf("frontend response = %#v", payload)
	}
}

func seedBatchStoryboardMappings() {
	batchTaskTestState.nextSegment = 12
	batchTaskTestState.nextSourceUnit = 202
	project := batchTaskTestState.projects[1]
	project.SegmentationVersion = 1
	batchTaskTestState.projects[1] = project
	batchTaskTestState.segments[11] = domain.Segment{ID: 11, ProjectID: 1, SourceText: "第一句", OrderIndex: 1, Confirmed: true}
	batchTaskTestState.segments[12] = domain.Segment{ID: 12, ProjectID: 1, SourceText: "第二句", OrderIndex: 2, Confirmed: true}
	batchTaskTestState.sourceUnits = []domain.SourceUnit{
		{ID: 201, ProjectID: 1, Text: "第一句", SourceKind: "confirmed_candidate", SegmentationVersion: 1, SourceOrder: 1, CreatedAt: time.Now().UTC()},
		{ID: 202, ProjectID: 1, Text: "第二句", SourceKind: "confirmed_candidate", SegmentationVersion: 1, SourceOrder: 2, CreatedAt: time.Now().UTC()},
	}
	batchTaskTestState.sourceMappings = map[int64][]int64{11: {201}, 12: {202}}
}

func TestConfirmSegmentationRejectsBlankCandidateText(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/segmentation/confirm", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"candidates":[{"text":"  "}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("confirm blank candidate status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var payload map[string]string
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode blank candidate response: %v", err)
	}
	if !strings.Contains(payload["error"], "第 1 个分段原文不能为空") {
		t.Fatalf("blank candidate error = %q", payload["error"])
	}
}

func TestConfirmSegmentationRejectsActiveTasks(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	batchTaskTestState.activeTasks[1] = true
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/segmentation/confirm", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"candidates":[{"text":"第一句"}]}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "存在进行中的生成任务") {
		t.Fatalf("confirm with active tasks = %d %s", response.Code, response.Body.String())
	}
}

func TestImportShuihuoProjectStoresOriginalDocumentAndReturnsReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{}
	api.deps.Objects = objects
	body := `{"name":"雨夜项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("\xef\xbb\xbf第一段\n第二段")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("import = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Project domain.Project `json:"project"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Project.Name != "雨夜项目" || payload.Project.SourceText != "第一段\n第二段" || payload.Project.SourceObjectKey != "" {
		t.Fatalf("import project = %#v", payload.Project)
	}
	if len(objects.putBodies) != 1 {
		t.Fatalf("stored raw import objects = %#v", objects.putBodies)
	}
	var stored []byte
	for _, value := range objects.putBodies {
		stored = value
	}
	if got := string(stored); got != "\xef\xbb\xbf第一段\n第二段" {
		t.Fatalf("stored raw import = %q", got)
	}
}

func TestReplaceShuihuoAssetImageKeepsAssetAndReplacesItsReferenceObject(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	oldKey := "shuihuo-production/100/1/asset-images/old-hero.png"
	objects := &recordingObjects{putBodies: map[string][]byte{oldKey: []byte("old image")}}
	api.deps.Objects = objects
	batchTaskTestState.assets[700] = domain.Asset{
		ID: 700, ProjectID: 1, Category: "character", Name: "林鸢", Prompt: "旧提示词",
		ReferenceObjectKey: oldKey, Source: "manual_image", ManuallyEdited: true, IsCurrent: true,
	}

	body := `{"filename":"hero.png","dataUrl":"data:image/png;base64,` + base64.StdEncoding.EncodeToString([]byte("new image")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPut, "/api/shuihuo-production/assets/700/image", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("replace asset image = %d %s", response.Code, response.Body.String())
	}
	updated := batchTaskTestState.assets[700]
	if updated.ID != 700 || updated.ReferenceObjectKey == oldKey || updated.ReferenceObjectKey == "" {
		t.Fatalf("updated asset = %#v, want same asset with a new image reference", updated)
	}
	if updated.Source != "manual_image" || !updated.ManuallyEdited {
		t.Fatalf("updated asset source = %#v, want manual image metadata", updated)
	}
	if string(objects.putBodies[updated.ReferenceObjectKey]) != "new image" {
		t.Fatalf("replacement object = %#v, want new image", objects.putBodies)
	}
	if len(objects.deleted) != 1 || objects.deleted[0] != oldKey {
		t.Fatalf("deleted objects = %#v, want old reference %q", objects.deleted, oldKey)
	}
}

func TestImportShuihuoProjectCleansObjectAndEmptyProjectWhenFinalPersistenceFails(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{}
	api.deps.Objects = objects
	batchTaskTestState.failSourceObjectUpdate = true
	body := `{"name":"失败项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("正文")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("import failure = %d %s", response.Code, response.Body.String())
	}
	if len(objects.putBodies) != 0 || len(objects.deleted) != 1 {
		t.Fatalf("object cleanup put=%#v deleted=%#v", objects.putBodies, objects.deleted)
	}
	if _, exists := batchTaskTestState.projects[2]; exists {
		t.Fatalf("empty import project was not cleaned: %#v", batchTaskTestState.projects[2])
	}
}

func TestImportShuihuoProjectCleansObjectAndEmptyProjectWhenPutWritesThenFails(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &writeThenFailObjects{}
	api.deps.Objects = objects
	body := `{"name":"写入失败项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("正文")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("import failure = %d %s", response.Code, response.Body.String())
	}
	if len(objects.putBodies) != 0 || len(objects.deleted) != 1 {
		t.Fatalf("object cleanup put=%#v deleted=%#v", objects.putBodies, objects.deleted)
	}
	for _, project := range batchTaskTestState.projects {
		if project.Name == "写入失败项目" {
			t.Fatalf("empty import project was not cleaned: %#v", project)
		}
	}
}

func TestImportShuihuoProjectQueuesObjectWhenCompensationDeleteFails(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &writeThenFailObjects{recordingObjects: recordingObjects{deleteErr: errors.New("storage unavailable")}}
	api.deps.Objects = objects
	body := `{"name":"待清理项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("正文")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "保存原始导入文件失败") {
		t.Fatalf("import failure = %d %s", response.Code, response.Body.String())
	}
	if len(batchTaskTestState.objectCleanups) != 1 {
		t.Fatalf("deferred cleanup = %#v", batchTaskTestState.objectCleanups)
	}
	for key, cleanup := range batchTaskTestState.objectCleanups {
		if cleanup.reason != "import_put_compensation" || cleanup.attemptCount != 1 || !strings.Contains(cleanup.lastError, "storage unavailable") {
			t.Fatalf("cleanup %q = %#v", key, cleanup)
		}
	}
}

func TestImportShuihuoProjectQueuesObjectWhenSourceKeyPersistenceAndDeleteFail(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{deleteErr: errors.New("storage unavailable")}
	api.deps.Objects = objects
	batchTaskTestState.failSourceObjectUpdate = true
	body := `{"name":"待清理项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("正文")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "保存导入项目来源失败") {
		t.Fatalf("import failure = %d %s", response.Code, response.Body.String())
	}
	for _, cleanup := range batchTaskTestState.objectCleanups {
		if cleanup.reason == "import_source_key_compensation" && cleanup.attemptCount == 1 {
			return
		}
	}
	t.Fatalf("source key failure was not queued: %#v", batchTaskTestState.objectCleanups)
}

func TestImportShuihuoProjectKeepsFailedDeleteHiddenAndRetryable(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	api.deps.Objects = &recordingObjects{}
	batchTaskTestState.failSourceObjectUpdate = true
	batchTaskTestState.failProjectDelete = true
	body := `{"name":"隔离项目","filename":"source.txt","dataUrl":"data:text/plain;base64,` + base64.StdEncoding.EncodeToString([]byte("正文")) + `"}`
	request := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/import", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "残留已隔离") {
		t.Fatalf("import failure = %d %s", response.Code, response.Body.String())
	}
	project, exists := batchTaskTestState.projects[2]
	if !exists || project.SegmentationStatus != "importing" {
		t.Fatalf("failed import must remain hidden staging state: %#v", project)
	}
	if _, exists := batchTaskTestState.importCleanups[2]; !exists {
		t.Fatalf("failed import deletion was not persisted: %#v", batchTaskTestState.importCleanups)
	}
	readResponse := httptest.NewRecorder()
	api.Router().ServeHTTP(readResponse, batchTaskBridgeRequest(t, http.MethodGet, "/api/shuihuo-production/projects/2", "producer", false))
	if readResponse.Code != http.StatusNotFound {
		t.Fatalf("staging import is user-visible: %d %s", readResponse.Code, readResponse.Body.String())
	}
}

func TestReplaceShuihuoSourceRejectsActiveTasksAndReturnsFreshReadModel(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{}
	api.deps.Objects = objects
	project := batchTaskTestState.projects[1]
	project.SourceObjectKey = "shuihuo-production/100/1/source/original.txt"
	project.SegmentationVersion = 2
	batchTaskTestState.projects[1] = project
	batchTaskTestState.activeTasks[1] = true
	request := batchTaskBridgeRequest(t, http.MethodPut, "/api/shuihuo-production/projects/1/source", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"sourceText":"替换原文"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "存在进行中的生成任务") {
		t.Fatalf("active source replacement = %d %s", response.Code, response.Body.String())
	}

	batchTaskTestState.activeTasks[1] = false
	response = httptest.NewRecorder()
	request = batchTaskBridgeRequest(t, http.MethodPut, "/api/shuihuo-production/projects/1/source", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"sourceText":"替换原文"}`))
	request.Header.Set("Content-Type", "application/json")
	api.Router().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("source replacement = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Project domain.Project `json:"project"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Project.SourceText != "替换原文" || payload.Project.SourceObjectKey != "" || payload.Project.SegmentationStatus != "draft" || payload.Project.SegmentationVersion != 3 {
		t.Fatalf("replacement project = %#v", payload.Project)
	}
	if len(objects.deleted) != 1 || objects.deleted[0] != "shuihuo-production/100/1/source/original.txt" {
		t.Fatalf("replacement did not delete superseded source object: %#v", objects.deleted)
	}
}

func TestReplaceShuihuoSourceQueuesOldObjectWhenDeleteFails(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{deleteErr: errors.New("storage unavailable")}
	api.deps.Objects = objects
	project := batchTaskTestState.projects[1]
	project.SourceObjectKey = "shuihuo-production/100/1/source/original.txt"
	batchTaskTestState.projects[1] = project
	request := batchTaskBridgeRequest(t, http.MethodPut, "/api/shuihuo-production/projects/1/source", "producer", false)
	request.Body = io.NopCloser(strings.NewReader(`{"sourceText":"替换原文"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "原始导入文件清理未完成") {
		t.Fatalf("source replacement = %d %s", response.Code, response.Body.String())
	}
	cleanup, ok := batchTaskTestState.objectCleanups["shuihuo-production/100/1/source/original.txt"]
	if !ok || cleanup.reason != "pasted_source_replacement" || cleanup.attemptCount != 1 {
		t.Fatalf("old object cleanup = %#v", batchTaskTestState.objectCleanups)
	}
}

func TestOwnerCanListAndRunDeferredObjectCleanup(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &recordingObjects{putBodies: map[string][]byte{"shuihuo-production/100/1/source/original.txt": []byte("正文")}}
	api.deps.Objects = objects
	key := "shuihuo-production/100/1/source/original.txt"
	batchTaskTestState.objectCleanups[key] = batchTaskObjectCleanup{reason: "pasted_source_replacement", createdAt: time.Now().UTC()}

	listResponse := httptest.NewRecorder()
	api.Router().ServeHTTP(listResponse, batchTaskBridgeRequest(t, http.MethodGet, "/api/shuihuo-production/admin/object-cleanups", "owner", true))
	if listResponse.Code != http.StatusOK || !strings.Contains(listResponse.Body.String(), key) {
		t.Fatalf("list deferred cleanups = %d %s", listResponse.Code, listResponse.Body.String())
	}

	runResponse := httptest.NewRecorder()
	api.Router().ServeHTTP(runResponse, batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/admin/object-cleanups/run", "owner", true))
	if runResponse.Code != http.StatusOK || !strings.Contains(runResponse.Body.String(), `"deleted":1`) {
		t.Fatalf("run deferred cleanups = %d %s", runResponse.Code, runResponse.Body.String())
	}
	if len(batchTaskTestState.objectCleanups) != 0 || len(objects.deleted) != 1 {
		t.Fatalf("cleanup run state=%#v deleted=%#v", batchTaskTestState.objectCleanups, objects.deleted)
	}
}

func TestConcurrentObjectCleanupRunnersClaimOneObjectOnce(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	objects := &blockingDeleteObjects{
		recordingObjects: recordingObjects{putBodies: map[string][]byte{"shuihuo-production/100/1/source/original.txt": []byte("正文")}},
		started:          make(chan struct{}),
		release:          make(chan struct{}),
	}
	api.deps.Objects = objects
	key := "shuihuo-production/100/1/source/original.txt"
	batchTaskTestState.objectCleanups[key] = batchTaskObjectCleanup{reason: "concurrent_runner", createdAt: time.Now().UTC()}

	first := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		response := httptest.NewRecorder()
		api.Router().ServeHTTP(response, batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/admin/object-cleanups/run", "owner", true))
		first <- response
	}()
	select {
	case <-objects.started:
	case <-time.After(time.Second):
		t.Fatal("first runner did not begin deleting")
	}
	second := httptest.NewRecorder()
	api.Router().ServeHTTP(second, batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/admin/object-cleanups/run", "owner", true))
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"processed":0`) {
		t.Fatalf("second runner = %d %s", second.Code, second.Body.String())
	}
	close(objects.release)
	if response := <-first; response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"deleted":1`) {
		t.Fatalf("first runner = %d %s", response.Code, response.Body.String())
	}
	objects.mu.Lock()
	deleteCalls := len(objects.deleted)
	objects.mu.Unlock()
	if deleteCalls != 1 {
		t.Fatalf("object delete calls = %d, want 1", deleteCalls)
	}
}

func TestExpiredCleanupLeaseCannotLetStaleWorkerReportSuccess(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	cleanups := shuihuostore.NewObjectCleanups(api.deps.DB)
	key := "shuihuo-production/100/1/source/original.txt"
	if err := cleanups.Schedule(context.Background(), key, "lease_test"); err != nil {
		t.Fatalf("schedule cleanup: %v", err)
	}
	now := time.Now().UTC()
	if _, err := cleanups.Claim(context.Background(), 1, "stale-token", now, 10*time.Millisecond); err != nil {
		t.Fatalf("claim stale worker: %v", err)
	}
	if _, err := cleanups.Claim(context.Background(), 1, "current-token", now.Add(20*time.Millisecond), time.Minute); err != nil {
		t.Fatalf("claim current worker: %v", err)
	}
	renewed, err := cleanups.RenewClaim(context.Background(), key, "stale-token", now.Add(20*time.Millisecond), time.Minute)
	if err != nil {
		t.Fatalf("renew stale worker: %v", err)
	}
	if renewed {
		t.Fatal("stale worker renewed the current cleanup lease")
	}
	removed, err := cleanups.RemoveClaimed(context.Background(), key, "stale-token")
	if err != nil {
		t.Fatalf("complete stale worker: %v", err)
	}
	if removed {
		t.Fatal("stale worker removed the current cleanup lease")
	}
	batchTaskTestState.mu.Lock()
	remaining := batchTaskTestState.objectCleanups[key]
	batchTaskTestState.mu.Unlock()
	if remaining.leaseToken != "current-token" {
		t.Fatalf("cleanup lease token = %q, want current-token", remaining.leaseToken)
	}
}

func TestCleanupDeleteTimesOutBeforeLeaseExpiresAndNextRunnerStartsAfterward(t *testing.T) {
	api, _ := newBatchTaskTestAPI(t)
	cleanups := shuihuostore.NewObjectCleanups(api.deps.DB)
	key := "shuihuo-production/100/1/source/original.txt"
	if err := cleanups.Schedule(context.Background(), key, "timeout_test"); err != nil {
		t.Fatalf("schedule cleanup: %v", err)
	}
	blocking := &contextBlockingDeleteObjects{started: make(chan struct{})}
	firstDone := make(chan shuihuoObjectCleanupRunResult, 1)
	firstErr := make(chan error, 1)
	go func() {
		result, err := runShuihuoObjectCleanupBatch(context.Background(), cleanups, blocking, 1, "first-token", time.Now(), 40*time.Millisecond, 10*time.Millisecond)
		firstDone <- result
		firstErr <- err
	}()
	select {
	case <-blocking.started:
	case <-time.After(time.Second):
		t.Fatal("first cleanup runner did not start delete")
	}
	// The first Delete is context-bounded to 10 ms while its lease lasts 40 ms.
	// Wait past expiry before starting another runner: it must only see a retryable
	// record after the first Delete has exited, never a still-running delete.
	time.Sleep(50 * time.Millisecond)
	result := <-firstDone
	if err := <-firstErr; err != nil {
		t.Fatalf("first cleanup runner: %v", err)
	}
	if result.Deleted != 0 || result.Failed != 1 || blocking.completed.Load() != 1 {
		t.Fatalf("timed-out first run = %#v, completed=%d", result, blocking.completed.Load())
	}

	secondObjects := &recordingObjects{putBodies: map[string][]byte{key: []byte("正文")}}
	second, err := runShuihuoObjectCleanupBatch(context.Background(), cleanups, secondObjects, 1, "second-token", time.Now(), time.Minute, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("second cleanup runner: %v", err)
	}
	if second.Deleted != 1 || len(secondObjects.deleted) != 1 {
		t.Fatalf("second run = %#v, deletes=%v", second, secondObjects.deleted)
	}
}

func TestRequireAuthRejectsInactiveAccount(t *testing.T) {
	user := store.User{ID: 11, Username: "inactive", IsActive: false}
	api, secret := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, authorizedRequest(t, secret, user, http.MethodGet, "/api/shuihuo-production/projects"))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET projects for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestLoginRejectsInactiveAccountBeforeIssuingToken(t *testing.T) {
	password := "correct-password"
	user := store.User{
		ID:           12,
		Username:     "disabled-user",
		PasswordHash: auth.HashPassword(password),
		IsActive:     false,
	}
	api, _ := newShuihuoTestAPI(t, map[int64]store.User{user.ID: user})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(
		http.MethodPost,
		"/api/login",
		bytes.NewBufferString(`{"username":"disabled-user","password":"correct-password"}`),
	))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("POST login for inactive user status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["token"]; ok {
		t.Fatalf("inactive login response unexpectedly includes token: %#v", payload)
	}
}

func TestBatchTasksRequirePlatformAuthentication(t *testing.T) {
	api := New(Dependencies{})
	response := httptest.NewRecorder()

	api.Router().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/shuihuo-production/projects/1/tasks/batch", strings.NewReader(`{"segmentIds":[11],"kind":"image","modelId":7}`)))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("POST batch tasks status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestBatchTasksRejectInvalidRequestBeforeCreatingTasks(t *testing.T) {
	tooManySegmentIDs := make([]int64, 51)
	for index := range tooManySegmentIDs {
		tooManySegmentIDs[index] = int64(index + 1)
	}
	for _, tc := range []struct {
		name       string
		segmentIDs []int64
		kind       string
		modelID    int64
	}{
		{name: "empty segments", segmentIDs: nil, kind: "image", modelID: 7},
		{name: "duplicate segments", segmentIDs: []int64{11, 11}, kind: "image", modelID: 7},
		{name: "too many segments", segmentIDs: tooManySegmentIDs, kind: "image", modelID: 7},
		{name: "unsupported kind", segmentIDs: []int64{11}, kind: "unknown", modelID: 7},
		{name: "export is not a generation task", segmentIDs: []int64{11}, kind: "export", modelID: 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, queue := newBatchTaskTestAPI(t)
			response := requestBatchTasks(t, api, tc.segmentIDs, tc.kind, tc.modelID)

			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "任务参数无效") {
				t.Fatalf("batch = %d %s", response.Code, response.Body.String())
			}
			if len(queue.ids) != 0 {
				t.Fatalf("queued tasks = %#v, want none", queue.ids)
			}
		})
	}
}

func TestBatchTasksReturnsOneResultPerRequestedSegmentInRequestOrder(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	response := requestBatchTasks(t, api, []int64{12, 11}, "image", 7)

	if response.Code != http.StatusCreated {
		t.Fatalf("batch = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Results []struct {
			SegmentID int64        `json:"segmentId"`
			Task      *domain.Task `json:"task"`
			Error     string       `json:"error"`
		} `json:"results"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(payload.Results) != 2 || payload.Results[0].SegmentID != 12 || payload.Results[1].SegmentID != 11 {
		t.Fatalf("results = %#v, want request order", payload.Results)
	}
	for _, result := range payload.Results {
		if result.Task == nil || result.Task.Status != domain.TaskQueued || result.Error != "" {
			t.Fatalf("result = %#v, want queued task without error", result)
		}
	}
	if len(queue.ids) != 2 {
		t.Fatalf("queued tasks = %#v, want two", queue.ids)
	}
}

func TestBatchTasksReturnsPartialResultsWithoutRollingBackSuccessfulTasks(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	response := requestBatchTasks(t, api, []int64{11, 99}, "image", 7)

	if response.Code != http.StatusMultiStatus {
		t.Fatalf("batch = %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Results []struct {
			SegmentID int64        `json:"segmentId"`
			Task      *domain.Task `json:"task"`
			Error     string       `json:"error"`
		} `json:"results"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(payload.Results) != 2 || payload.Results[0].Task == nil || payload.Results[1].Task != nil || payload.Results[1].Error != "分段不存在" {
		t.Fatalf("results = %#v, want one queued task and one safe error", payload.Results)
	}
	if len(queue.ids) != 1 {
		t.Fatalf("queued tasks = %#v, want successful task preserved", queue.ids)
	}
}

func TestBatchYDVideoTasksApplySharedSettingsAndRejectInvalidRatioBeforeQueueing(t *testing.T) {
	for _, tc := range []struct {
		name        string
		aspectRatio string
		wantStatus  int
		wantQueued  int
	}{
		{name: "ignores batch override and uses saved engine ratio", aspectRatio: "16:9", wantStatus: http.StatusCreated, wantQueued: 2},
		{name: "ignores unsupported batch override and uses saved engine ratio", aspectRatio: "1:1", wantStatus: http.StatusCreated, wantQueued: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, queue := newBatchTaskTestAPI(t)
			batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true, CredentialRef: "YD_API_KEY"}
			for _, segmentID := range []int64{11, 12} {
				segment := batchTaskTestState.segments[segmentID]
				segment.VideoPrompt = "镜头缓慢推进"
				batchTaskTestState.segments[segmentID] = segment
				batchTaskTestState.primaryImages[segmentID] = domain.Media{ID: segmentID + 80, ProjectID: 1, SegmentID: &segmentID, Kind: "image", ObjectKey: fmt.Sprintf("shuihuo-production/100/1/images/scene-%d.png", segmentID), IsPrimary: true}
			}
			batchTaskTestState.assets[101] = domain.Asset{ID: 101, ProjectID: 1, Category: "character", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/hero.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[102] = domain.Asset{ID: 102, ProjectID: 1, Category: "prop", IsCurrent: true}
			batchTaskTestState.assets[103] = domain.Asset{ID: 103, ProjectID: 1, Category: "character", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/hero.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[104] = domain.Asset{ID: 104, ProjectID: 1, Category: "prop", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/sword.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[105] = domain.Asset{ID: 105, ProjectID: 1, Category: "prop", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/letter.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[106] = domain.Asset{ID: 106, ProjectID: 1, Category: "prop", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/extra.png", ManuallyEdited: true, IsCurrent: true}
			for _, segmentID := range []int64{11, 12} {
				batchTaskTestState.segmentAssetMappings[segmentID] = []int64{101, 102, 103, 104, 105, 106}
			}

			body := fmt.Sprintf(`{"segmentIds":[11,12],"kind":"video","modelId":7,"videoSettings":{"aspectRatio":%q},"videoSettingsBySegment":{"11":{"aspectRatio":"9:16"},"12":{"aspectRatio":"9:16"}}}`, tc.aspectRatio)
			req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks/batch", "producer", false)
			req.Body = io.NopCloser(strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			api.Router().ServeHTTP(response, req)

			if response.Code != tc.wantStatus {
				t.Fatalf("batch YD video tasks = %d %s", response.Code, response.Body.String())
			}
			if len(queue.ids) != tc.wantQueued {
				t.Fatalf("queued tasks = %#v, want %d", queue.ids, tc.wantQueued)
			}
			if tc.wantQueued == 0 {
				return
			}
			for _, taskID := range queue.ids {
				var snapshot struct {
					SourceImageObjectKey     string   `json:"sourceImageObjectKey"`
					AspectRatio              string   `json:"aspectRatio"`
					VideoReferenceObjectKeys []string `json:"videoReferenceObjectKeys"`
				}
				if err := json.Unmarshal([]byte(batchTaskTestState.tasks[taskID].Input), &snapshot); err != nil {
					t.Fatal(err)
				}
				if snapshot.AspectRatio != "9:16" {
					t.Fatalf("task %d aspect ratio = %q, want 9:16", taskID, snapshot.AspectRatio)
				}
				if want := fmt.Sprintf("shuihuo-production/100/1/images/scene-%d.png", *batchTaskTestState.tasks[taskID].SegmentID); snapshot.SourceImageObjectKey != want {
					t.Fatalf("task %d source image = %q, want fallback %q", taskID, snapshot.SourceImageObjectKey, want)
				}
				wantReferences := []string{
					"shuihuo-production/100/1/asset-images/hero.png",
					"shuihuo-production/100/1/asset-images/sword.png",
					"shuihuo-production/100/1/asset-images/letter.png",
				}
				if !reflect.DeepEqual(snapshot.VideoReferenceObjectKeys, wantReferences) {
					t.Fatalf("task %d video references = %#v, want %#v", taskID, snapshot.VideoReferenceObjectKeys, wantReferences)
				}
			}
		})
	}
}

func TestYDVideoTaskRejectsSegmentWithoutScenePresetOrPrimaryImage(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true}
	segment := batchTaskTestState.segments[11]
	segment.VideoPrompt = "镜头缓慢推进"
	batchTaskTestState.segments[11] = segment

	req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"video","modelId":7}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "预设图或主图片") {
		t.Fatalf("missing YD image = %d %s", response.Code, response.Body.String())
	}
	if len(queue.ids) != 0 {
		t.Fatalf("queued tasks = %#v, want none", queue.ids)
	}
}

func TestYDVideoTasksSnapshotRatioAndBoundReferences(t *testing.T) {
	for _, tc := range []struct {
		name       string
		settings   string
		wantStatus int
		wantRatio  string
		wantError  string
	}{
		{name: "defaults legacy request", settings: "", wantStatus: http.StatusCreated, wantRatio: "9:16"},
		{name: "ignores landscape request override", settings: `,"videoSettings":{"aspectRatio":"16:9"}`, wantStatus: http.StatusCreated, wantRatio: "9:16"},
		{name: "ignores unsupported request override", settings: `,"videoSettings":{"aspectRatio":"1:1"}`, wantStatus: http.StatusCreated, wantRatio: "9:16"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api, queue := newBatchTaskTestAPI(t)
			batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true, CredentialRef: "YD_API_KEY"}
			segment := batchTaskTestState.segments[11]
			segment.VideoPrompt = "镜头缓慢推进"
			batchTaskTestState.segments[11] = segment
			batchTaskTestState.assets[101] = domain.Asset{ID: 101, ProjectID: 1, Category: "character", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/hero.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[102] = domain.Asset{ID: 102, ProjectID: 1, Category: "prop", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/sword.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[103] = domain.Asset{ID: 103, ProjectID: 1, Category: "scene", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/station.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[104] = domain.Asset{ID: 104, ProjectID: 1, Category: "prop", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/letter.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.assets[105] = domain.Asset{ID: 105, ProjectID: 1, Category: "character", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/extra.png", ManuallyEdited: true, IsCurrent: true}
			batchTaskTestState.segmentAssetMappings[11] = []int64{101, 102, 103, 104, 105}

			req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
			req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"video","modelId":7` + tc.settings + `}`))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			api.Router().ServeHTTP(response, req)

			if response.Code != tc.wantStatus {
				t.Fatalf("create YD video task = %d %s", response.Code, response.Body.String())
			}
			if tc.wantError != "" {
				if !strings.Contains(response.Body.String(), tc.wantError) {
					t.Fatalf("error = %s, want %q", response.Body.String(), tc.wantError)
				}
				if len(queue.ids) != 0 {
					t.Fatalf("queued tasks = %#v, want none", queue.ids)
				}
				return
			}
			if len(queue.ids) != 1 {
				t.Fatalf("queued tasks = %#v, want one", queue.ids)
			}
			var snapshot struct {
				SourceImageObjectKey     string   `json:"sourceImageObjectKey"`
				AspectRatio              string   `json:"aspectRatio"`
				VideoReferenceObjectKeys []string `json:"videoReferenceObjectKeys"`
			}
			if err := json.Unmarshal([]byte(batchTaskTestState.tasks[queue.ids[0]].Input), &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.SourceImageObjectKey != "shuihuo-production/100/1/asset-images/station.png" || snapshot.AspectRatio != tc.wantRatio {
				t.Fatalf("video snapshot = %#v", snapshot)
			}
			wantReferences := []string{
				"shuihuo-production/100/1/asset-images/hero.png",
				"shuihuo-production/100/1/asset-images/sword.png",
				"shuihuo-production/100/1/asset-images/letter.png",
			}
			if !reflect.DeepEqual(snapshot.VideoReferenceObjectKeys, wantReferences) {
				t.Fatalf("video references = %#v, want %#v", snapshot.VideoReferenceObjectKeys, wantReferences)
			}
		})
	}
}

func TestTaskSubmissionRejectsStoryboardChangedBeforeQueueTransition(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	batchTaskTestState.transitionLockHook = func() {
		delete(batchTaskTestState.segments, 11)
	}

	req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"image","modelId":7}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "分镜已变更") {
		t.Fatalf("create task = %d %s, want stale storyboard conflict", response.Code, response.Body.String())
	}
	if len(queue.ids) != 0 {
		t.Fatalf("queued tasks = %#v, want none after structural change", queue.ids)
	}
}

func requestBatchTasks(t *testing.T, api *API, segmentIDs []int64, kind string, modelID int64) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/shuihuo-production/projects/1/tasks/batch"
	req := batchTaskBridgeRequest(t, http.MethodPost, path, "producer", false)
	body, err := json.Marshal(map[string]any{"segmentIds": segmentIDs, "kind": kind, "modelId": modelID})
	if err != nil {
		t.Fatalf("marshal batch request: %v", err)
	}
	req.Body = io.NopCloser(strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)
	return response
}

func batchTaskBridgeRequest(t *testing.T, method, requestPath, username string, isOwner bool) *http.Request {
	t.Helper()
	issuedAt := strconv.FormatInt(time.Now().Unix(), 10)
	payload := strings.Join([]string{username, issuedAt, strconv.FormatBool(isOwner), method, requestPath}, "\n")
	mac := hmac.New(sha256.New, []byte("batch-task-test-secret"))
	_, _ = mac.Write([]byte(payload))
	req := httptest.NewRequest(method, requestPath, nil)
	req.Header.Set("X-Qiantie-Username", username)
	req.Header.Set("X-Qiantie-Is-Owner", strconv.FormatBool(isOwner))
	req.Header.Set("X-Qiantie-Issued-At", issuedAt)
	req.Header.Set("X-Qiantie-Signature", hex.EncodeToString(mac.Sum(nil)))
	return req
}

type batchTaskQueue struct{ ids []int64 }

func (q *batchTaskQueue) Enqueue(_ context.Context, taskID int64) error {
	q.ids = append(q.ids, taskID)
	return nil
}

type recordingObjects struct {
	mu        sync.Mutex
	putBodies map[string][]byte
	deleted   []string
	putErr    error
	deleteErr error
}

type writeThenFailObjects struct {
	recordingObjects
}

type blockingDeleteObjects struct {
	recordingObjects
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

type contextBlockingDeleteObjects struct {
	started   chan struct{}
	once      sync.Once
	completed atomic.Int32
}

func (s *contextBlockingDeleteObjects) Put(context.Context, string, io.Reader, string) (shuihuostorage.Object, error) {
	return shuihuostorage.Object{}, errors.New("not implemented")
}

func (s *contextBlockingDeleteObjects) Get(context.Context, string) (io.ReadCloser, shuihuostorage.Object, error) {
	return nil, shuihuostorage.Object{}, errors.New("not implemented")
}

func (s *contextBlockingDeleteObjects) Delete(ctx context.Context, _ string) error {
	s.once.Do(func() { close(s.started) })
	<-ctx.Done()
	s.completed.Add(1)
	return ctx.Err()
}

func (s *contextBlockingDeleteObjects) URL(context.Context, string, time.Duration) (string, error) {
	return "", errors.New("not implemented")
}

func (s *blockingDeleteObjects) Delete(ctx context.Context, key string) error {
	s.once.Do(func() {
		close(s.started)
		<-s.release
	})
	return s.recordingObjects.Delete(ctx, key)
}

func (s *writeThenFailObjects) Put(ctx context.Context, key string, body io.Reader, contentType string) (shuihuostorage.Object, error) {
	object, err := s.recordingObjects.Put(ctx, key, body, contentType)
	if err != nil {
		return shuihuostorage.Object{}, err
	}
	return object, errors.New("object storage write completed but response failed")
}

func (s *recordingObjects) Put(_ context.Context, key string, body io.Reader, contentType string) (shuihuostorage.Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.putErr != nil {
		return shuihuostorage.Object{}, s.putErr
	}
	contents, err := io.ReadAll(body)
	if err != nil {
		return shuihuostorage.Object{}, err
	}
	if s.putBodies == nil {
		s.putBodies = make(map[string][]byte)
	}
	s.putBodies[key] = contents
	return shuihuostorage.Object{Key: key, Size: int64(len(contents)), ContentType: contentType}, nil
}

func (s *recordingObjects) Get(_ context.Context, key string) (io.ReadCloser, shuihuostorage.Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	contents, ok := s.putBodies[key]
	if !ok {
		return nil, shuihuostorage.Object{}, sql.ErrNoRows
	}
	return io.NopCloser(bytes.NewReader(contents)), shuihuostorage.Object{Key: key, Size: int64(len(contents))}, nil
}

func (s *recordingObjects) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, key)
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.putBodies, key)
	return nil
}

func (s *recordingObjects) URL(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
func (q *batchTaskQueue) Dequeue(context.Context, time.Duration) (int64, error) {
	return 0, fmt.Errorf("not implemented")
}

var _ shuihuotasks.Queue = (*batchTaskQueue)(nil)

const batchTaskTestDriverName = "qiantie-httpapi-batch-task-test"

var (
	registerBatchTaskTestDriver sync.Once
	batchTaskTestState          *batchTaskState
)

type batchTaskState struct {
	mu                     sync.Mutex
	projects               map[int64]domain.Project
	segments               map[int64]domain.Segment
	assets                 map[int64]domain.Asset
	sourceUnits            []domain.SourceUnit
	sourceMappings         map[int64][]int64
	segmentAssetMappings   map[int64][]int64
	primaryImages          map[int64]domain.Media
	tasks                  map[int64]domain.Task
	model                  models.Definition
	nextTask               int64
	nextProject            int64
	nextSegment            int64
	nextSourceUnit         int64
	activeTasks            map[int64]bool
	transitionLockHook     func()
	objectCleanups         map[string]batchTaskObjectCleanup
	importCleanups         map[int64]batchTaskImportCleanup
	failSourceObjectUpdate bool
	failProjectDelete      bool
}

type batchTaskObjectCleanup struct {
	reason       string
	lastError    string
	attemptCount int
	createdAt    time.Time
	leaseToken   string
	leaseExpires *time.Time
}

type batchTaskImportCleanup struct {
	userID       int64
	objectKey    string
	reason       string
	lastError    string
	attemptCount int
	createdAt    time.Time
}

func newBatchTaskTestAPI(t *testing.T) (*API, *batchTaskQueue) {
	t.Helper()
	registerBatchTaskTestDriver.Do(func() { sql.Register(batchTaskTestDriverName, batchTaskTestDriver{}) })
	batchTaskTestState = &batchTaskState{
		projects: map[int64]domain.Project{1: {ID: 1, UserID: 100, Name: "当前项目", SegmentationStatus: "confirmed"}},
		segments: map[int64]domain.Segment{
			11: {ID: 11, ProjectID: 1, Confirmed: true, ImagePrompt: "雨夜车站"},
			12: {ID: 12, ProjectID: 1, Confirmed: true, ImagePrompt: "车门打开"},
			99: {ID: 99, ProjectID: 2, Confirmed: true, ImagePrompt: "其他项目"},
		},
		assets:               map[int64]domain.Asset{},
		sourceMappings:       map[int64][]int64{},
		segmentAssetMappings: map[int64][]int64{},
		primaryImages:        map[int64]domain.Media{},
		tasks:                map[int64]domain.Task{},
		activeTasks:          map[int64]bool{},
		objectCleanups:       map[string]batchTaskObjectCleanup{},
		importCleanups:       map[int64]batchTaskImportCleanup{},
		nextProject:          1,
		nextSegment:          12,
		nextSourceUnit:       202,
		model:                models.Definition{ID: 7, ModelID: "image-jimeng", VersionID: 8, Name: "即梦", Kind: models.KindImage, AdapterKind: models.AdapterJimengImage, Enabled: true},
	}
	db, err := sql.Open(batchTaskTestDriverName, "")
	if err != nil {
		t.Fatalf("open batch task test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	queue := &batchTaskQueue{}
	api := New(Dependencies{
		DB:               db,
		BridgeSecret:     "batch-task-test-secret",
		Queue:            queue,
		Users:            &batchTaskUserStore{users: map[string]store.User{}},
		VideoConfigs:     &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{100: {Provider: store.YDVideoProvider, APIKeyCiphertext: "test-ciphertext"}}},
		CredentialCipher: testCredentialCipher(t),
	})
	return api, queue
}

type batchTaskUserStore struct {
	mu    sync.Mutex
	users map[string]store.User
}

func (s *batchTaskUserStore) FindByUsername(_ context.Context, username string) (store.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[username]
	if !ok {
		return store.User{}, sql.ErrNoRows
	}
	return user, nil
}

func (s *batchTaskUserStore) FindByID(_ context.Context, id int64) (store.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if user.ID == id {
			return user, nil
		}
	}
	return store.User{}, sql.ErrNoRows
}

func (s *batchTaskUserStore) EnsureBridgeUser(_ context.Context, username string, isOwner bool) (store.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if user, ok := s.users[username]; ok {
		return user, nil
	}
	user := store.User{ID: 100, Username: username, IsOwner: isOwner, IsActive: true}
	s.users[username] = user
	return user, nil
}

type batchTaskTestDriver struct{}

func (batchTaskTestDriver) Open(string) (driver.Conn, error) { return batchTaskTestConn{}, nil }

type batchTaskTestConn struct{}

func (batchTaskTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (batchTaskTestConn) Close() error                        { return nil }
func (batchTaskTestConn) Begin() (driver.Tx, error)           { return batchTaskTestTx{}, nil }
func (batchTaskTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return batchTaskTestTx{}, nil
}
func (batchTaskTestConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return batchTaskTestExec(query, args)
}
func (batchTaskTestConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return batchTaskTestQuery(query, args)
}

type batchTaskTestTx struct{}

func (batchTaskTestTx) Commit() error   { return nil }
func (batchTaskTestTx) Rollback() error { return nil }
func (batchTaskTestTx) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	return batchTaskTestExec(query, args)
}
func (batchTaskTestTx) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	return batchTaskTestQuery(query, args)
}

func batchTaskTestExec(query string, args []driver.NamedValue) (driver.Result, error) {
	batchTaskTestState.mu.Lock()
	defer batchTaskTestState.mu.Unlock()
	query = compactBatchTaskSQL(query)
	switch {
	case strings.HasPrefix(query, "INSERT INTO shuihuo_import_compensation_queue"):
		projectID := args[0].Value.(int64)
		batchTaskTestState.importCleanups[projectID] = batchTaskImportCleanup{userID: args[1].Value.(int64), objectKey: args[2].Value.(string), reason: args[3].Value.(string), createdAt: time.Now().UTC()}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_import_compensation_queue SET attempt_count"):
		projectID := args[2].Value.(int64)
		cleanup, ok := batchTaskTestState.importCleanups[projectID]
		if !ok {
			return batchTaskResult{}, nil
		}
		cleanup.attemptCount++
		cleanup.lastError = args[0].Value.(string)
		batchTaskTestState.importCleanups[projectID] = cleanup
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_import_compensation_queue"):
		delete(batchTaskTestState.importCleanups, args[0].Value.(int64))
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_object_cleanup_queue"):
		key, reason := args[0].Value.(string), args[1].Value.(string)
		cleanup := batchTaskTestState.objectCleanups[key]
		cleanup.reason = reason
		if cleanup.createdAt.IsZero() {
			cleanup.createdAt = time.Now().UTC()
		}
		batchTaskTestState.objectCleanups[key] = cleanup
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_object_cleanup_queue SET lease_token"):
		token, expiresAt := args[0].Value.(string), args[1].Value.(time.Time)
		if strings.Contains(query, "object_key = ?") {
			key := args[2].Value.(string)
			cleanup, ok := batchTaskTestState.objectCleanups[key]
			if !ok || (cleanup.leaseExpires != nil && !cleanup.leaseExpires.Before(args[3].Value.(time.Time))) {
				return batchTaskResult{}, nil
			}
			cleanup.leaseToken, cleanup.leaseExpires = token, &expiresAt
			batchTaskTestState.objectCleanups[key] = cleanup
			return batchTaskResult{rows: 1}, nil
		}
		limit := int(args[3].Value.(int64))
		count := 0
		for key, cleanup := range batchTaskTestState.objectCleanups {
			if count >= limit || (cleanup.leaseExpires != nil && !cleanup.leaseExpires.Before(args[2].Value.(time.Time))) {
				continue
			}
			cleanup.leaseToken, cleanup.leaseExpires = token, &expiresAt
			batchTaskTestState.objectCleanups[key] = cleanup
			count++
		}
		return batchTaskResult{rows: int64(count)}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_object_cleanup_queue SET lease_expires_at"):
		expiresAt, key, token := args[0].Value.(time.Time), args[1].Value.(string), args[2].Value.(string)
		cleanup, ok := batchTaskTestState.objectCleanups[key]
		if !ok || cleanup.leaseToken != token {
			return batchTaskResult{}, nil
		}
		cleanup.leaseExpires = &expiresAt
		batchTaskTestState.objectCleanups[key] = cleanup
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_object_cleanup_queue SET attempt_count"):
		key := args[2].Value.(string)
		cleanup, ok := batchTaskTestState.objectCleanups[key]
		if !ok || (len(args) > 3 && cleanup.leaseToken != args[3].Value.(string)) {
			return batchTaskResult{}, nil
		}
		cleanup.attemptCount++
		cleanup.lastError = args[0].Value.(string)
		cleanup.leaseToken, cleanup.leaseExpires = "", nil
		batchTaskTestState.objectCleanups[key] = cleanup
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_object_cleanup_queue"):
		key := args[0].Value.(string)
		cleanup, ok := batchTaskTestState.objectCleanups[key]
		if !ok || (len(args) > 1 && cleanup.leaseToken != args[1].Value.(string)) {
			return batchTaskResult{}, nil
		}
		delete(batchTaskTestState.objectCleanups, key)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_projects"):
		batchTaskTestState.nextProject++
		id := batchTaskTestState.nextProject
		batchTaskTestState.projects[id] = domain.Project{
			ID:                  id,
			UserID:              args[0].Value.(int64),
			Name:                args[1].Value.(string),
			SourceText:          args[2].Value.(string),
			SourceObjectKey:     args[3].Value.(string),
			SegmentationStatus:  args[4].Value.(string),
			SegmentationVersion: int(args[5].Value.(int64)),
		}
		return batchTaskResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_projects SET source_object_key = ?"):
		if batchTaskTestState.failSourceObjectUpdate {
			return nil, errors.New("source object update failed")
		}
		projectID, ownerID := args[1].Value.(int64), args[2].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return batchTaskResult{}, nil
		}
		project.SourceObjectKey = args[0].Value.(string)
		if project.SegmentationStatus == "importing" {
			project.SegmentationStatus = "draft"
		}
		batchTaskTestState.projects[projectID] = project
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_assets a JOIN shuihuo_projects p ON p.id = a.project_id SET a.asset_type_id = ?"):
		assetID, ownerID := args[8].Value.(int64), args[9].Value.(int64)
		asset, ok := batchTaskTestState.assets[assetID]
		project, projectOK := batchTaskTestState.projects[asset.ProjectID]
		if !ok || !projectOK || project.UserID != ownerID {
			return batchTaskResult{}, nil
		}
		asset.AssetTypeID = namedValueInt64Pointer(args[0])
		asset.Category = args[1].Value.(string)
		asset.Name = args[2].Value.(string)
		asset.Prompt = args[3].Value.(string)
		asset.VoiceAssetID = namedValueInt64Pointer(args[4])
		asset.ReferenceObjectKey = args[5].Value.(string)
		asset.Source = args[6].Value.(string)
		asset.ManuallyEdited = args[7].Value.(bool)
		batchTaskTestState.assets[assetID] = asset
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_projects WHERE id = ?"):
		if batchTaskTestState.failProjectDelete {
			return nil, errors.New("project delete failed")
		}
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return batchTaskResult{}, nil
		}
		delete(batchTaskTestState.projects, projectID)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT IGNORE INTO shuihuo_segment_source_unit_history"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE project_id = ?"):
		projectID := args[0].Value.(int64)
		for id, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID {
				delete(batchTaskTestState.segments, id)
				delete(batchTaskTestState.sourceMappings, id)
			}
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_projects SET source_text = ?"):
		projectID, ownerID := args[1].Value.(int64), args[2].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return batchTaskResult{}, nil
		}
		project.SourceText = args[0].Value.(string)
		project.SourceObjectKey = ""
		project.SegmentationStatus = "draft"
		project.SegmentationVersion++
		batchTaskTestState.projects[projectID] = project
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_source_units"):
		batchTaskTestState.nextSourceUnit++
		id := batchTaskTestState.nextSourceUnit
		batchTaskTestState.sourceUnits = append(batchTaskTestState.sourceUnits, domain.SourceUnit{
			ID:                  id,
			ProjectID:           args[0].Value.(int64),
			Text:                args[1].Value.(string),
			SourceKind:          args[2].Value.(string),
			SegmentationVersion: int(args[3].Value.(int64)),
			SourceOrder:         int(args[4].Value.(int64)),
			CreatedAt:           time.Now().UTC(),
		})
		return batchTaskResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segments"):
		batchTaskTestState.nextSegment++
		id := batchTaskTestState.nextSegment
		batchTaskTestState.segments[id] = domain.Segment{
			ID:                   id,
			ProjectID:            args[0].Value.(int64),
			SourceText:           args[1].Value.(string),
			SubtitleText:         args[2].Value.(string),
			Speaker:              args[3].Value.(string),
			OrderIndex:           int(args[4].Value.(int64)),
			Confirmed:            args[5].Value.(bool),
			ManuallyEdited:       args[6].Value.(bool),
			ImagePrompt:          args[7].Value.(string),
			VideoPrompt:          args[8].Value.(string),
			NegativePrompt:       args[9].Value.(string),
			ImagePromptLocked:    args[10].Value.(bool),
			VideoPromptLocked:    args[11].Value.(bool),
			NegativePromptLocked: args[12].Value.(bool),
		}
		return batchTaskResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segment_source_units"):
		segmentID, sourceUnitID := args[0].Value.(int64), args[1].Value.(int64)
		batchTaskTestState.sourceMappings[segmentID] = append(batchTaskTestState.sourceMappings[segmentID], sourceUnitID)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET position_index = -position_index"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = -position_index + ?"):
		previousID, currentID := args[0].Value.(int64), args[2].Value.(int64)
		batchTaskTestState.sourceMappings[previousID] = append(batchTaskTestState.sourceMappings[previousID], batchTaskTestState.sourceMappings[currentID]...)
		delete(batchTaskTestState.sourceMappings, currentID)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET position_index = 1 WHERE"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segment_source_units SET segment_id = ?, position_index = 1"):
		newID, oldID, sourceUnitID := args[0].Value.(int64), args[1].Value.(int64), args[2].Value.(int64)
		mappings := batchTaskTestState.sourceMappings[oldID]
		for index, id := range mappings {
			if id == sourceUnitID {
				batchTaskTestState.sourceMappings[oldID] = append(mappings[:index], mappings[index+1:]...)
				batchTaskTestState.sourceMappings[newID] = append(batchTaskTestState.sourceMappings[newID], sourceUnitID)
				break
			}
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_source_units SET source_order = -source_order WHERE"):
		projectID, version, after := args[0].Value.(int64), int(args[1].Value.(int64)), int(args[2].Value.(int64))
		for index := range batchTaskTestState.sourceUnits {
			unit := &batchTaskTestState.sourceUnits[index]
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder > after {
				unit.SourceOrder = -unit.SourceOrder
			}
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_source_units SET source_order = -source_order + 1 WHERE"):
		projectID, version := args[0].Value.(int64), int(args[1].Value.(int64))
		for index := range batchTaskTestState.sourceUnits {
			unit := &batchTaskTestState.sourceUnits[index]
			if unit.ProjectID == projectID && unit.SegmentationVersion == version && unit.SourceOrder < 0 {
				unit.SourceOrder = -unit.SourceOrder + 1
			}
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET order_index = order_index +"):
		offset, projectID, after := int(args[0].Value.(int64)), args[1].Value.(int64), int(args[2].Value.(int64))
		for id, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID && segment.OrderIndex > after {
				segment.OrderIndex += offset
				batchTaskTestState.segments[id] = segment
			}
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET source_text = ? WHERE id = ?"):
		segmentID := args[1].Value.(int64)
		segment, ok := batchTaskTestState.segments[segmentID]
		if !ok {
			return batchTaskResult{}, nil
		}
		segment.SourceText = args[0].Value.(string)
		batchTaskTestState.segments[segmentID] = segment
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET source_text = ?, subtitle_text = ?"):
		segmentID, projectID := args[12].Value.(int64), args[13].Value.(int64)
		segment, ok := batchTaskTestState.segments[segmentID]
		if !ok || segment.ProjectID != projectID {
			return batchTaskResult{}, nil
		}
		segment.SourceText = args[0].Value.(string)
		segment.SubtitleText = args[1].Value.(string)
		segment.Speaker = args[2].Value.(string)
		segment.OrderIndex = int(args[3].Value.(int64))
		segment.Confirmed = args[4].Value.(bool)
		segment.ManuallyEdited = args[5].Value.(bool)
		segment.ImagePrompt = args[6].Value.(string)
		segment.VideoPrompt = args[7].Value.(string)
		segment.NegativePrompt = args[8].Value.(string)
		segment.ImagePromptLocked = args[9].Value.(bool)
		segment.VideoPromptLocked = args[10].Value.(bool)
		segment.NegativePromptLocked = args[11].Value.(bool)
		batchTaskTestState.segments[segmentID] = segment
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segment_assets WHERE segment_id = ?"):
		delete(batchTaskTestState.segmentAssetMappings, args[0].Value.(int64))
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_segment_assets(segment_id, asset_id)"):
		segmentID, assetID := args[0].Value.(int64), args[1].Value.(int64)
		batchTaskTestState.segmentAssetMappings[segmentID] = append(batchTaskTestState.segmentAssetMappings[segmentID], assetID)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE FROM shuihuo_segments WHERE id = ?"):
		segmentID := args[0].Value.(int64)
		delete(batchTaskTestState.segments, segmentID)
		delete(batchTaskTestState.sourceMappings, segmentID)
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_segments SET order_index = ? WHERE id = ?"):
		segmentID := args[1].Value.(int64)
		segment, ok := batchTaskTestState.segments[segmentID]
		if !ok {
			return batchTaskResult{}, nil
		}
		segment.OrderIndex = int(args[0].Value.(int64))
		batchTaskTestState.segments[segmentID] = segment
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_tasks"):
		batchTaskTestState.nextTask++
		id := batchTaskTestState.nextTask
		segmentID := args[1].Value.(int64)
		batchTaskTestState.tasks[id] = domain.Task{ID: id, ProjectID: args[0].Value.(int64), SegmentID: &segmentID, Status: domain.TaskStatus(args[3].Value.(string)), Input: args[9].Value.(string)}
		return batchTaskResult{id: id, rows: 1}, nil
	case strings.HasPrefix(query, "UPDATE shuihuo_tasks t JOIN shuihuo_projects p ON p.id = t.project_id SET t.status = ?"):
		taskID := args[1].Value.(int64)
		if task, ok := batchTaskTestState.tasks[taskID]; ok {
			task.Status = domain.TaskStatus(args[0].Value.(string))
			batchTaskTestState.tasks[taskID] = task
		}
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "INSERT INTO shuihuo_task_events"):
		return batchTaskResult{rows: 1}, nil
	case strings.HasPrefix(query, "DELETE t FROM shuihuo_tasks"):
		delete(batchTaskTestState.tasks, args[0].Value.(int64))
		return batchTaskResult{rows: 1}, nil
	default:
		return nil, fmt.Errorf("unexpected batch task exec query: %s", query)
	}
}

func batchTaskTestQuery(query string, args []driver.NamedValue) (driver.Rows, error) {
	batchTaskTestState.mu.Lock()
	defer batchTaskTestState.mu.Unlock()
	query = compactBatchTaskSQL(query)
	switch {
	case strings.Contains(query, "FROM shuihuo_user_configs"):
		return &batchTaskRows{columns: []string{"character_prefix", "image_prefix", "image_suffix", "video_prefix", "video_suffix", "video_generation_mode", "text_model_id", "image_model_id", "video_model_id", "audio_model_id", "jianying_draft_directory"}}, nil
	case strings.Contains(query, "FROM shuihuo_import_compensation_queue"):
		values := make([][]driver.Value, 0, len(batchTaskTestState.importCleanups))
		for projectID, cleanup := range batchTaskTestState.importCleanups {
			values = append(values, []driver.Value{projectID, cleanup.userID, cleanup.objectKey, cleanup.reason, cleanup.lastError, int64(cleanup.attemptCount), cleanup.createdAt, nil})
		}
		return &batchTaskRows{columns: []string{"project_id", "user_id", "object_key", "reason", "last_error", "attempt_count", "created_at", "last_attempt_at"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_object_cleanup_queue"):
		values := make([][]driver.Value, 0, len(batchTaskTestState.objectCleanups))
		for key, cleanup := range batchTaskTestState.objectCleanups {
			if strings.Contains(query, "WHERE lease_token = ?") && cleanup.leaseToken != args[0].Value.(string) {
				continue
			}
			var leaseExpires driver.Value
			if cleanup.leaseExpires != nil {
				leaseExpires = *cleanup.leaseExpires
			}
			values = append(values, []driver.Value{int64(len(values) + 1), key, cleanup.reason, cleanup.lastError, int64(cleanup.attemptCount), cleanup.createdAt, nil, cleanup.leaseToken, leaseExpires})
		}
		return &batchTaskRows{columns: []string{"id", "object_key", "reason", "last_error", "attempt_count", "created_at", "last_attempt_at", "lease_token", "lease_expires_at"}, values: values}, nil
	case strings.HasPrefix(query, "SELECT id, source_object_key, segmentation_version FROM shuihuo_projects"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{}, nil
		}
		return &batchTaskRows{columns: []string{"id", "source_object_key", "segmentation_version"}, values: [][]driver.Value{{project.ID, project.SourceObjectKey, int64(project.SegmentationVersion)}}}, nil
	case strings.HasPrefix(query, "SELECT segmentation_version FROM shuihuo_projects WHERE id = ?"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: []string{"segmentation_version"}}, nil
		}
		return &batchTaskRows{columns: []string{"segmentation_version"}, values: [][]driver.Value{{int64(project.SegmentationVersion)}}}, nil
	case strings.Contains(query, "FROM shuihuo_tasks") && strings.Contains(query, "status IN ('queued', 'running')"):
		projectID := args[0].Value.(int64)
		return &batchTaskRows{columns: []string{"exists"}, values: [][]driver.Value{{batchTaskTestState.activeTasks[projectID]}}}, nil
	case strings.HasPrefix(query, "SELECT t.project_id, t.segment_id, t.input_snapshot FROM shuihuo_tasks t"):
		task, ok := batchTaskTestState.tasks[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: []string{"project_id", "segment_id", "input_snapshot"}}, nil
		}
		project, ok := batchTaskTestState.projects[task.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: []string{"project_id", "segment_id", "input_snapshot"}}, nil
		}
		if hook := batchTaskTestState.transitionLockHook; hook != nil {
			batchTaskTestState.transitionLockHook = nil
			hook()
		}
		return &batchTaskRows{columns: []string{"project_id", "segment_id", "input_snapshot"}, values: [][]driver.Value{{task.ProjectID, *task.SegmentID, task.Input}}}, nil
	case strings.HasPrefix(query, "SELECT source_text, subtitle_text, image_prompt, video_prompt"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok || segment.ProjectID != args[1].Value.(int64) {
			return &batchTaskRows{}, nil
		}
		return &batchTaskRows{columns: []string{"source_text", "subtitle_text", "image_prompt", "video_prompt", "negative_prompt", "image_prompt_locked", "video_prompt_locked", "negative_prompt_locked", "order_index"}, values: [][]driver.Value{{segment.SourceText, segment.SubtitleText, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked, int64(segment.OrderIndex)}}}, nil
	case strings.HasPrefix(query, "SELECT m.position_index, u.id, u.text, u.source_order FROM shuihuo_segment_source_units"):
		return &batchTaskRows{}, nil
	case strings.HasPrefix(query, "SELECT EXISTS( SELECT 1 FROM shuihuo_segments WHERE id = ? AND project_id = ?"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		return &batchTaskRows{columns: []string{"exists"}, values: [][]driver.Value{{ok && segment.ProjectID == args[1].Value.(int64)}}}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_projects WHERE id = ? AND user_id = ? FOR UPDATE"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: []string{"id"}}, nil
		}
		return &batchTaskRows{columns: []string{"id"}, values: [][]driver.Value{{project.ID}}}, nil
	case strings.HasPrefix(query, "SELECT p.id FROM shuihuo_projects p JOIN shuihuo_segments s"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: []string{"id"}}, nil
		}
		project, ok := batchTaskTestState.projects[segment.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: []string{"id"}}, nil
		}
		return &batchTaskRows{columns: []string{"id"}, values: [][]driver.Value{{project.ID}}}, nil
	case strings.HasPrefix(query, "SELECT s.id, s.project_id") && strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p") && strings.Contains(query, "WHERE s.id = ?"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		project, ok := batchTaskTestState.projects[segment.ProjectID]
		if !ok || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		return &batchTaskRows{columns: segmentColumns, values: [][]driver.Value{batchTaskSegmentRow(segment)}}, nil
	case strings.HasPrefix(query, "SELECT id, project_id, source_text, subtitle_text, speaker, order_index") && strings.Contains(query, "FROM shuihuo_segments WHERE id = ? AND project_id = ?"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok || segment.ProjectID != args[1].Value.(int64) {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		return &batchTaskRows{columns: segmentColumns, values: [][]driver.Value{batchTaskSegmentRow(segment)}}, nil
	case strings.HasPrefix(query, "SELECT COUNT(*) FROM shuihuo_segment_source_units WHERE segment_id = ?"):
		return &batchTaskRows{columns: []string{"count"}, values: [][]driver.Value{{int64(len(batchTaskTestState.sourceMappings[args[0].Value.(int64)]))}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments") && strings.Contains(query, "WHERE project_id = ? AND order_index < ?"):
		projectID, before := args[0].Value.(int64), int(args[1].Value.(int64))
		var previous *domain.Segment
		for _, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID && segment.OrderIndex < before && (previous == nil || segment.OrderIndex > previous.OrderIndex) {
				copy := segment
				previous = &copy
			}
		}
		if previous == nil {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		return &batchTaskRows{columns: segmentColumns, values: [][]driver.Value{batchTaskSegmentRow(*previous)}}, nil
	case strings.HasPrefix(query, "SELECT COALESCE(MAX(order_index), 0) FROM shuihuo_segments WHERE project_id = ?"):
		projectID := args[0].Value.(int64)
		maximum := 0
		for _, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID && segment.OrderIndex > maximum {
				maximum = segment.OrderIndex
			}
		}
		return &batchTaskRows{columns: []string{"max"}, values: [][]driver.Value{{int64(maximum)}}}, nil
	case strings.HasPrefix(query, "SELECT COALESCE(MAX(u.source_order), 0) FROM shuihuo_segment_source_units m"):
		segmentID := args[0].Value.(int64)
		maximum := 0
		for _, sourceUnitID := range batchTaskTestState.sourceMappings[segmentID] {
			for _, unit := range batchTaskTestState.sourceUnits {
				if unit.ID == sourceUnitID && unit.SourceOrder > maximum {
					maximum = unit.SourceOrder
				}
			}
		}
		return &batchTaskRows{columns: []string{"max"}, values: [][]driver.Value{{int64(maximum)}}}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_segments WHERE project_id = ? ORDER BY order_index ASC, id ASC"):
		projectID := args[0].Value.(int64)
		segments := make([]domain.Segment, 0)
		for _, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID {
				segments = append(segments, segment)
			}
		}
		sort.Slice(segments, func(left, right int) bool {
			return segments[left].OrderIndex < segments[right].OrderIndex || (segments[left].OrderIndex == segments[right].OrderIndex && segments[left].ID < segments[right].ID)
		})
		values := make([][]driver.Value, 0, len(segments))
		for _, segment := range segments {
			values = append(values, []driver.Value{segment.ID})
		}
		return &batchTaskRows{columns: []string{"id"}, values: values}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_segments WHERE project_id = ?"):
		projectID := args[0].Value.(int64)
		values := make([][]driver.Value, 0)
		for _, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID {
				values = append(values, []driver.Value{segment.ID})
			}
		}
		return &batchTaskRows{columns: []string{"id"}, values: values}, nil
	case strings.HasPrefix(query, "SELECT id FROM shuihuo_assets WHERE project_id = ? AND id IN"):
		projectID := args[0].Value.(int64)
		values := make([][]driver.Value, 0, len(args)-1)
		for _, arg := range args[1:] {
			asset, ok := batchTaskTestState.assets[arg.Value.(int64)]
			if ok && asset.ProjectID == projectID {
				values = append(values, []driver.Value{asset.ID})
			}
		}
		return &batchTaskRows{columns: []string{"id"}, values: values}, nil
	case strings.HasPrefix(query, "SELECT m.source_unit_id, u.text FROM shuihuo_segment_source_units m JOIN shuihuo_source_units u"):
		segmentID := args[0].Value.(int64)
		values := make([][]driver.Value, 0, len(batchTaskTestState.sourceMappings[segmentID]))
		for _, sourceUnitID := range batchTaskTestState.sourceMappings[segmentID] {
			for _, unit := range batchTaskTestState.sourceUnits {
				if unit.ID == sourceUnitID {
					values = append(values, []driver.Value{sourceUnitID, unit.Text})
					break
				}
			}
		}
		return &batchTaskRows{columns: []string{"source_unit_id", "text"}, values: values}, nil
	case strings.HasPrefix(query, "SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version, created_at, updated_at FROM shuihuo_projects"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) || (strings.Contains(query, "segmentation_status <> 'importing'") && project.SegmentationStatus == "importing") {
			return &batchTaskRows{columns: projectColumns}, nil
		}
		return &batchTaskRows{columns: projectColumns, values: [][]driver.Value{{project.ID, project.UserID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, int64(project.SegmentationVersion), project.CreatedAt, project.UpdatedAt}}}, nil
	case strings.HasPrefix(query, "SELECT id, user_id, name, source_text, source_object_key, segmentation_status, segmentation_version FROM shuihuo_projects"):
		project, ok := batchTaskTestState.projects[args[0].Value.(int64)]
		if !ok || project.UserID != args[1].Value.(int64) || (strings.Contains(query, "segmentation_status <> 'importing'") && project.SegmentationStatus == "importing") {
			return &batchTaskRows{columns: projectReadColumns}, nil
		}
		return &batchTaskRows{columns: projectReadColumns, values: [][]driver.Value{{project.ID, project.UserID, project.Name, project.SourceText, project.SourceObjectKey, project.SegmentationStatus, int64(project.SegmentationVersion)}}}, nil
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p") && strings.Contains(query, "WHERE s.project_id = ?"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		if !ok || project.UserID != ownerID {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		segments := make([]domain.Segment, 0)
		for _, segment := range batchTaskTestState.segments {
			if segment.ProjectID == projectID {
				segments = append(segments, segment)
			}
		}
		sort.Slice(segments, func(left, right int) bool {
			return segments[left].OrderIndex < segments[right].OrderIndex || (segments[left].OrderIndex == segments[right].OrderIndex && segments[left].ID < segments[right].ID)
		})
		values := make([][]driver.Value, 0, len(segments))
		for _, segment := range segments {
			values = append(values, batchTaskSegmentRow(segment))
		}
		return &batchTaskRows{columns: segmentColumns, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_source_units u") && strings.Contains(query, "JOIN shuihuo_projects p"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		values := make([][]driver.Value, 0)
		if ok && project.UserID == ownerID {
			for _, unit := range batchTaskTestState.sourceUnits {
				if unit.ProjectID == projectID && unit.SegmentationVersion == project.SegmentationVersion {
					values = append(values, []driver.Value{unit.ID, unit.ProjectID, unit.Text, unit.SourceKind, int64(unit.SegmentationVersion), int64(unit.SourceOrder), unit.CreatedAt})
				}
			}
		}
		return &batchTaskRows{columns: []string{"id", "project_id", "text", "source_kind", "segmentation_version", "source_order", "created_at"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_segment_source_units m") && strings.Contains(query, "JOIN shuihuo_segments s"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		values := make([][]driver.Value, 0)
		if ok && project.UserID == ownerID {
			for segmentID, sourceUnitIDs := range batchTaskTestState.sourceMappings {
				for _, sourceUnitID := range sourceUnitIDs {
					for _, unit := range batchTaskTestState.sourceUnits {
						if unit.ID == sourceUnitID && unit.SegmentationVersion == project.SegmentationVersion {
							values = append(values, []driver.Value{segmentID, sourceUnitID})
							break
						}
					}
				}
			}
		}
		return &batchTaskRows{columns: []string{"segment_id", "source_unit_id"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_segment_assets sa") && strings.Contains(query, "JOIN shuihuo_segments s"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		values := make([][]driver.Value, 0)
		if ok && project.UserID == ownerID {
			for segmentID, assetIDs := range batchTaskTestState.segmentAssetMappings {
				if segment, segmentOK := batchTaskTestState.segments[segmentID]; segmentOK && segment.ProjectID == projectID {
					for _, assetID := range assetIDs {
						values = append(values, []driver.Value{segmentID, assetID})
					}
				}
			}
		}
		return &batchTaskRows{columns: []string{"segment_id", "asset_id"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_segment_assets sa") && strings.Contains(query, "a.category IN ('character', 'scene', 'prop')"):
		segmentID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		segment, segmentOK := batchTaskTestState.segments[segmentID]
		project, projectOK := batchTaskTestState.projects[segment.ProjectID]
		if !segmentOK || !projectOK || project.UserID != ownerID {
			return &batchTaskRows{columns: []string{"reference_object_key"}}, nil
		}
		assetIDs := append([]int64(nil), batchTaskTestState.segmentAssetMappings[segmentID]...)
		sort.Slice(assetIDs, func(left, right int) bool { return assetIDs[left] < assetIDs[right] })
		values := make([][]driver.Value, 0, len(assetIDs))
		for _, assetID := range assetIDs {
			asset := batchTaskTestState.assets[assetID]
			if asset.IsCurrent && (asset.Category == "character" || asset.Category == "scene" || asset.Category == "prop") {
				values = append(values, []driver.Value{asset.ReferenceObjectKey})
			}
		}
		return &batchTaskRows{columns: []string{"reference_object_key"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_segment_assets sa") && strings.Contains(query, "a.category IN ('character', 'prop')"):
		segmentID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		segment, segmentOK := batchTaskTestState.segments[segmentID]
		project, projectOK := batchTaskTestState.projects[segment.ProjectID]
		if !segmentOK || !projectOK || project.UserID != ownerID {
			return &batchTaskRows{columns: []string{"reference_object_key"}}, nil
		}
		assetIDs := append([]int64(nil), batchTaskTestState.segmentAssetMappings[segmentID]...)
		sort.Slice(assetIDs, func(left, right int) bool { return assetIDs[left] < assetIDs[right] })
		values := make([][]driver.Value, 0, len(assetIDs))
		for _, assetID := range assetIDs {
			asset := batchTaskTestState.assets[assetID]
			if !asset.IsCurrent || (asset.Category != "character" && asset.Category != "prop") {
				continue
			}
			values = append(values, []driver.Value{asset.ReferenceObjectKey})
		}
		return &batchTaskRows{columns: []string{"reference_object_key"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_segment_assets sa") && strings.Contains(query, "a.category = 'scene'"):
		segmentID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		segment, segmentOK := batchTaskTestState.segments[segmentID]
		project, projectOK := batchTaskTestState.projects[segment.ProjectID]
		if !segmentOK || !projectOK || project.UserID != ownerID {
			return &batchTaskRows{columns: []string{"reference_object_key"}}, nil
		}
		assetIDs := append([]int64(nil), batchTaskTestState.segmentAssetMappings[segmentID]...)
		sort.Slice(assetIDs, func(left, right int) bool { return assetIDs[left] < assetIDs[right] })
		for _, assetID := range assetIDs {
			asset := batchTaskTestState.assets[assetID]
			if asset.IsCurrent && asset.Category == "scene" && asset.ReferenceObjectKey != "" {
				return &batchTaskRows{columns: []string{"reference_object_key"}, values: [][]driver.Value{{asset.ReferenceObjectKey}}}, nil
			}
		}
		return &batchTaskRows{columns: []string{"reference_object_key"}}, nil
	case strings.HasPrefix(query, "SELECT id, project_id, segment_id, task_id, kind, object_key, source, manually_edited, width, height, duration_ms, is_primary FROM shuihuo_media WHERE project_id = ?"):
		media, ok := batchTaskTestState.primaryImages[args[1].Value.(int64)]
		if !ok || media.ProjectID != args[0].Value.(int64) {
			return &batchTaskRows{columns: mediaColumns}, nil
		}
		return &batchTaskRows{columns: mediaColumns, values: [][]driver.Value{{media.ID, media.ProjectID, media.SegmentID, media.TaskID, media.Kind, media.ObjectKey, media.Source, media.ManuallyEdited, media.Width, media.Height, media.DurationMS, media.IsPrimary}}}, nil
	case strings.HasPrefix(query, "SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.voice_asset_id, a.reference_object_key, a.source, a.manually_edited, a.is_current FROM shuihuo_assets a") && strings.Contains(query, "WHERE a.id = ? AND p.user_id = ?"):
		asset, ok := batchTaskTestState.assets[args[0].Value.(int64)]
		project, projectOK := batchTaskTestState.projects[asset.ProjectID]
		if !ok || !projectOK || project.UserID != args[1].Value.(int64) {
			return &batchTaskRows{columns: assetColumns}, nil
		}
		return &batchTaskRows{columns: assetColumns, values: [][]driver.Value{batchTaskAssetRow(asset)}}, nil
	case strings.Contains(query, "FROM shuihuo_assets a"):
		projectID, ownerID := args[0].Value.(int64), args[1].Value.(int64)
		project, ok := batchTaskTestState.projects[projectID]
		values := make([][]driver.Value, 0)
		if ok && project.UserID == ownerID {
			for _, asset := range batchTaskTestState.assets {
				if asset.ProjectID == projectID {
					values = append(values, batchTaskAssetRow(asset))
				}
			}
		}
		return &batchTaskRows{columns: []string{"id", "project_id", "asset_type_id", "category", "name", "prompt", "voice_asset_id", "reference_object_key", "source", "manually_edited", "is_current"}, values: values}, nil
	case strings.Contains(query, "FROM shuihuo_media m") || strings.Contains(query, "FROM shuihuo_segment_assets sa"):
		return &batchTaskRows{}, nil
	case strings.Contains(query, "FROM shuihuo_segments s JOIN shuihuo_projects p"):
		segment, ok := batchTaskTestState.segments[args[0].Value.(int64)]
		if !ok {
			return &batchTaskRows{columns: segmentColumns}, nil
		}
		return &batchTaskRows{columns: segmentColumns, values: [][]driver.Value{{segment.ID, segment.ProjectID, "", segment.SubtitleText, segment.Speaker, int64(1), segment.Confirmed, false, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, false, false, false}}}, nil
	case strings.Contains(query, "FROM model_definitions d") && strings.Contains(query, "WHERE d.id = ? AND d.enabled = TRUE"):
		if args[0].Value.(int64) != batchTaskTestState.model.ID {
			return &batchTaskRows{columns: modelColumns}, nil
		}
		model := batchTaskTestState.model
		return &batchTaskRows{columns: modelColumns, values: [][]driver.Value{{model.ID, model.ModelID, model.VersionID, model.Name, string(model.Kind), model.AdapterKind, model.Enabled, []byte("[]"), []byte("{}"), model.CredentialRef, model.Endpoint, model.RequestTemplate, model.ResponseMapping}}}, nil
	default:
		return nil, fmt.Errorf("unexpected batch task query: %s", query)
	}
}

func batchTaskSegmentRow(segment domain.Segment) []driver.Value {
	return []driver.Value{segment.ID, segment.ProjectID, segment.SourceText, segment.SubtitleText, segment.Speaker, int64(segment.OrderIndex), segment.Confirmed, segment.ManuallyEdited, segment.ImagePrompt, segment.VideoPrompt, segment.NegativePrompt, segment.ImagePromptLocked, segment.VideoPromptLocked, segment.NegativePromptLocked}
}

func batchTaskAssetRow(asset domain.Asset) []driver.Value {
	return []driver.Value{asset.ID, asset.ProjectID, asset.AssetTypeID, asset.Category, asset.Name, asset.Prompt, asset.VoiceAssetID, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, asset.IsCurrent}
}

func namedValueInt64Pointer(value driver.NamedValue) *int64 {
	if value.Value == nil {
		return nil
	}
	result := value.Value.(int64)
	return &result
}

func compactBatchTaskSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type batchTaskResult struct{ id, rows int64 }

func (r batchTaskResult) LastInsertId() (int64, error) { return r.id, nil }
func (r batchTaskResult) RowsAffected() (int64, error) { return r.rows, nil }

var projectColumns = []string{"id", "user_id", "name", "source_text", "source_object_key", "segmentation_status", "segmentation_version", "created_at", "updated_at"}
var projectReadColumns = []string{"id", "user_id", "name", "source_text", "source_object_key", "segmentation_status", "segmentation_version"}
var segmentColumns = []string{"id", "project_id", "source_text", "subtitle_text", "speaker", "order_index", "confirmed", "manually_edited", "image_prompt", "video_prompt", "negative_prompt", "image_prompt_locked", "video_prompt_locked", "negative_prompt_locked"}
var assetColumns = []string{"id", "project_id", "asset_type_id", "category", "name", "prompt", "voice_asset_id", "reference_object_key", "source", "manually_edited", "is_current"}
var mediaColumns = []string{"id", "project_id", "segment_id", "task_id", "kind", "object_key", "source", "manually_edited", "width", "height", "duration_ms", "is_primary"}
var modelColumns = []string{"id", "model_key", "version_id", "name", "kind", "adapter_kind", "enabled", "allowed_roles_json", "parameter_schema_json", "credential_ref", "endpoint", "request_template", "response_mapping"}

type batchTaskRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *batchTaskRows) Columns() []string { return r.columns }
func (r *batchTaskRows) Close() error      { return nil }
func (r *batchTaskRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func TestYDVideoTaskRequiresCurrentUserAccountKeyBeforeQueueing(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	api.deps.VideoConfigs = &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	api.deps.CredentialCipher = testCredentialCipher(t)
	batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true}
	segment := batchTaskTestState.segments[11]
	segment.VideoPrompt = "镜头缓慢推进"
	batchTaskTestState.segments[11] = segment

	req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"video","modelId":7}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusConflict {
		t.Fatalf("create YD video task = %d, want conflict", response.Code)
	}
	if !strings.Contains(response.Body.String(), "请先在工作台设置中配置中转亚迪 API Key") {
		t.Fatalf("create YD video task returned unexpected setup error")
	}
	if len(queue.ids) != 0 || len(batchTaskTestState.tasks) != 0 {
		t.Fatalf("YD task was persisted or queued without an account key")
	}
}

func TestYDVideoTaskAllowsAccountKeyWithoutModelCredentialRef(t *testing.T) {
	const accountKey = "test-yd-account-key"
	cipher := testCredentialCipher(t)
	ciphertext, err := cipher.Encrypt(accountKey)
	if err != nil {
		t.Fatal(err)
	}
	api, queue := newBatchTaskTestAPI(t)
	configs := &videoConfigTestStore{configs: map[int64]store.VideoAPIConfig{}}
	if err := configs.Save(context.Background(), 100, store.VideoAPIConfig{Provider: store.YDVideoProvider, APIKeyCiphertext: ciphertext}); err != nil {
		t.Fatal(err)
	}
	api.deps.VideoConfigs = configs
	api.deps.CredentialCipher = cipher
	batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true}
	segment := batchTaskTestState.segments[11]
	segment.VideoPrompt = "镜头缓慢推进"
	batchTaskTestState.segments[11] = segment
	segmentID := int64(11)
	batchTaskTestState.primaryImages[segmentID] = domain.Media{
		ID: 88, ProjectID: 1, SegmentID: &segmentID, Kind: "image",
		ObjectKey: "shuihuo-production/100/1/images/scene.png", IsPrimary: true,
	}

	req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"video","modelId":7}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusCreated {
		t.Fatalf("create YD video task = %d, want created", response.Code)
	}
	if strings.Contains(response.Body.String(), accountKey) || batchTaskTestState.model.CredentialRef != "" {
		t.Fatal("account credential leaked into task creation state")
	}
	if len(queue.ids) != 1 || len(batchTaskTestState.tasks) != 1 {
		t.Fatalf("YD task persistence or queueing = tasks:%d queue:%#v, want one", len(batchTaskTestState.tasks), queue.ids)
	}
	task := batchTaskTestState.tasks[queue.ids[0]]
	if !strings.Contains(task.Input, `"sourceImageObjectKey":"shuihuo-production/100/1/images/scene.png"`) || strings.Contains(task.Input, accountKey) || strings.Contains(task.Input, ciphertext) {
		t.Fatal("YD task snapshot did not retain only generation input")
	}
}

func TestYDVideoTaskFallsBackToAvailableBoundAssetWhenPrimaryImageIsMissing(t *testing.T) {
	api, queue := newBatchTaskTestAPI(t)
	api.deps.Objects = &recordingObjects{putBodies: map[string][]byte{
		"shuihuo-production/100/1/asset-images/hero.png": []byte("available asset image"),
	}}
	batchTaskTestState.model = models.Definition{ID: 7, ModelID: "yd-mini", VersionID: 8, Name: "YD2 Mini", Kind: models.KindVideo, AdapterKind: models.AdapterYDVideo, Enabled: true}
	segment := batchTaskTestState.segments[11]
	segment.VideoPrompt = "镜头缓慢推进"
	batchTaskTestState.segments[11] = segment
	segmentID := int64(11)
	batchTaskTestState.primaryImages[segmentID] = domain.Media{
		ID: 88, ProjectID: 1, SegmentID: &segmentID, Kind: "image",
		ObjectKey: "shuihuo-production/100/1/images/missing.png", IsPrimary: true,
	}
	batchTaskTestState.assets[101] = domain.Asset{
		ID: 101, ProjectID: 1, Category: "character", ReferenceObjectKey: "shuihuo-production/100/1/asset-images/hero.png", IsCurrent: true,
	}
	batchTaskTestState.segmentAssetMappings[segmentID] = []int64{101}

	req := batchTaskBridgeRequest(t, http.MethodPost, "/api/shuihuo-production/projects/1/tasks", "producer", false)
	req.Body = io.NopCloser(strings.NewReader(`{"segmentId":11,"kind":"video","modelId":7}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.Router().ServeHTTP(response, req)

	if response.Code != http.StatusCreated || len(queue.ids) != 1 {
		t.Fatalf("create YD video task = %d %s, queued = %#v", response.Code, response.Body.String(), queue.ids)
	}
	task := batchTaskTestState.tasks[queue.ids[0]]
	if !strings.Contains(task.Input, `"sourceImageObjectKey":"shuihuo-production/100/1/asset-images/hero.png"`) {
		t.Fatalf("task input did not fall back to the available asset: %s", task.Input)
	}
}
