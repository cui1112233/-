// Command tos-migrate copies existing Shuihuo object files to the configured
// private TOS bucket without deleting the source files.
package main

import (
	"context"
	"flag"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"

	shuihuostorage "qiantie/backend/internal/shuihuo/storage"
)

func main() {
	sourceDir := flag.String("source-dir", "../data/shuihuo-objects", "local object directory")
	dryRun := flag.Bool("dry-run", false, "list valid objects without uploading")
	flag.Parse()

	store, err := newStore()
	if err != nil && !*dryRun {
		fatal(err)
	}

	var copied, skipped int
	err = filepath.WalkDir(*sourceDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(*sourceDir, path)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(relative)
		if !shuihuostorage.ValidObjectKey(key) {
			skipped++
			return nil
		}
		if *dryRun {
			fmt.Println(key)
			copied++
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		contentType := mime.TypeByExtension(filepath.Ext(path))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		_, putErr := store.Put(context.Background(), key, file, contentType)
		closeErr := file.Close()
		if putErr != nil {
			return fmt.Errorf("upload %s: %w", key, putErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close %s: %w", key, closeErr)
		}
		copied++
		return nil
	})
	if err != nil {
		fatal(err)
	}
	fmt.Printf("copied=%d skipped=%d source=%s\n", copied, skipped, *sourceDir)
}

func newStore() (shuihuostorage.ObjectStorage, error) {
	return shuihuostorage.NewTOS(shuihuostorage.TOSConfig{
		Bucket:    requiredEnv("QIANTIE_STORAGE_BUCKET"),
		Endpoint:  requiredEnv("QIANTIE_STORAGE_ENDPOINT"),
		Region:    requiredEnv("QIANTIE_STORAGE_REGION"),
		AccessKey: requiredEnv("QIANTIE_STORAGE_ACCESS_KEY"),
		SecretKey: requiredEnv("QIANTIE_STORAGE_SECRET_KEY"),
	})
}

func requiredEnv(key string) string {
	return strings.TrimSpace(os.Getenv(key))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
