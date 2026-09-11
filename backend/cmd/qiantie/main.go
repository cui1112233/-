package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"qiantie/backend/internal/app"
	"qiantie/backend/internal/config"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatal(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := runHealthcheck(healthURL(cfg.ListenAddr)); err != nil {
			log.Fatal(err)
		}
		return
	}
	db, err := sql.Open("mysql", cfg.MySQLDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	handler, err := app.Build(ctx, cfg, db, nil)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: cfg.ListenAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("qiantie Go V11 listening on %s", cfg.ListenAddr)
	log.Fatal(server.ListenAndServe())
}

func healthURL(listenAddr string) string {
	addr := strings.TrimSpace(listenAddr)
	switch {
	case strings.HasPrefix(addr, ":"):
		addr = "127.0.0.1" + addr
	case strings.HasPrefix(addr, "0.0.0.0:"):
		addr = "127.0.0.1" + strings.TrimPrefix(addr, "0.0.0.0")
	case strings.HasPrefix(addr, "[::]:"):
		addr = "127.0.0.1:" + strings.TrimPrefix(addr, "[::]:")
	}
	return "http://" + addr + "/health"
}

func runHealthcheck(url string) error {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health endpoint returned %s", resp.Status)
	}
	return nil
}
