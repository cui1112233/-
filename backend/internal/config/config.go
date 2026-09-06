package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr                     string
	MySQLDSN                       string
	BridgeSecret                   string
	Slice                          int
	DirectorEndpoint               string
	DirectorAPIKey                 string
	DirectorModel                  string
	VideoEndpoint                  string
	VideoPollEndpoint              string
	VideoAPIKey                    string
	VideoModel                     string
	ProductionEnabled              bool
	MergeEndpoint                  string
	MergePollEndpoint              string
	MergeAPIKey                    string
	MergeEnabled                   bool
	ExternalCredentialsKey         []byte
	External121Enabled             bool
	External121VideoUploadVerified bool
	External121Endpoint            string
	External121APIKey              string
	ExternalYadiEnabled            bool
	ExternalYadiEndpoint           string
	ExternalYadiAPIKey             string
	LocalExecutorArtifactDir       string
	LocalExecutorArtifactMaxBytes  int64
	LocalExecutorPublicBaseURL     string
}

func FromEnv() (Config, error) {
	cfg := Config{ListenAddr: envOr("QIANTIE_GO_LISTEN_ADDR", ":4000"), MySQLDSN: strings.TrimSpace(os.Getenv("QIANTIE_MYSQL_DSN")), BridgeSecret: strings.TrimSpace(os.Getenv("QIANTIE_BRIDGE_SECRET")), DirectorEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_ENDPOINT")), DirectorAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_API_KEY")), DirectorModel: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_TEXT_MODEL")), VideoEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_ENDPOINT")), VideoPollEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_POLL_ENDPOINT")), VideoAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_API_KEY")), VideoModel: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_VIDEO_MODEL")), ProductionEnabled: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED")) == "1", MergeEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_MERGE_ENDPOINT")), MergePollEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_MERGE_POLL_ENDPOINT")), MergeAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_MERGE_API_KEY")), MergeEnabled: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_MERGE_ENABLED")) == "1", External121Enabled: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_121_ENABLED")) == "1", External121VideoUploadVerified: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_121_VIDEO_UPLOAD_VERIFIED")) == "1", External121Endpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_121_ENDPOINT")), External121APIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_121_API_KEY")), ExternalYadiEnabled: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_YADI_ENABLED")) == "1", ExternalYadiEndpoint: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_YADI_ENDPOINT")), ExternalYadiAPIKey: strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_YADI_API_KEY")), LocalExecutorArtifactDir: envOr("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_DIR", "data/local-executor-artifacts"), LocalExecutorPublicBaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("QIANTIE_LOCAL_EXECUTOR_PUBLIC_BASE_URL")), "/")}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.BridgeSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_BRIDGE_SECRET is required")
	}
	rawSlice := envOr("QIANTIE_BATCH_FACTORY_V11_SLICE", "0")
	slice, err := strconv.Atoi(rawSlice)
	if err != nil || slice < 0 || slice > 6 {
		return Config{}, fmt.Errorf("invalid QIANTIE_BATCH_FACTORY_V11_SLICE")
	}
	cfg.Slice = slice
	rawArtifactMax := envOr("QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES", "1073741824")
	artifactMax, err := strconv.ParseInt(rawArtifactMax, 10, 64)
	if err != nil || artifactMax <= 0 {
		return Config{}, fmt.Errorf("invalid QIANTIE_LOCAL_EXECUTOR_ARTIFACT_MAX_BYTES")
	}
	cfg.LocalExecutorArtifactMaxBytes = artifactMax
	if cfg.Slice >= 2 && (cfg.DirectorEndpoint == "" || cfg.DirectorAPIKey == "" || cfg.DirectorModel == "") {
		return Config{}, fmt.Errorf("Slice 2+ requires the V11 text provider endpoint, API key, and model")
	}
	if cfg.Slice >= 4 && !cfg.ProductionEnabled {
		return Config{}, fmt.Errorf("Slice 4 requires QIANTIE_BATCH_FACTORY_V11_PRODUCTION_ENABLED=1")
	}
	if cfg.Slice >= 5 && (!cfg.MergeEnabled || cfg.MergeEndpoint == "" || cfg.MergeAPIKey == "") {
		return Config{}, fmt.Errorf("Slice 5 requires explicit merge provider configuration and QIANTIE_BATCH_FACTORY_V11_MERGE_ENABLED=1")
	}
	if cfg.Slice >= 6 {
		if cfg.External121Enabled && (cfg.External121Endpoint == "" || cfg.External121APIKey == "") {
			return Config{}, fmt.Errorf("Slice 6 121 requires explicit endpoint and API key")
		}
		if cfg.ExternalYadiEnabled && (cfg.ExternalYadiEndpoint == "" || cfg.ExternalYadiAPIKey == "") {
			return Config{}, fmt.Errorf("Slice 6 Yadi requires explicit endpoint and API key")
		}
		if cfg.External121Enabled || cfg.ExternalYadiEnabled {
			rawKey := strings.TrimSpace(os.Getenv("QIANTIE_BATCH_FACTORY_V11_CREDENTIALS_KEY"))
			decoded, decodeErr := decodeCredentialKey(rawKey)
			if decodeErr != nil {
				return Config{}, decodeErr
			}
			cfg.ExternalCredentialsKey = decoded
		}
	}
	return cfg, nil
}

func decodeCredentialKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, fmt.Errorf("Slice 6 external publish requires QIANTIE_BATCH_FACTORY_V11_CREDENTIALS_KEY")
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if len(raw) == 32 {
		return []byte(raw), nil
	}
	return nil, fmt.Errorf("QIANTIE_BATCH_FACTORY_V11_CREDENTIALS_KEY must decode to 32 bytes")
}
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
