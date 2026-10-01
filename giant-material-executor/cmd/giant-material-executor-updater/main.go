package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	appBundleName = "GiantMaterialExecutor.app"
	macMainBinary = "GiantMaterialExecutor"
)

// macAppBundleFromExecutable derives the one application bundle an updater is
// allowed to replace. It rejects a loose binary so an arbitrary file cannot be
// selected as an update target.
func macAppBundleFromExecutable(executable string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(executable))
	needle := string(os.PathSeparator) + appBundleName + string(os.PathSeparator) + "Contents" + string(os.PathSeparator) + "MacOS" + string(os.PathSeparator)
	index := strings.Index(clean, needle)
	if index <= 0 || filepath.Base(clean) != macMainBinary {
		return "", errors.New("executable is not inside GiantMaterialExecutor.app")
	}
	return clean[:index+len(string(os.PathSeparator)+appBundleName)], nil
}

// validateMacStage checks the minimum install shape before any existing app is
// renamed. Archive extraction itself remains the responsibility of the main
// executor update staging step.
func validateMacStage(stage string) error {
	app := filepath.Join(filepath.Clean(stage), appBundleName)
	info, err := os.Stat(app)
	if err != nil || !info.IsDir() {
		return errors.New("staged GiantMaterialExecutor.app is missing")
	}
	binary := filepath.Join(app, "Contents", "MacOS", macMainBinary)
	info, err = os.Stat(binary)
	if err != nil || info.IsDir() || info.Mode()&0o111 == 0 {
		return errors.New("staged GiantMaterialExecutor.app main binary is missing or not executable")
	}
	return nil
}

func main() {
	// The platform-specific process handoff is deliberately invoked by the
	// executor only after it has verified a signed archive and stopped its OCR
	// worker. Keeping this command inert without validated arguments avoids an
	// accidentally executable destructive helper while the handoff contract is
	// wired in the next implementation step.
	if len(os.Args) > 1 {
		fmt.Fprintln(os.Stderr, "GiantMaterialExecutorUpdater must be started by the executor")
		os.Exit(2)
	}
}
