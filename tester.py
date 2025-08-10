import asyncio
import socket
import re
from utils import is_alive, geoip_lookup, get_network_stats
from converter import extract_ip_port_from_path
import ssl
import http.client

def _normalize_domain(value: str) -> str:
    return (value or "").strip().lower()

def _is_ip(value: str) -> bool:
    try:
        socket.inet_aton(value)
        return True
    except Exception:
        return False

def _clean_domain_from_server(domain: str, server: str) -> str:
    """Remove server part from domain if it appears as prefix or suffix, per user rule."""
    if not domain or not server:
        return domain
    if domain == server:
        return domain
    if domain.startswith(server + "."):
        cleaned = domain[len(server) + 1 :]
        return cleaned or domain
    if domain.endswith("." + server):
        cleaned = domain[: -len("." + server)]
        return cleaned or domain
    return domain

def _pick_domain_candidates(account: dict) -> list[tuple[str, str]]:
    """
    Build ordered domain candidates per rules:
    - If IP-PORT exists in path, that is handled separately (not here)
    - From host/sni/server: filter the odd-one-out; clean host/sni if they contain server as prefix/suffix
    - Only include server if host == server == sni

    Returns list of tuples (domain_for_connect, sni_for_tls)
    """
    # Extract raw values
    server = _normalize_domain(account.get("server"))
    sni = None
    tls_cfg = account.get("tls", {}) if isinstance(account.get("tls"), dict) else {}
    if tls_cfg:
        sni = _normalize_domain(tls_cfg.get("sni") or tls_cfg.get("server_name"))
    host = None
    transport = account.get("transport", {}) if isinstance(account.get("transport"), dict) else {}
    if transport:
        headers = transport.get("headers", {}) if isinstance(transport.get("headers"), dict) else {}
        host = _normalize_domain(headers.get("Host"))

    values = [v for v in [host, sni, server] if v]
    if not values:
        return []

    # If all three are the same (or two same and only those two exist), test that domain (server allowed when all equal)
    uniq = {}
    for v in values:
        uniq[v] = uniq.get(v, 0) + 1
    # Case: two same and one different -> pick the common value and drop the outlier
    if len(uniq) == 2:
        # Find the common one (count 2)
        common = next((k for k, c in uniq.items() if c >= 2), None)
        if common:
            return [(common, common)]
    # Case: all the same (len==1)
    if len(uniq) == 1:
        only = next(iter(uniq.keys()))
        return [(only, only)]

    # Case: all different. If server is contained in host AND sni (as prefix/suffix), clean both and test both
    candidates: list[tuple[str, str]] = []
    if server and host and sni:
        def contains_carrier(d: str, carrier: str) -> bool:
            return d.startswith(carrier + ".") or d.endswith("." + carrier)
        if contains_carrier(host, server) and contains_carrier(sni, server):
            cleaned_host = _clean_domain_from_server(host, server)
            cleaned_sni = _clean_domain_from_server(sni, server)
            # Dedup
            uniq_domains = []
            for d in [cleaned_host, cleaned_sni]:
                if d and d not in uniq_domains:
                    uniq_domains.append(d)
            for d in uniq_domains:
                candidates.append((d, d))
            return candidates

    # Otherwise, no safe domain fallback
    return []

MAX_RETRIES = 3
RETRY_DELAY = 1.5  # detik

def get_first_nonempty(*args):
    for x in args:
        if x:
            return x
    return None

def get_test_targets(account):
    """
    Return ordered list of candidate targets to test: [(ip, port, source_label, sni_for_tls)]
    """
    targets = []
    # 1) IP:PORT from path
    path_str = account.get("_ss_path") or account.get("_ws_path") or ""
    ip_from_path, port_from_path = extract_ip_port_from_path(path_str)
    if ip_from_path:
        targets.append((ip_from_path, int(port_from_path or 443), "path", None))

    # 2) Domain candidates per user rules
    domain_candidates = _pick_domain_candidates(account)
    port = int(account.get("server_port", 443) or 443)
    for domain, sni in domain_candidates:
        try:
            if _is_ip(domain):
                targets.append((domain, port, "domain", sni))
            else:
                resolved_ip = socket.gethostbyname(domain)
                targets.append((resolved_ip, port, "domain", sni or domain))
        except Exception:
            continue
    return targets

