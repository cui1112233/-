package httpapi

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
	shuihuostore "qiantie/backend/internal/shuihuo/store"
)

const shuihuoObjectCleanupBatchSize = 100
const shuihuoObjectCleanupLeaseDuration = 10 * time.Minute
const shuihuoObjectCleanupDeleteTimeout = 5 * time.Minute

var errShuihuoObjectCleanupLeaseLost = errors.New("object cleanup lease lost")

type shuihuoObjectCleanupRunResult struct {
	Processed int
	Deleted   int
	Failed    int
}

func (api *API) handleListShuihuoObjectCleanups(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	items, err := shuihuostore.NewObjectCleanups(api.deps.DB).List(r.Context(), shuihuoObjectCleanupBatchSize)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取待清理文件失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleRunShuihuoObjectCleanups is an explicit admin maintenance action. It
// is intentionally not a background worker: deployment owners decide when
// object storage cleanup is permitted to run.
func (api *API) handleRunShuihuoObjectCleanups(w http.ResponseWriter, r *http.Request) {
	if !api.requireShuihuoDatabase(w) {
		return
	}
	if api.deps.Objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "对象存储未配置"})
		return
	}
	importDeleted, importFailed := api.runShuihuoImportCompensations(r)
	cleanups := shuihuostore.NewObjectCleanups(api.deps.DB)
	token, err := newShuihuoCleanupLeaseToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建清理租约失败"})
		return
	}
	result, err := runShuihuoObjectCleanupBatch(
		r.Context(),
		cleanups,
		api.deps.Objects,
		shuihuoObjectCleanupBatchSize,
		token,
		time.Now(),
		shuihuoObjectCleanupLeaseDuration,
		shuihuoObjectCleanupDeleteTimeout,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取待清理文件失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"processed": result.Processed, "deleted": result.Deleted, "failed": result.Failed, "importDeleted": importDeleted, "importFailed": importFailed})
}

func runShuihuoObjectCleanupBatch(
	ctx context.Context,
	cleanups *shuihuostore.ObjectCleanups,
	objects shuihuostorage.ObjectStorage,
	limit int,
	token string,
	now time.Time,
	lease time.Duration,
	deleteTimeout time.Duration,
) (shuihuoObjectCleanupRunResult, error) {
	if deleteTimeout <= 0 || deleteTimeout >= lease {
		return shuihuoObjectCleanupRunResult{}, fmt.Errorf("object cleanup delete timeout must be shorter than its lease")
	}
	items, err := cleanups.Claim(ctx, limit, token, now, lease)
	if err != nil {
		return shuihuoObjectCleanupRunResult{}, err
	}
	result := shuihuoObjectCleanupRunResult{Processed: len(items)}
	for _, item := range items {
		renewed, err := cleanups.RenewClaim(ctx, item.ObjectKey, token, time.Now(), lease)
		if err != nil {
			return shuihuoObjectCleanupRunResult{}, fmt.Errorf("renew object cleanup lease: %w", err)
		}
		if !renewed {
			// A concurrent runner acquired this entry after the batch was read.
			// Do not start a duplicate storage delete.
			result.Failed++
			continue
		}
		deleteCtx, cancel := context.WithTimeout(ctx, deleteTimeout)
		deleteErr := objects.Delete(deleteCtx, item.ObjectKey)
		cancel()
		if deleteErr != nil {
			if _, recordErr := cleanups.RecordClaimFailure(ctx, item.ObjectKey, token, deleteErr); recordErr != nil {
				return shuihuoObjectCleanupRunResult{}, fmt.Errorf("record object cleanup failure: %w", recordErr)
			}
			result.Failed++
			continue
		}
		removed, err := cleanups.RemoveClaimed(ctx, item.ObjectKey, token)
		if err != nil {
			return shuihuoObjectCleanupRunResult{}, fmt.Errorf("complete object cleanup: %w", err)
		}
		if !removed {
			// A worker that no longer owns this token must never report a
			// successful deletion or remove a newer worker's recovery record.
			result.Failed++
			continue
		}
		result.Deleted++
	}
	return result, nil
}

func (api *API) runShuihuoImportCompensations(r *http.Request) (deleted, failed int) {
	imports := shuihuostore.NewImportCleanups(api.deps.DB)
	items, err := imports.List(r.Context(), shuihuoObjectCleanupBatchSize)
	if err != nil {
		return 0, 1
	}
	for _, item := range items {
		cleanupErr := error(nil)
		if item.ObjectKey != "" {
			cleanupErr = api.deleteShuihuoObjectWithDeferredCleanup(r.Context(), item.ObjectKey, item.Reason)
		}
		deleteErr := shuihuostore.NewProjects(api.deps.DB).Delete(r.Context(), item.UserID, item.ProjectID)
		if deleteErr != nil && !errors.Is(deleteErr, sql.ErrNoRows) {
			_ = imports.RecordAttemptFailure(r.Context(), item.ProjectID, deleteErr)
			failed++
			continue
		}
		if cleanupErr != nil {
			_ = imports.RecordAttemptFailure(r.Context(), item.ProjectID, cleanupErr)
			failed++
			continue
		}
		if err := imports.Remove(r.Context(), item.ProjectID); err != nil {
			failed++
			continue
		}
		deleted++
	}
	return deleted, failed
}

func newShuihuoCleanupLeaseToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
