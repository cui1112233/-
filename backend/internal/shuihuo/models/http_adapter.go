package models

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

var ErrPrivateNetworkTarget = errors.New("private network target is not allowed")

type IPResolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

func ValidateOutboundURL(raw string) (*url.URL, error) {
	return ValidateOutboundURLWithResolver(context.Background(), raw, net.DefaultResolver)
}

func ValidateOutboundURLWithResolver(ctx context.Context, raw string, resolver IPResolver) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil, fmt.Errorf("invalid outbound URL")
	}
	if strings.ToLower(u.Scheme) != "https" {
		return nil, fmt.Errorf("outbound URL must use https")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "localhost" || host == "metadata.google.internal" {
		return nil, ErrPrivateNetworkTarget
	}
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateIP(ip) {
			return nil, ErrPrivateNetworkTarget
		}
		return u, nil
	}
	if resolver == nil {
		return nil, fmt.Errorf("outbound URL resolver is required")
	}
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, fmt.Errorf("resolve outbound URL host: %w", err)
	}
	for _, address := range addresses {
		if isPrivateIP(address.IP) {
			return nil, ErrPrivateNetworkTarget
		}
	}
	return u, nil
}

func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