async def test_account(account: dict, semaphore: asyncio.Semaphore, index: int, live_results=None) -> dict:
    tag = account.get('tag', 'proxy')
    vpn_type = account.get('type', 'N/A')
    print(f"🔍 DEBUG: test_account called for account {index}: {vpn_type} - {tag}")
    
    result = {
        "index": index, "VpnType": vpn_type, "OriginalTag": tag, "Latency": -1, "Jitter": -1, "ICMP": "N/A",
        "Country": "❓", "Provider": "-", "Tested IP": "-", "Status": "WAIT",
        "OriginalAccount": account, "TestType": "N/A", "Retry": 0, "TimeoutCount": 0
    }

    async with semaphore:
        # === LOGIKA BARU ===
        targets = get_test_targets(account)
        if not targets:
            result['Status'] = '❌'
            return result

        # USER REQUEST: Retry timeout 3x per target, then try next target; if all fail, mark dead
        timeout_retries = 3
        for (test_ip, test_port, source_label, sni_for_tls) in targets:
            result['TimeoutCount'] = 0
            for attempt in range(MAX_RETRIES):
                if result['TimeoutCount'] > 0:
                    result['Status'] = f'Timeout Retry {result["TimeoutCount"]}/3'
                else:
                    result['Status'] = '🔄'
                result['Retry'] = attempt
                if live_results is not None:
                    live_results[index].update(result)
                    await asyncio.sleep(0.05)

                is_conn, latency = is_alive(test_ip, test_port, timeout=5)
                if is_conn:
                    # Optional TLS check if TLS enabled
                    tls_cfg = account.get('tls', {}) if isinstance(account.get('tls'), dict) else {}
                    tls_enabled = bool(tls_cfg.get('enabled'))
                    tls_ok = True
                    if tls_enabled and sni_for_tls:
                        try:
                            context = ssl.create_default_context()
                            with socket.create_connection((test_ip, test_port), timeout=5) as raw_sock:
                                with context.wrap_socket(raw_sock, server_hostname=sni_for_tls) as tls_sock:
                                    # Handshake happens on wrap
                                    tls_ok = True
                        except Exception:
                            tls_ok = False
                    if tls_enabled and not tls_ok:
                        # Mark as TLSFail and try next target
                        print(f"TLSFail for {sni_for_tls}@{test_ip}:{test_port}")
                        # try next domain target
                        break

                    # WS probe if needed
                    ws_ok = True
                    transport = account.get('transport', {}) if isinstance(account.get('transport'), dict) else {}
                    is_ws = (transport.get('type') == 'ws')
                    if is_ws:
                        try:
                            host_header = None
                            headers = transport.get('headers', {}) if isinstance(transport.get('headers'), dict) else {}
                            host_header = headers.get('Host') or sni_for_tls
                            # Build HTTP Upgrade request
                            conn = http.client.HTTPSConnection(test_ip, test_port, timeout=5, context=ssl.create_default_context()) if tls_enabled else http.client.HTTPConnection(test_ip, test_port, timeout=5)
                            path = transport.get('path') or '/'
                            conn.putrequest('GET', path)
                            if host_header:
                                conn.putheader('Host', host_header)
                            conn.putheader('Upgrade', 'websocket')
                            conn.putheader('Connection', 'Upgrade')
                            conn.putheader('Sec-WebSocket-Key', 'dGhlIHNhbXBsZSBub25jZQ==')
                            conn.putheader('Sec-WebSocket-Version', '13')
                            conn.endheaders()
                            resp = conn.getresponse()
                            ws_ok = (resp.status == 101)
                        except Exception:
                            ws_ok = False
                        finally:
                            try:
                                conn.close()
                            except Exception:
                                pass
                    if is_ws and not ws_ok:
                        print(f"WSFail for {sni_for_tls or host_header}@{test_ip}:{test_port}")
                        break

                    geo_info = geoip_lookup(test_ip)
                    result.update({
                        "Status": "✅",
                        "TestType": f"{source_label.upper()} {'WS' if is_ws else 'TCP'}",
                        "Tested IP": test_ip,
                        "Latency": latency,
                        "Jitter": 0,
                        "ICMP": "✔",
                        **geo_info
                    })
                    try:
                        from real_geolocation_tester import get_real_geolocation
                        real_geo = get_real_geolocation(account)
                        if real_geo:
                            result.update(real_geo)
                    except ImportError:
                        pass
                    if live_results is not None:
                        live_results[index].update(result)
                    return result
                else:
                    result['TimeoutCount'] += 1
                if result['TimeoutCount'] >= timeout_retries:
                    break
                # small delay before retry
                if attempt < MAX_RETRIES - 1:
                    result['Status'] = '🔁'
                    if live_results is not None:
                        live_results[index].update(result)
                        await asyncio.sleep(0)
                    await asyncio.sleep(RETRY_DELAY)

        # Fallback ping jika TCP gagal untuk semua target
        # Pilih IP pertama dari targets untuk ping fallback
        fallback_ip = targets[0][0]
        for attempt in range(MAX_RETRIES):
            result['Status'] = '🔄'
            result['Retry'] = attempt
            if live_results is not None:
                live_results[index].update(result)
                await asyncio.sleep(0)

            stats = get_network_stats(fallback_ip)
            if stats.get("Latency") != -1:
                geo_info = geoip_lookup(fallback_ip)
                result.update({
                    "Status": "✅",
                    "TestType": f"{targets[0][2].upper()} Ping",
                    "Tested IP": fallback_ip,
                    **stats,
                    **geo_info
                })
                try:
                    from real_geolocation_tester import get_real_geolocation
                    real_geo = get_real_geolocation(account)
                    if real_geo:
                        result.update(real_geo)
                except ImportError:
                    pass
                if live_results is not None:
                    live_results[index].update(result)
                return result

            if attempt < MAX_RETRIES - 1:
                result['Status'] = '🔁'
                result['Retry'] = attempt + 1
                if live_results is not None:
                    live_results[index].update(result)
                    await asyncio.sleep(0)
                await asyncio.sleep(RETRY_DELAY)

        # Semua cara sudah dicoba, masih gagal
        result['Status'] = '❌'
        result['Retry'] = MAX_RETRIES
    # Update live_results for failed case
    if live_results is not None:
        live_results[index].update(result)
    return result