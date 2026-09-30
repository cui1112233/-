//go:build darwin

package credential

import (
	"encoding/json"
	"errors"
	"os/exec"
	"strings"
	"time"
)

const keychainService = "com.yizhanshengming.giant-material-executor"
const keychainAccount = "device-credential"

type keychainStore struct{}

func NewDeviceStore(_ string) Store { return keychainStore{} }

func (keychainStore) Load() (Record, error) {
	output, err := exec.Command("/usr/bin/security", "find-generic-password", "-a", keychainAccount, "-s", keychainService, "-w").Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 44 {
			return Record{}, ErrNotFound
		}
		return Record{}, errors.New("read executor credential from Keychain")
	}
	return decodeRecord([]byte(strings.TrimSpace(string(output))))
}

func (keychainStore) Save(record Record) error {
	if err := record.validate(); err != nil {
		return err
	}
	if record.SavedAt.IsZero() {
		record.SavedAt = time.Now().UTC()
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	// Keep the token out of command arguments and logs. security reads the
	// prompted password from stdin when -w is the final argument.
	command := exec.Command("/usr/bin/security", "add-generic-password", "-a", keychainAccount, "-s", keychainService, "-U", "-w")
	command.Stdin = strings.NewReader(string(data) + "\n")
	if err := command.Run(); err != nil {
		return errors.New("save executor credential to Keychain")
	}
	return nil
}

func (keychainStore) Clear() error {
	command := exec.Command("/usr/bin/security", "delete-generic-password", "-a", keychainAccount, "-s", keychainService)
	if err := command.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 44 {
			return nil
		}
		return errors.New("clear executor credential from Keychain")
	}
	return nil
}
