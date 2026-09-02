package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr   string
	MySQLDSN     string
	BridgeSecret string
	Slice        int
	DirectorEndpoint string
	DirectorAPIKey   string
	DirectorModel    string
	VideoEndpoint    string
	VideoPollEndpoint string
	VideoAPIKey      string
	VideoModel       string
	ProductionEnabled bool
}

func FromEnv() (Config, error) {
	cfg := Config{ListenAddr: envOr("QIANTIE_GO_LISTEN_ADDR", ":4000"), MySQLDSN: strings.TrimSpace(os.Getenv("QIANTIE_MYSQL_DSN")), BridgeSecret: strings.TrimSpace(os.Getenv("QIANTIE_BRIDGE_SECRET")), DirectorEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_ENDPOINT")), DirectorAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_API_KEY")), DirectorModel: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_MODEL")), VideoEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_ENDPOINT")), VideoPollEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_POLL_ENDPOINT")), VideoAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_API_KEY")), VideoModel: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_MODEL")), ProductionEnabled: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED")) == "1"}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.BridgeSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_BRIDGE_SECRET is required")
	}
	rawSlice := envOr("QIANTIE_BATCH_FACTORY_V11_SLICE", "0")
	slice, err := strconv.Atoi(rawSlice)
	if err != nil || slice < 0 || slice > 4 {
		return Config{}, fmt.Errorf("invalid QIANTIE_BATCH_FACTORY_V11_SLICE")
	}
	cfg.Slice = slice
	if cfg.Slice >= 2 && (cfg.DirectorEndpoint == "" || cfg.DirectorAPIKey == "" || cfg.DirectorModel == "") {
		return Config{}, fmt.Errorf("Slice 2+ requires the V11 text provider endpoint, API key, and model")
	}
	if cfg.Slice >= 4 && (!cfg.ProductionEnabled || cfg.VideoEndpoint == "" || cfg.VideoPollEndpoint == "" || cfg.VideoAPIKey == "" || cfg.VideoModel == "") {
		return Config{}, fmt.Errorf("Slice 4 requires explicit video provider configuration and QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED=1")
	}
	return cfg, nil
}
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
