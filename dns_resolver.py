import os
import socket
import json
import urllib.request

DNS_MODE = os.getenv('DNS_MODE', 'system').lower()  # system | doh
DOH_PROVIDER = os.getenv('DOH_PROVIDER', 'cloudflare').lower()  # cloudflare | google

CLOUDFLARE_DOH = 'https://cloudflare-dns.com/dns-query?name={host}&type=A'
GOOGLE_DOH = 'https://dns.google/resolve?name={host}&type=A'

def _doh_url(host: str) -> str:
    if DOH_PROVIDER == 'google':
        return GOOGLE_DOH.format(host=host)
    return CLOUDFLARE_DOH.format(host=host)

def _resolve_doh(host: str, timeout: float = 3.0) -> str | None:
    try:
        url = _doh_url(host)
        req = urllib.request.Request(url, headers={'accept': 'application/dns-json'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            # Cloudflare: Answer list; Google: Answer list
            answers = data.get('Answer') or []
            for ans in answers:
                ip = ans.get('data')
                if ip:
                    try:
                        socket.inet_aton(ip)
                        return ip
                    except Exception:
                        continue
    except Exception:
        return None
    return None

def resolve_domain(host: str) -> str | None:
    if not host:
        return None
    # If host already IP
    try:
        socket.inet_aton(host)
        return host
    except Exception:
        pass
    if DNS_MODE == 'doh':
        ip = _resolve_doh(host)
        if ip:
            return ip
    # Fallback system
    try:
        return socket.gethostbyname(host)
    except Exception:
        return None