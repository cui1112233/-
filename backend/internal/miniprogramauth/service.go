package miniprogramauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

var (
	ErrUnconfigured         = errors.New("wechat mini-program authentication is not configured")
	ErrInvalidRequest       = errors.New("invalid request")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrInvalidTicket        = errors.New("invalid binding ticket")
	ErrIdentityAlreadyBound = errors.New("wechat identity is already bound")
	ErrWechatProvider       = errors.New("wechat provider is unavailable")
)

const (
	defaultCode2SessionURL = "https://api.weixin.qq.com/sns/jscode2session"
	defaultTicketTTL       = 10 * time.Minute
	defaultSessionTTL      = 30 * 24 * time.Hour
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,32}$`)

type Config struct {
	AppID           string
	AppSecret       string
	Code2SessionURL string
	AccountsPath    string
	TicketTTL       time.Duration
	SessionTTL      time.Duration
}

type Account struct {
	Username string
	IsOwner  bool
}

type Identity struct {
	OpenID string
}

type AccountVerifier interface {
	Authenticate(context.Context, string, string) (Account, error)
	Account(context.Context, string) (Account, error)
}

type CodeExchanger interface {
	Exchange(context.Context, string) (Identity, error)
}

type Service struct {
	store      *store
	accounts   AccountVerifier
	exchanger  CodeExchanger
	ticketTTL  time.Duration
	sessionTTL time.Duration
	enabled    bool
}

type SessionResponse struct {
	Token           string   `json:"token,omitempty"`
	Account         *Account `json:"account,omitempty"`
	BindingRequired bool     `json:"bindingRequired,omitempty"`
	BindingTicket   string   `json:"bindingTicket,omitempty"`
}

func New(cfg Config, db *sql.DB) (*Service, error) {
	service := &Service{ticketTTL: cfg.TicketTTL, sessionTTL: cfg.SessionTTL}
	if service.ticketTTL == 0 {
		service.ticketTTL = defaultTicketTTL
	}
	if service.sessionTTL == 0 {
		service.sessionTTL = defaultSessionTTL
	}
	if strings.TrimSpace(cfg.AppID) == "" || strings.TrimSpace(cfg.AppSecret) == "" {
		return service, nil
	}
	if db == nil || strings.TrimSpace(cfg.AccountsPath) == "" {
		return nil, fmt.Errorf("wechat mini-program auth dependencies are required")
	}
	endpoint := strings.TrimSpace(cfg.Code2SessionURL)
	if endpoint == "" {
		endpoint = defaultCode2SessionURL
	}
	if parsed, err := url.Parse(endpoint); err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, fmt.Errorf("wechat code2session endpoint must be HTTPS")
	}
	service.store = &store{db: db}
	service.accounts = FileAccounts{Path: cfg.AccountsPath}
	service.exchanger = HTTPCodeExchanger{AppID: strings.TrimSpace(cfg.AppID), AppSecret: strings.TrimSpace(cfg.AppSecret), Endpoint: endpoint}
	service.enabled = true
	return service, nil
}

func NewForTest(store *store, accounts AccountVerifier, exchanger CodeExchanger, ticketTTL, sessionTTL time.Duration) *Service {
	return &Service{store: store, accounts: accounts, exchanger: exchanger, ticketTTL: ticketTTL, sessionTTL: sessionTTL, enabled: true}
}

func (s *Service) Session(ctx context.Context, code string) (SessionResponse, error) {
	if !s.enabled {
		return SessionResponse{}, ErrUnconfigured
	}
	if strings.TrimSpace(code) == "" {
		return SessionResponse{}, ErrInvalidRequest
	}
	identity, err := s.exchanger.Exchange(ctx, strings.TrimSpace(code))
	if err != nil || strings.TrimSpace(identity.OpenID) == "" {
		return SessionResponse{}, ErrWechatProvider
	}
	identityHash := hash("openid:" + identity.OpenID)
	username, found, err := s.store.identityUsername(ctx, identityHash)
	if err != nil {
		return SessionResponse{}, err
	}
	if found {
		account, accountErr := s.accounts.Account(ctx, username)
		if accountErr == nil {
			return s.issue(ctx, account)
		}
	}
	ticket, err := randomToken()
	if err != nil {
		return SessionResponse{}, err
	}
	if err := s.store.createTicket(ctx, hash(ticket), identityHash, time.Now().UTC().Add(s.ticketTTL)); err != nil {
		return SessionResponse{}, err
	}
	return SessionResponse{BindingRequired: true, BindingTicket: ticket}, nil
}

func (s *Service) Bind(ctx context.Context, ticket, username, password string) (SessionResponse, error) {
	if !s.enabled {
		return SessionResponse{}, ErrUnconfigured
	}
	if strings.TrimSpace(ticket) == "" || !usernamePattern.MatchString(strings.TrimSpace(username)) || password == "" {
		return SessionResponse{}, ErrInvalidRequest
	}
	account, err := s.accounts.Authenticate(ctx, strings.TrimSpace(username), password)
	if err != nil {
		return SessionResponse{}, ErrInvalidCredentials
	}
	if err := s.store.bindIdentity(ctx, hash(ticket), account.Username); err != nil {
		return SessionResponse{}, err
	}
	return s.issue(ctx, account)
}

func (s *Service) Authenticate(ctx context.Context, token string) (string, bool, error) {
	if !s.enabled || strings.TrimSpace(token) == "" {
		return "", false, ErrInvalidCredentials
	}
	username, found, err := s.store.sessionUsername(ctx, hash(token), time.Now().UTC())
	if err != nil || !found {
		return "", false, ErrInvalidCredentials
	}
	account, err := s.accounts.Account(ctx, username)
	if err != nil {
		return "", false, ErrInvalidCredentials
	}
	return account.Username, account.IsOwner, nil
}

func (s *Service) issue(ctx context.Context, account Account) (SessionResponse, error) {
	token, err := randomToken()
	if err != nil {
		return SessionResponse{}, err
	}
	if err := s.store.createSession(ctx, hash(token), account.Username, time.Now().UTC().Add(s.sessionTTL)); err != nil {
		return SessionResponse{}, err
	}
	return SessionResponse{Token: token, Account: &account}, nil
}

type FileAccounts struct{ Path string }

type fileAccount struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	IsOwner      bool   `json:"isOwner"`
	Active       bool   `json:"active"`
	Pending      bool   `json:"pending"`
}

func (f FileAccounts) Authenticate(ctx context.Context, username, password string) (Account, error) {
	account, record, err := f.lookup(ctx, username)
	if err != nil || !record.Active || record.Pending || !matchesPassword(record.PasswordHash, password) {
		return Account{}, ErrInvalidCredentials
	}
	return account, nil
}

func (f FileAccounts) Account(ctx context.Context, username string) (Account, error) {
	account, record, err := f.lookup(ctx, username)
	if err != nil || !record.Active || record.Pending {
		return Account{}, ErrInvalidCredentials
	}
	return account, nil
}

func (f FileAccounts) lookup(ctx context.Context, username string) (Account, fileAccount, error) {
	if err := ctx.Err(); err != nil {
		return Account{}, fileAccount{}, err
	}
	data, err := os.ReadFile(f.Path)
	if err != nil {
		return Account{}, fileAccount{}, err
	}
	var accounts []fileAccount
	if err := json.Unmarshal(data, &accounts); err != nil {
		return Account{}, fileAccount{}, err
	}
	for _, record := range accounts {
		if record.Username == username && usernamePattern.MatchString(record.Username) {
			return Account{Username: record.Username, IsOwner: record.IsOwner}, record, nil
		}
	}
	return Account{}, fileAccount{}, ErrInvalidCredentials
}

func matchesPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "scrypt" || password == "" {
		return false
	}
	salt, saltErr := hex.DecodeString(parts[1])
	expected, expectedErr := hex.DecodeString(parts[2])
	if saltErr != nil || expectedErr != nil || len(salt) != 16 || len(expected) != 64 {
		return false
	}
	actual, err := scrypt.Key([]byte(password), salt, 1<<14, 8, 1, len(expected))
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}

type HTTPCodeExchanger struct {
	AppID, AppSecret, Endpoint string
	Client                     *http.Client
}

func (e HTTPCodeExchanger) Exchange(ctx context.Context, code string) (Identity, error) {
	endpoint, err := url.Parse(e.Endpoint)
	if err != nil {
		return Identity{}, ErrWechatProvider
	}
	query := endpoint.Query()
	query.Set("appid", e.AppID)
	query.Set("secret", e.AppSecret)
	query.Set("js_code", code)
	query.Set("grant_type", "authorization_code")
	endpoint.RawQuery = query.Encode()
	client := e.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Identity{}, ErrWechatProvider
	}
	response, err := client.Do(request)
	if err != nil {
		return Identity{}, ErrWechatProvider
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return Identity{}, ErrWechatProvider
	}
	var payload struct {
		OpenID  string `json:"openid"`
		ErrCode int    `json:"errcode"`
	}
	if json.Unmarshal(body, &payload) != nil || response.StatusCode < 200 || response.StatusCode >= 300 || payload.ErrCode != 0 || strings.TrimSpace(payload.OpenID) == "" {
		return Identity{}, ErrWechatProvider
	}
	return Identity{OpenID: strings.TrimSpace(payload.OpenID)}, nil
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
