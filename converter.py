import base64
from urllib.parse import urlparse, parse_qs, unquote
import re
import socket

def is_alive(host, port=443):
    try:
        with socket.create_connection((host, int(port)), timeout=5):
            return True
    except Exception:
        return False

def extract_ip_port_from_path(path):
    m = re.search(r"/(\d+\.\d+\.\d+\.\d+)-(\d+)", path)
    if m:
        return m.group(1), int(m.group(2))
    return None, None

def get_host_to_test(server, ws_host):
    if ws_host:
        if ws_host.startswith(server + "."):
            return ws_host[len(server) + 1 :]
        return ws_host
    return server

def parse_ss(link):
    url = link.replace("ss://", "", 1)
    tag = ""
    if "#" in url:
        url, tag = url.split("#", 1)
        tag = unquote(tag)
    if "@" in url:
        base, rest = url.split("@", 1)
        base = unquote(base)
        try:
            decoded = base64.urlsafe_b64decode(base + "=" * (-len(base) % 4)).decode()
            method, password = decoded.split(":", 1)
        except Exception:
            method, password = base.split(":", 1)
        if "?" in rest:
            hostport, query = rest.split("?", 1)
        else:
            hostport, query = rest, ""
        if ":" in hostport:
            host, port = hostport.split(":", 1)
        else:
            host, port = hostport, ""
        query_params = parse_qs(query)
    else:
        if "?" in url:
            base, query = url.split("?", 1)
        else:
            base, query = url, ""
        base = unquote(base)
        try:
            decoded = base64.urlsafe_b64decode(base + "=" * (-len(base) % 4)).decode()
            if "@" in decoded:
                method_password, host_port = decoded.split("@", 1)
                method, password = method_password.split(":", 1)
                if ":" in host_port:
                    host, port = host_port.split(":", 1)
                else:
                    host, port = host_port, ""
            else:
                method, password = decoded.split(":", 1)
                host, port = "", ""
        except Exception:
            method = password = host = port = ""
        query_params = parse_qs(query)
        if not host and "server" in query_params:
            host = query_params["server"][0]
        if not port and "port" in query_params:
            port = query_params["port"][0]
    plugin = "v2ray-plugin"
    plugin_opts = []
    if query_params.get("type", [""])[0] == "ws":
        plugin_opts.append("mux=0")
    if "path" in query_params:
        plugin_opts.append(f"path={query_params['path'][0]}")
    if "host" in query_params:
        plugin_opts.append(f"host={query_params['host'][0]}")
    if "security" in query_params and query_params["security"][0] == "tls":
        plugin_opts.append("tls")
    if "sni" in query_params:
        plugin_opts.append(f"sni={query_params['sni'][0]}")
    if "encryption" in query_params:
        plugin_opts.append(f"encryption={query_params['encryption'][0]}")

    outbound = {
        "type": "shadowsocks",
        "tag": tag or host or "ss",
        "server": host,
        "server_port": int(port) if port else 443,
        "method": method,
        "password": password,
    }
    if plugin_opts:
        outbound["plugin"] = plugin
        outbound["plugin_opts"] = ";".join(plugin_opts)
    outbound["_ss_ws_host"] = query_params["host"][0] if "host" in query_params else ""
    outbound["_ss_path"] = query_params["path"][0] if "path" in query_params else ""
    return outbound

def parse_vless(link):
    url = urlparse(link)
    params = parse_qs(url.query)
    net = params.get("type", ["ws"])[0]
    outbound = {
        "type": "vless",
        "tag": unquote(url.fragment) if url.fragment else url.hostname,
        "server": url.hostname,
        "server_port": int(url.port or 443),
        "uuid": url.username,
        "tls": {
            "enabled": params.get("security", ["tls"])[0] == "tls",
            "server_name": params.get("sni", [url.hostname])[0],
            "insecure": params.get("allowInsecure", ["false"])[0] == "true",
        },
        "transport": {},
    }
    if net == "ws":
        outbound["transport"] = {
            "type": "ws",
            "path": params.get("path", [""])[0],
            "headers": {"Host": params.get("host", [url.hostname])[0]},
        }
        outbound["_ws_host"] = params.get("host", [""])[0]
        outbound["_ws_path"] = params.get("path", [""])[0]
    else:
        outbound["_ws_host"] = ""
        outbound["_ws_path"] = ""
    return outbound

