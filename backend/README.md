# Go Backend

This backend is the first phase of the Go + React + MySQL refactor.

## Local MySQL

Create a database and user:

```sql
CREATE DATABASE qiantie CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'qiantie'@'localhost' IDENTIFIED BY 'qiantie';
GRANT ALL PRIVILEGES ON qiantie.* TO 'qiantie'@'localhost';
FLUSH PRIVILEGES;
```

## Run

```bash
cd backend
export QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local'
go run ./cmd/qiantie
```

Health check:

```bash
curl -s http://127.0.0.1:4000/healthz
```

Expected:

```json
{"ok":true}
```

## Shuihuo Production Runtime

The production module is served by this Go process and is reached through the
platform gateway at `/api/shuihuo-production/*`. Start only with server-side
variables; do not put provider credentials in browser code or model records.

```bash
brew services start redis
export QIANTIE_REDIS_ADDR='127.0.0.1:6379'
export QIANTIE_MODEL_CREDENTIALS='TEXT_CREDENTIAL=REDACTED,VIDU_CREDENTIAL=REDACTED'
export VOLCENGINE_ACCESS_KEY_ID='REDACTED'
export VOLCENGINE_SECRET_ACCESS_KEY='REDACTED'
cd /Users/ming/Downloads/qiantie/backend
go run ./cmd/qiantie
```

Check the process separately from the signed platform route:

```bash
curl -s http://127.0.0.1:4000/healthz
```

See `../docs/shuihuo-production-operations.md` for readiness requirements,
the live acceptance record, and the approved second-phase boundary.

## Import Legacy Data

```bash
cd backend
export QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local'
go run ./cmd/qiantie migrate-legacy
```
