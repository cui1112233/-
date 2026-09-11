package mergeworker

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultMaxFileBytes  int64 = 512 << 20
	defaultMaxTotalBytes int64 = 4 << 30
)

type Downloader struct {
	Client        *http.Client
	MaxFileBytes  int64
	MaxTotalBytes int64
	ValidateURL   func(string) error
}

func ValidatePublicHTTPSURL(raw string) error {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return fmt.Errorf("source must be an https URL")
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("source host is not public")
	}
	if ip := net.ParseIP(host); ip != nil && !isPublicIP(ip) {
		return fmt.Errorf("source host is not public")
	}
	return nil
}

func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	_, cgnat, _ := net.ParseCIDR("100.64.0.0/10")
	return cgnat == nil || !cgnat.Contains(ip)
}

func newSafeHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, address := range addresses {
				if !isPublicIP(address.IP) {
					continue
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
			}
			return nil, fmt.Errorf("source host did not resolve to a public address")
		},
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		IdleConnTimeout:       30 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   2 * time.Minute,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return ValidatePublicHTTPSURL(req.URL.String())
		},
	}
}

func (d *Downloader) Download(ctx context.Context, sources []Source, dir string) ([]string, error) {
	if len(sources) == 0 {
		return nil, fmt.Errorf("no merge sources")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	maxFile := d.MaxFileBytes
	if maxFile <= 0 {
		maxFile = defaultMaxFileBytes
	}
	maxTotal := d.MaxTotalBytes
	if maxTotal <= 0 {
		maxTotal = defaultMaxTotalBytes
	}
	client := d.Client
	if client == nil {
		client = newSafeHTTPClient()
	}
	validate := d.ValidateURL
	if validate == nil {
		validate = ValidatePublicHTTPSURL
	}

	paths := make([]string, 0, len(sources))
	var total int64
	for index, source := range sources {
		if source.Order != index {
			return nil, fmt.Errorf("source order must be contiguous")
		}
		if err := validate(source.MediaURL); err != nil {
			return nil, fmt.Errorf("source %d URL: %w", index, err)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.MediaURL, nil)
		if err != nil {
			return nil, err
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("download source %d: %w", index, err)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			return nil, fmt.Errorf("download source %d returned HTTP %d", index, response.StatusCode)
		}
		if response.ContentLength > maxFile && response.ContentLength >= 0 {
			response.Body.Close()
			return nil, fmt.Errorf("source %d exceeds size limit", index)
		}

		path := filepath.Join(dir, fmt.Sprintf("%04d.mp4", index))
		file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			response.Body.Close()
			return nil, err
		}
		written, copyErr := io.Copy(file, io.LimitReader(response.Body, maxFile+1))
		closeErr := file.Close()
		response.Body.Close()
		if copyErr != nil {
			_ = os.Remove(path)
			return nil, fmt.Errorf("download source %d: %w", index, copyErr)
		}
		if closeErr != nil {
			_ = os.Remove(path)
			return nil, closeErr
		}
		if written > maxFile {
			_ = os.Remove(path)
			return nil, fmt.Errorf("source %d exceeds size limit", index)
		}
		total += written
		if total > maxTotal {
			_ = os.Remove(path)
			return nil, fmt.Errorf("merge sources exceed aggregate size limit")
		}
		paths = append(paths, path)
	}
	return paths, nil
}
