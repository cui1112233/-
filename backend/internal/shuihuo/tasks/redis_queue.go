package tasks

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

const DefaultQueueKey = "shuihuo:tasks"

type Queue interface {
	Enqueue(context.Context, int64) error
	Dequeue(context.Context, time.Duration) (int64, error)
}

type RedisQueue struct {
	Address string
	Key     string
	Timeout time.Duration
}

func NewRedisQueue(address string) *RedisQueue {
	return &RedisQueue{Address: address, Key: DefaultQueueKey, Timeout: 5 * time.Second}
}

func (q *RedisQueue) Enqueue(ctx context.Context, taskID int64) error {
	if taskID < 1 {
		return fmt.Errorf("invalid task id")
	}
	_, err := q.command(ctx, "LPUSH", q.queueKey(), strconv.FormatInt(taskID, 10))
	return err
}

func (q *RedisQueue) Dequeue(ctx context.Context, wait time.Duration) (int64, error) {
	seconds := int(wait.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	response, err := q.command(ctx, "BRPOP", q.queueKey(), strconv.Itoa(seconds))
	if err != nil {
		return 0, err
	}
	if response == "" {
		return 0, context.DeadlineExceeded
	}
	parts := strings.Split(response, "\n")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid Redis queue response")
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || id < 1 {
		return 0, fmt.Errorf("invalid Redis task id")
	}
	return id, nil
}

func (q *RedisQueue) command(ctx context.Context, command string, args ...string) (string, error) {
	address := strings.TrimSpace(q.Address)
	if address == "" {
		return "", fmt.Errorf("Redis queue is not configured")
	}
	dialer := net.Dialer{Timeout: q.timeout()}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return "", fmt.Errorf("connect Redis: %w", err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(q.timeout()))
	}
	if _, err := conn.Write(encodeCommand(command, args...)); err != nil {
		return "", fmt.Errorf("write Redis: %w", err)
	}
	return readRESP(bufio.NewReader(conn))
}

func (q *RedisQueue) queueKey() string {
	if q.Key != "" {
		return q.Key
	}
	return DefaultQueueKey
}
func (q *RedisQueue) timeout() time.Duration {
	if q.Timeout > 0 {
		return q.Timeout
	}
	return 5 * time.Second
}

func encodeCommand(command string, args ...string) []byte {
	parts := append([]string{command}, args...)
	var builder strings.Builder
	fmt.Fprintf(&builder, "*%d\r\n", len(parts))
	for _, part := range parts {
		fmt.Fprintf(&builder, "$%d\r\n%s\r\n", len(part), part)
	}
	return []byte(builder.String())
}

func readRESP(reader *bufio.Reader) (string, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return "", err
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	line = strings.TrimSuffix(line, "\r\n")
	switch prefix {
	case '+', ':':
		return line, nil
	case '-':
		return "", fmt.Errorf("Redis: %s", line)
	case '$':
		length, err := strconv.Atoi(line)
		if err != nil {
			return "", err
		}
		if length == -1 {
			return "", nil
		}
		body := make([]byte, length+2)
		if _, err := reader.Read(body); err != nil {
			return "", err
		}
		return string(body[:length]), nil
	case '*':
		count, err := strconv.Atoi(line)
		if err != nil {
			return "", err
		}
		if count == -1 {
			return "", nil
		}
		parts := make([]string, 0, count)
		for index := 0; index < count; index++ {
			value, err := readRESP(reader)
			if err != nil {
				return "", err
			}
			parts = append(parts, value)
		}
		return strings.Join(parts, "\n"), nil
	default:
		return "", fmt.Errorf("unsupported Redis response")
	}
}
