package miniprogramauth

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type testAccounts struct {
	account Account
	err     error
}

func (a testAccounts) Authenticate(_ context.Context, _, _ string) (Account, error) {
	return a.account, a.err
}
func (a testAccounts) Account(_ context.Context, _ string) (Account, error) { return a.account, a.err }

type testExchanger struct {
	identity Identity
	err      error
}

func (e testExchanger) Exchange(_ context.Context, _ string) (Identity, error) {
	return e.identity, e.err
}

func TestSessionReturnsBindingTicketForUnboundIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT username FROM wechat_miniprogram_identities").
		WithArgs(hash("openid:wx-open-id")).
		WillReturnRows(sqlmock.NewRows([]string{"username"}))
	mock.ExpectExec("INSERT INTO wechat_miniprogram_binding_tickets").
		WithArgs(sqlmock.AnyArg(), hash("openid:wx-open-id"), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	service := NewForTest(&store{db: db}, testAccounts{}, testExchanger{identity: Identity{OpenID: "wx-open-id"}}, time.Minute, time.Hour)
	response, err := service.Session(context.Background(), "wechat-code")
	if err != nil {
		t.Fatal(err)
	}
	if !response.BindingRequired || response.BindingTicket == "" || response.Token != "" {
		t.Fatalf("response=%+v, want a binding ticket only", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSessionIssuesSessionForBoundActiveAccount(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT username FROM wechat_miniprogram_identities").
		WithArgs(hash("openid:wx-open-id")).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("ming"))
	mock.ExpectExec("INSERT INTO wechat_miniprogram_sessions").
		WithArgs(sqlmock.AnyArg(), "ming", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	service := NewForTest(&store{db: db}, testAccounts{account: Account{Username: "ming", IsOwner: true}}, testExchanger{identity: Identity{OpenID: "wx-open-id"}}, time.Minute, time.Hour)
	response, err := service.Session(context.Background(), "wechat-code")
	if err != nil {
		t.Fatal(err)
	}
	if response.Token == "" || response.Account == nil || response.Account.Username != "ming" || !response.Account.IsOwner || response.BindingRequired {
		t.Fatalf("response=%+v, want an authenticated owner session", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuthenticateRejectsSessionWhenAccountIsNoLongerActive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT username FROM wechat_miniprogram_sessions").
		WithArgs(hash("session-token"), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"username"}).AddRow("disabled-user"))

	service := NewForTest(&store{db: db}, testAccounts{err: ErrInvalidCredentials}, testExchanger{}, time.Minute, time.Hour)
	if _, _, err := service.Authenticate(context.Background(), "session-token"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err=%v, want invalid credentials after deactivation", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestNewLeavesServiceDisabledWithoutWechatCredentials(t *testing.T) {
	service, err := New(Config{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Session(context.Background(), "code"); !errors.Is(err, ErrUnconfigured) {
		t.Fatalf("err=%v, want unconfigured", err)
	}
}

func TestFileAccountsRejectsPendingAccount(t *testing.T) {
	accountsFile := t.TempDir() + "/accounts.json"
	if err := os.WriteFile(accountsFile, []byte(`[{"username":"pending-user","active":true,"pending":true}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := (FileAccounts{Path: accountsFile}).Account(context.Background(), "pending-user"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err=%v, want pending account rejection", err)
	}
}
