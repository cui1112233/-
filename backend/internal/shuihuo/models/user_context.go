package models

import "context"

type userIDContextKey struct{}

// WithUserID carries the authenticated task owner to account-scoped model
// adapters. The value is injected by the worker/poller and never comes from a
// browser supplied model request.
func WithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userIDContextKey{}, userID)
}

func UserIDFromContext(ctx context.Context) (int64, bool) {
	value, ok := ctx.Value(userIDContextKey{}).(int64)
	return value, ok && value > 0
}
