//go:build !windows

package ui

import "context"

func Run(_ context.Context, config Config) error {
	return validateConfig(config)
}
