-- Additive recovery of the exact schema embedded in public runtime 7df6290b.
-- Preserve existing rows and account-specific configuration; never seed defaults.
CREATE TABLE IF NOT EXISTS batch_factory_v11_shuihuo_configs (
  owner_username VARCHAR(191) NOT NULL PRIMARY KEY,
  config_json JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
