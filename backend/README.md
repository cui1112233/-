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

## Import Legacy Data

```bash
cd backend
export QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local'
go run ./cmd/qiantie migrate-legacy
```