def parse_trojan(link):
    url = urlparse(link)
    params = parse_qs(url.query)
    outbound = {
        "type": "trojan",
        "tag": unquote(url.fragment) if url.fragment else url.hostname,
        "server": url.hostname,
        "server_port": int(url.port or 443),
        "password": url.username,
        "tls": {
            "enabled": params.get("security", ["tls"])[0] == "tls",
            "server_name": params.get("sni", [url.hostname])[0],
            "insecure": params.get("allowInsecure", ["false"])[0] == "true",
        },
        "transport": {},
    }
    net = params.get("type", ["ws"])[0]
    if net == "ws":
        outbound["transport"] = {
            "type": "ws",
            "path": params.get("path", [""])[0],
            "headers": {"Host": params.get("host", [url.hostname])[0]},
        }
        outbound["_ws_host"] = params.get("host", [""])[0]
        outbound["_ws_path"] = params.get("path", [""])[0]
    else:
        outbound["_ws_host"] = ""
        outbound["_ws_path"] = ""
    return outbound

def parse_vmess(link):
    """Parse VMess link (base64 encoded JSON format)"""
    try:
        # Remove vmess:// prefix
        encoded_part = link.replace("vmess://", "", 1)
        
        # Decode base64
        import json
        decoded_json = base64.urlsafe_b64decode(encoded_part + "=" * (-len(encoded_part) % 4)).decode()
        config = json.loads(decoded_json)
        
        # Build outbound from VMess config
        outbound = {
            "type": "vmess",
            "tag": config.get("ps", config.get("add", "vmess-account")),  # ps = remarks
            "server": config.get("add", ""),  # add = address/server
            "server_port": int(config.get("port", 443)),
            "uuid": config.get("id", ""),  # id = uuid
            "security": config.get("scy", "auto"),  # scy = security
            "alter_id": int(config.get("aid", 0)),  # aid = alter_id
        }
        
        # Handle TLS
        tls_enabled = config.get("tls", "") == "tls"
        outbound["tls"] = {
            "enabled": tls_enabled,
            "server_name": config.get("sni", config.get("add", "")),
            "insecure": False
        }
        
        # Handle transport (network type)
        net = config.get("net", "tcp")  # tcp, ws, etc
        outbound["transport"] = {"type": net}
        
        if net == "ws":
            outbound["transport"] = {
                "type": "ws",
                "path": config.get("path", "/"),
                "headers": {"Host": config.get("host", config.get("add", ""))}
            }
            outbound["_ws_host"] = config.get("host", "")
            outbound["_ws_path"] = config.get("path", "/")
        else:
            outbound["_ws_host"] = ""
            outbound["_ws_path"] = ""
            
        return outbound
        
    except Exception as e:
        print(f"Error parsing VMess link: {e}")
        return None

def parse_link(link):
    if link.startswith("vless://"):
        return parse_vless(link)
    elif link.startswith("vmess://"):
        return parse_vmess(link)
    elif link.startswith("trojan://"):
        return parse_trojan(link)
    elif link.startswith("ss://"):
        return parse_ss(link)
    else:
        return None

def inject_outbounds_to_template(template_data: dict, new_outbounds: list) -> dict:
    if not new_outbounds:
        return template_data
    all_new_tags = [acc['tag'] for acc in new_outbounds]
    for tag in all_new_tags:
        print("TAG INJECTED:", tag)
    for outbound in template_data.get("outbounds", []):
        if outbound.get("tag") in ["Internet", "Best Latency", "Lock Region ID"]:
            outbound_list = outbound.get("outbounds", [])
            for tag in all_new_tags:
                if tag not in outbound_list:
                    outbound_list.append(tag)
    outbounds_list = template_data["outbounds"]
    insert_index = next((i for i, o in enumerate(outbounds_list) if o.get("tag") == "direct"), -1)
    if insert_index != -1:
        template_data["outbounds"] = outbounds_list[:insert_index] + new_outbounds + outbounds_list[insert_index:]
    else:
        template_data["outbounds"].extend(new_outbounds)
    return template_data