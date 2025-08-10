#!/usr/bin/env python3
"""
Real Geolocation Tester - based on user's working method
Menggunakan metode yang sudah proven untuk mendapatkan ISP asli
"""

import json
import subprocess
import time
import tempfile
import os
import re
from utils import geoip_lookup

class RealGeolocationTester:
    """Test VPN dengan actual connection untuk mendapatkan ISP asli"""
    
    def __init__(self):
        self.local_http_port = 10809
        self.test_url = 'https://www.google.com'
        self.geo_api_url = 'http://ip-api.com/json'
        self.timeout_seconds = 15
        self.xray_path = './xray'  # Adjust path as needed
        
    def extract_real_ip_from_path(self, path):
        """Extract IP dari path seperti metode user"""
        if not path:
            return None
        ip_match = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', path)
        return ip_match.group(0) if ip_match else None
    
    def clean_domain_from_server_for_testing(self, domain, server):
        """
        USER CLARIFICATION: Remove server part dari SNI/Host untuk testing
        
        Examples:
        1. server="tod.com", domain="tod.com.do-v3.bhm69.site" → return "do-v3.bhm69.site" (remove prefix)
        2. server="example.com", domain="sg.example.com" → return "sg" (remove suffix)
        3. server="example.com", domain="example.com" → return "example.com" (sama persis, TETAP TEST)
        4. server="example.com", domain="different.net" → return "different.net" (berbeda total)
        
        USER REQUEST LOGIC:
        - Sama persis → TETAP TEST (return domain)
        - Ada prefix server → REMOVE server, return remaining part
        - Ada suffix server → REMOVE server, return prefix part  
        - Berbeda total → Keep as-is
        """
        if not domain or not server:
            return domain
            
        # MODIFIED TES8: Jika sama persis, tetap test (user latest request)
        if domain == server:
            print(f"🔧 MODIFIED TES8: Same domain {domain} - WILL TEST (user preference: don't skip)")
            return domain
            
        # USER CLARIFICATION: Remove server part dari SNI/Host
        # Example: server=tod.com, domain=tod.com.do-v3.bhm69.site → return do-v3.bhm69.site
        if server in domain and domain != server:
            # Case 1: server is prefix - REMOVE server part, keep remaining
            if domain.startswith(server + '.'):
                # Remove server prefix, return remaining part
                remaining = domain[len(server + '.'):]
                print(f"🔧 USER REQUEST: Remove server part {domain} → {remaining} (removed prefix {server})")
                return remaining
            # Case 2: server is suffix - REMOVE server part, keep prefix  
            elif domain.endswith('.' + server):
                # Remove server suffix, return prefix part
                prefix = domain[:-len('.' + server)]
                print(f"🔧 USER REQUEST: Remove server part {domain} → {prefix} (removed suffix {server})")
                return prefix
        
        # MODIFIED TES8: Jika berbeda total, keep as-is
        print(f"🔧 MODIFIED TES8: Domain different from server: {domain} (keep as-is)")
        return domain
    
    # Domain restoration moved to core.py for config generation
    
    def get_lookup_target(self, account):
        """
        MODIFIED TES8 METHOD: TES8 method + user latest request
        
        Priority logic:
        1. IP dari path (direct geolocation - highest priority)
        2. SNI dengan MODIFIED TES8 cleaning (TETAP TEST sama, extract prefix, keep berbeda)
        3. Host dengan MODIFIED TES8 cleaning (TETAP TEST sama, extract prefix, keep berbeda)
        4. Fallback: actual VPN proxy method
        
        MODIFIED TES8 LOGIC: Domain sama TETAP DITEST, subdomain di-extract, berbeda total keep as-is
        USER REQUEST: "jika host/sni sama persis dengan server maka test saja itu jangan diskip"
        """
        # Extract details in user's format
        address = account.get('server', '')
        
        # 🎯 PRIORITY #1: Check IP dari path
        path_str = account.get("_ss_path") or account.get("_ws_path") or ""
        if not path_str:
            # Check dari transport path
            transport = account.get('transport', {})
            if isinstance(transport, dict):
                path_str = transport.get('path', '')
        
        real_ip_from_path = self.extract_real_ip_from_path(path_str)
        if real_ip_from_path:
            print(f"🎯 Found real IP in path: {real_ip_from_path}")
            return real_ip_from_path, "path IP"
        
        # Get SNI dan Host
        sni = None
        host = None
        
        # Get SNI from TLS config
        tls_config = account.get('tls', {})
        if isinstance(tls_config, dict):
            sni = tls_config.get('sni') or tls_config.get('server_name')
        
        # Get host from transport headers
        transport = account.get('transport', {})
        if isinstance(transport, dict):
            headers = transport.get('headers', {})
            if isinstance(headers, dict):
                host = headers.get('Host')
        
        print(f"🔍 Raw values - Address: {address}, SNI: {sni}, Host: {host}")
        
        # 🎯 PRIORITY #2: SNI dengan MODIFIED TES8 cleaning (domain sama tetap ditest)
        if sni:
            cleaned_sni = self.clean_domain_from_server_for_testing(sni, address)
            if cleaned_sni:  # Will include same domains (user request: don't skip)
                if cleaned_sni == address:
                    print(f"🎯 MODIFIED TES8: Using same SNI for testing: {cleaned_sni} (don't skip)")
                    return cleaned_sni, "same SNI (tested)"
                else:
                    print(f"🎯 MODIFIED TES8: Using cleaned SNI for lookup: {cleaned_sni}")
                    return cleaned_sni, "cleaned SNI"
        
        # 🎯 PRIORITY #3: Host dengan MODIFIED TES8 cleaning (domain sama tetap ditest)
        if host:
            cleaned_host = self.clean_domain_from_server_for_testing(host, address)
            if cleaned_host:  # Will include same domains (user request: don't skip)
                if cleaned_host == address:
                    print(f"🎯 MODIFIED TES8: Using same Host for testing: {cleaned_host} (don't skip)")
                    return cleaned_host, "same Host (tested)"
                else:
                    print(f"🎯 MODIFIED TES8: Using cleaned Host for lookup: {cleaned_host}")
                    return cleaned_host, "cleaned Host"
        
        # 🎯 FALLBACK: Actual VPN proxy method
        print("🎯 Using actual VPN proxy method (no direct lookup target)")
        return None, "VPN proxy method"
    
    def create_xray_config(self, account):
        """
        USER'S IMPROVED METHOD: Create Xray config dengan proper VLESS/VMess handling
        Based on working standalone script
        """
        protocol = account.get('type', '')
        
        # Mapping protocol names untuk Xray
        protocol_name = 'shadowsocks' if protocol == 'ss' else protocol
        outbound = {"protocol": protocol_name}
        
        # --- STREAM SETTINGS (Handle transport & TLS first) ---
        transport = account.get('transport', {})
        tls_config = account.get('tls', {})
        
        if transport.get('type') != 'tcp' or tls_config.get('enabled'):
            stream_settings = {}
            
            # Network type
            network_type = transport.get('type', 'tcp')
            if network_type != 'tcp':
                stream_settings["network"] = network_type
            
            # TLS settings
            if tls_config.get('enabled') or account.get('security') == 'tls':
                stream_settings['security'] = 'tls'
                sni = tls_config.get('sni') or tls_config.get('server_name', account.get('server', ''))
                stream_settings['tlsSettings'] = {"serverName": sni}
                
                # ALPN support (user's improvement)
                alpn = account.get('alpn')
                if alpn:
                    stream_settings['tlsSettings']["alpn"] = [alpn]
            
            # WebSocket settings
            if network_type == 'ws':
                ws_settings = {
                    "path": transport.get('path', '/'),
                    "headers": transport.get('headers', {})
                }
                stream_settings['wsSettings'] = ws_settings
            
            # gRPC settings
            elif network_type == 'grpc':
                stream_settings['grpcSettings'] = {
                    "serviceName": transport.get('serviceName', account.get('serviceName', ''))
                }
            
            if stream_settings:
                outbound['streamSettings'] = stream_settings
        
        # --- PROTOCOL SETTINGS (User's improved approach) ---
        if protocol_name == 'vless':
            user_config = {
                "uuid": account.get('uuid', account.get('user_id', '')),
                "encryption": account.get('encryption', 'none') or 'none'
            }
            # Flow support untuk VLESS (user's improvement)
            flow = account.get('flow')
            if flow:
                user_config["flow"] = flow
                
            outbound['settings'] = {
                "vnext": [{
                    "address": account.get('server', ''),
                    "port": int(account.get('server_port', 443)),
                    "users": [user_config]
                }]
            }
            
        elif protocol_name == 'vmess':
            user_config = {
                "id": account.get('uuid', account.get('user_id', ''))
            }
            # VMess specific settings (user's improvement)
            alter_id = account.get('alter_id', account.get('alterId'))
            if alter_id is not None:
                user_config["alterId"] = int(alter_id)
            
            encryption = account.get('encryption')
            if encryption:
                user_config["encryption"] = encryption
                
            outbound['settings'] = {
                "vnext": [{
                    "address": account.get('server', ''),
                    "port": int(account.get('server_port', 443)),
                    "users": [user_config]
                }]
            }
            
        elif protocol_name == 'trojan':
            server_config = {
                "address": account.get('server', ''),
                "port": int(account.get('server_port', 443)),
                "password": account.get('password', account.get('user_id', ''))
            }
            # Flow support untuk Trojan (user's improvement)
            flow = account.get('flow')
            if flow:
                server_config["flow"] = flow
                
            outbound['settings'] = {
                "servers": [server_config]
            }
            
        elif protocol_name == 'shadowsocks':
            server_config = {
                "address": account.get('server', ''),
                "port": int(account.get('server_port', 443)),
                "method": account.get('method', 'aes-256-gcm'),
                "password": account.get('password', '')
            }
            outbound['settings'] = {
                "servers": [server_config]
            }
        else:
            print(f"❌ Unsupported protocol: {protocol}")
            return None
        
        return {
            "log": {"loglevel": "warning"},
            "inbounds": [{
                "port": self.local_http_port,
                "protocol": "http",
                "settings": {}
            }],
            "outbounds": [outbound]
        }
    
    def test_real_location(self, account):
        """
        USER'S REAL VPN DATA METHOD: Always use VPN proxy testing for accurate data
        
        Process:
        1. IP dari path → direct geolocation (if available)
        2. Domain cleaning → Remove server part dari SNI/Host 
        3. VPN proxy testing → Use cleaned domains untuk REAL VPN data
        4. Config restoration → Original domains restored untuk final config
        
        USER REQUEST: "saya tu maunya data yang realnya" - always get real VPN server data
        """
        try:
            # Get lookup target dengan user's simplified method
            lookup_target, method = self.get_lookup_target(account)
            
            # USER REQUEST: Always use VPN proxy testing for REAL data
            # Domain cleaning untuk testing accuracy, tapi selalu pakai VPN proxy method
            if lookup_target:
                print(f"🔍 USER PREFERENCE: Domain cleaned to {lookup_target} ({method})")
                print(f"🔍 But using VPN proxy testing for REAL VPN data (user request)")
                
                # Store cleaned target for logging, but use VPN proxy for actual testing
                # This ensures we get REAL VPN server data, not domain registration data
            
            # USER REQUEST: Always test with actual VPN connection for REAL data
            print("🔍 Testing with actual VPN connection for REAL VPN data...")
            
            # Create modified account dengan cleaned domains for VPN testing
            modified_account = self._create_account_with_cleaned_domains(account, lookup_target, method)
            vpn_result = self._test_with_actual_vpn_connection(modified_account)
            
            # If VPN proxy failed (no xray), try to detect real VPN infrastructure
            if not vpn_result.get('success'):
                print("⚠️ VPN proxy unavailable, trying to detect real VPN infrastructure...")
                return self._get_real_vpn_ip_from_infrastructure(account, lookup_target)
            
            return vpn_result
            
        except Exception as e:
            print(f"❌ Real location test error: {e}")
            return {
                'success': False,
                'error': str(e),
                'method': 'failed'
            }
    
    def _resolve_domain_to_best_ip(self, domain):
        """TES8 METHOD: Resolve domain ke IP dan pilih yang terbaik (avoid CDN)"""
        try:
            import socket
            
            # Get all IPs untuk domain
            all_ips = []
            try:
                # Standard resolution
                ip = socket.gethostbyname(domain)
                all_ips.append(ip)
            except:
                pass
            
            # Try with different DNS (if dig available) - TES8 enhancement
            try:
                result = subprocess.run(
                    ['dig', '+short', domain], 
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    for line in result.stdout.strip().split('\n'):
                        line = line.strip()
                        if line and self._is_valid_ip(line):
                            all_ips.append(line)
            except:
                pass
            
            # Remove duplicates
            unique_ips = list(set(all_ips))
            
            if not unique_ips:
                return None
            
            # Jika cuma 1 IP, return langsung
            if len(unique_ips) == 1:
                return unique_ips[0]
            
            # TES8 ENHANCEMENT: Smart IP selection dengan CDN avoidance scoring
            best_ip = None
            best_score = -999
            
            for ip in unique_ips:
                geo_data = self._get_geo_data_direct(ip)
                if geo_data and geo_data.get('status') == 'success':
                    provider = geo_data.get('isp', '').lower()
                    score = 0
                    
                    # TES8: Penalize CDN providers (avoid false geolocation)
                    if any(cdn in provider for cdn in ['cloudflare', 'amazon', 'aws', 'google', 'microsoft']):
                        score -= 50
                        print(f"🔍 TES8: CDN detected - {ip} ({provider}) score: {score}")
                    
                    # TES8: Reward VPS providers (real server locations)
                    if any(vps in provider for vps in ['digitalocean', 'linode', 'vultr', 'hetzner', 'ovh']):
                        score += 30
                        print(f"🔍 TES8: VPS detected - {ip} ({provider}) score: {score}")
                    
                    if score > best_score:
                        best_score = score
                        best_ip = ip
            
            print(f"🎯 TES8: Resolved {domain} to {len(unique_ips)} IPs, selected: {best_ip} (score: {best_score})")
            return best_ip or unique_ips[0]  # Fallback ke IP pertama
            
        except Exception as e:
            print(f"❌ TES8: Domain resolution error: {e}")
            return None
    
    def _is_valid_ip(self, ip_str):
        """Check if string is valid IP"""
        try:
            import socket
            socket.inet_aton(ip_str)
            return True
        except:
            return False
    
    def _get_geo_data_direct(self, ip):
        """Get geolocation data untuk specific IP"""
        try:
            result = subprocess.run(
                ['curl', '-s', f"{self.geo_api_url}/{ip}"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return json.loads(result.stdout)
        except Exception:
            pass
        return None
    
    def _get_geo_data(self, target):
        """Enhanced geolocation dengan IP resolution untuk domain"""
        # Jika target adalah IP, langsung query
        if self._is_valid_ip(target):
            print(f"🔍 Direct IP lookup: {target}")
            return self._get_geo_data_direct(target)
        
        # Jika target adalah domain, resolve ke best IP dulu
        print(f"🔍 Domain lookup: {target}")
        best_ip = self._resolve_domain_to_best_ip(target)
        
        if best_ip:
            print(f"🎯 Resolved domain {target} → {best_ip}")
            return self._get_geo_data_direct(best_ip)
        else:
            print(f"❌ Failed to resolve domain: {target}")
            return None
    
    def _get_geo_data_enhanced(self, target):
        """TES8 ENHANCED: Sempurnakan geolocation dengan advanced CDN avoidance"""
        # Jika target adalah IP, langsung query
        if self._is_valid_ip(target):
            print(f"🔍 TES8: Direct IP geolocation: {target}")
            return self._get_geo_data_direct(target)
        
        # TES8 ENHANCED: Domain resolution dengan advanced CDN avoidance
        print(f"🔍 TES8: Enhanced domain resolution: {target}")
        
        # Step 1: Get all possible IPs
        all_ips = self._get_all_domain_ips(target)
        if not all_ips:
            print(f"❌ TES8: No IPs found for domain: {target}")
            return None
        
        print(f"🔍 TES8: Found {len(all_ips)} IPs for {target}: {all_ips}")
        
        # Step 2: Score and select best IP dengan TES8 method
        best_ip, best_geo = self._select_best_ip_with_geo(all_ips, target)
        
        if best_ip and best_geo:
            print(f"🎯 TES8: Selected best IP {best_ip} with accurate geolocation")
            return best_geo
        else:
            print(f"❌ TES8: Failed to get accurate geolocation for {target}")
            return None
    
    def _get_all_domain_ips(self, domain):
        """TES8: Get all possible IPs untuk domain dengan multiple methods"""
        all_ips = []
        
        try:
            import socket
            
            # Method 1: Standard resolution
            try:
                ip = socket.gethostbyname(domain)
                all_ips.append(ip)
                print(f"🔍 TES8: Standard DNS → {ip}")
            except:
                pass
            
            # Method 2: dig command (if available)
            try:
                result = subprocess.run(
                    ['dig', '+short', domain], 
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    for line in result.stdout.strip().split('\n'):
                        line = line.strip()
                        if line and self._is_valid_ip(line):
                            all_ips.append(line)
                            print(f"🔍 TES8: dig DNS → {line}")
            except:
                pass
            
            # Method 3: Try different DNS servers (TES8 enhancement)
            for dns_server in ['8.8.8.8', '1.1.1.1']:
                try:
                    result = subprocess.run(
                        ['nslookup', domain, dns_server],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0:
                        # Parse nslookup output untuk IP
                        import re
                        ips = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', result.stdout)
                        for ip in ips:
                            if ip not in ['127.0.0.1', '8.8.8.8', '1.1.1.1'] and self._is_valid_ip(ip):
                                all_ips.append(ip)
                                print(f"🔍 TES8: nslookup @{dns_server} → {ip}")
                except:
                    pass
            
        except Exception as e:
            print(f"❌ TES8: DNS resolution error: {e}")
        
        # Remove duplicates and return
        unique_ips = list(set(all_ips))
        return unique_ips
    
    def _select_best_ip_with_geo(self, ip_list, original_domain):
        """TES8: Select best IP berdasarkan geolocation scoring"""
        best_ip = None
        best_geo = None
        best_score = -999
        
        print(f"🔍 TES8: Evaluating {len(ip_list)} IPs for best geolocation...")
        
        for ip in ip_list:
            try:
                # Get geolocation untuk IP ini
                geo_data = self._get_geo_data_direct(ip)
                if not geo_data or geo_data.get('status') != 'success':
                    continue
                
                provider = geo_data.get('isp', '').lower()
                org = geo_data.get('org', '').lower()
                country = geo_data.get('countryCode', '')
                
                # TES8 Scoring algorithm
                score = 0
                
                # Penalize CDN providers heavily
                if any(cdn in provider or cdn in org for cdn in ['cloudflare', 'amazon', 'aws', 'google', 'microsoft', 'akamai']):
                    score -= 100
                    print(f"🔍 TES8: {ip} → {provider} → CDN penalty: {score}")
                    # Don't skip entirely - sometimes CDN is the only option
                    # But heavily penalized so VPS will be preferred
                
                # Reward VPS/hosting providers  
                if any(vps in provider or vps in org for vps in ['digitalocean', 'linode', 'vultr', 'hetzner', 'ovh', 'contabo']):
                    score += 50
                    print(f"🔍 TES8: {ip} → {provider} → VPS reward: {score}")
                
                # Reward legitimate data centers
                if any(dc in provider or dc in org for dc in ['datacenter', 'data center', 'hosting', 'server', 'network']):
                    score += 30
                    print(f"🔍 TES8: {ip} → {provider} → Datacenter reward: {score}")
                
                # Geographic relevance (if domain suggests location)
                if len(country) == 2:  # Valid country code
                    if original_domain.startswith(country.lower() + '.') or country.lower() in original_domain:
                        score += 20
                        print(f"🔍 TES8: {ip} → {country} → Geographic match: {score}")
                
                print(f"🔍 TES8: {ip} → {provider} → Final score: {score}")
                
                if score > best_score:
                    best_score = score
                    best_ip = ip
                    best_geo = geo_data
                    
            except Exception as e:
                print(f"❌ TES8: Error evaluating IP {ip}: {e}")
                continue
        
        if best_ip:
            print(f"🎯 TES8: Best IP selected: {best_ip} (score: {best_score}) → {best_geo.get('isp', 'N/A')}")
        else:
            print(f"❌ TES8: No suitable IP found, all were CDN or failed")
        
        return best_ip, best_geo

    def _create_account_with_cleaned_domains(self, original_account, cleaned_target, method):
        """
        USER REQUEST: Create account dengan cleaned domains untuk VPN testing
        
        Original: tod.com.do-v3.bhm69.site
        Cleaned: tod.com  
        Use cleaned domain untuk VPN testing, restore original untuk config
        """
        import copy
        modified_account = copy.deepcopy(original_account)
        
        # Check if SNI/Host different from cleaned target (need domain cleaning applied)
        original_sni = original_account.get('tls', {}).get('sni')
        original_host = original_account.get('transport', {}).get('headers', {}).get('Host')
        
        if cleaned_target and (original_sni != cleaned_target or original_host != cleaned_target):
            print(f"🔧 Applying cleaned domain untuk VPN testing:")
            print(f"   Original SNI: {original_sni}")
            print(f"   Original Host: {original_host}")
            print(f"   Cleaned target: {cleaned_target}")
            
            # Update TLS SNI untuk testing dengan cleaned domain
            if 'tls' in modified_account:
                if 'sni' in modified_account['tls']:
                    modified_account['tls']['sni'] = cleaned_target
                if 'server_name' in modified_account['tls']:
                    modified_account['tls']['server_name'] = cleaned_target
            
            # Update transport Host untuk testing dengan cleaned domain
            if 'transport' in modified_account and 'headers' in modified_account['transport']:
                if 'Host' in modified_account['transport']['headers']:
                    modified_account['transport']['headers']['Host'] = cleaned_target
            
            print(f"   ✅ Modified untuk testing - SNI: {modified_account.get('tls', {}).get('sni')}, Host: {modified_account.get('transport', {}).get('headers', {}).get('Host')}")
        else:
            print(f"🔧 No domain cleaning needed, using original domains untuk VPN testing")
        
        return modified_account

    def _measure_latency_and_jitter(self, ip, port=443, timeout=5, samples=3):
        """
        USER REQUEST: Measure actual latency and jitter to detected IP instead of hardcoding 0
        """
        import socket
        import time
        import statistics
        
        latencies = []
        
        for _ in range(samples):
            try:
                start_time = time.time()
                with socket.create_connection((ip, port), timeout=timeout):
                    latency = (time.time() - start_time) * 1000
                    latencies.append(latency)
            except (socket.timeout, ConnectionRefusedError, OSError, TypeError):
                continue
        
        if latencies:
            avg_latency = int(statistics.mean(latencies))
            
            # Calculate jitter if multiple samples
            if len(latencies) > 1:
                jitters = [abs(latencies[i] - latencies[i-1]) for i in range(1, len(latencies))]
                avg_jitter = int(statistics.mean(jitters))
            else:
                avg_jitter = 0
                
            return avg_latency, avg_jitter
        else:
            return -1, -1  # All connections failed

    def _get_real_vpn_ip_from_infrastructure(self, account, cleaned_target):
        """
        USER ISSUE: When VPN proxy unavailable, detect real VPN IP from infrastructure
        
        Problem: Both do-v3.bhm69.site and original domains behind CDN
        Solution: Use known real VPN IP from infrastructure pattern
        """
        print(f"🔍 Detecting real VPN infrastructure for {account.get('server', '')} / {cleaned_target}")
        
        # Try enhanced DNS resolution untuk cleaned target
        all_ips = self._get_all_domain_ips(cleaned_target)
        if all_ips:
            print(f"🔍 Found {len(all_ips)} IPs for {cleaned_target}: {all_ips}")
            
            # Score IPs untuk find real VPS (not CDN)
            best_ip, best_geo = self._select_best_ip_with_geo(all_ips, cleaned_target)
            
            if best_ip and best_geo:
                print(f"🎯 Found real VPN infrastructure: {best_ip}")
                
                # USER REQUEST: Measure actual latency to detected IP (not hardcode 0)
                measured_latency, measured_jitter = self._measure_latency_and_jitter(best_ip)
                print(f"📊 Measured latency to {best_ip}: {measured_latency}ms, jitter: {measured_jitter}ms")
                
                return {
                    'success': True,
                    'country': best_geo.get('countryCode', 'N/A'),
                    'country_name': best_geo.get('country', 'N/A'),
                    'isp': best_geo.get('isp', 'N/A'),
                    'org': best_geo.get('org', 'N/A'),
                    'ip': best_geo.get('query', best_ip),
                    'method': 'Real VPN Infrastructure Detection',
                    'latency': measured_latency,
                    'jitter': measured_jitter
                }
        
        # Fallback: Try original domain infrastructure
        original_server = account.get('server', '')
        if original_server and original_server != cleaned_target:
            print(f"🔍 Trying original server infrastructure: {original_server}")
            all_ips = self._get_all_domain_ips(original_server)
            if all_ips:
                best_ip, best_geo = self._select_best_ip_with_geo(all_ips, original_server)
                if best_ip and best_geo:
                    print(f"🎯 Found real VPN infrastructure from original server: {best_ip}")
                    
                    # USER REQUEST: Measure actual latency to detected IP (not hardcode 0)
                    measured_latency, measured_jitter = self._measure_latency_and_jitter(best_ip)
                    print(f"📊 Measured latency to {best_ip}: {measured_latency}ms, jitter: {measured_jitter}ms")
                    
                    return {
                        'success': True,
                        'country': best_geo.get('countryCode', 'N/A'),
                        'country_name': best_geo.get('country', 'N/A'),
                        'isp': best_geo.get('isp', 'N/A'),
                        'org': best_geo.get('org', 'N/A'),
                        'ip': best_geo.get('query', best_ip),
                        'method': 'Real VPN Infrastructure (Original)',
                        'latency': measured_latency,
                        'jitter': measured_jitter
                    }
        
        # Final fallback: Force domain lookup meskipun CDN (for user preference)
        print("🔍 Final fallback: Force domain lookup despite CDN detection...")
        
        # Try direct lookup ke cleaned target (bypass CDN avoidance)
        geo_data = self._get_geo_data_direct_bypass_cdn(cleaned_target)
        if geo_data and geo_data.get('status') == 'success':
            print(f"🎯 Force domain lookup successful: {cleaned_target}")
            return {
                'success': True,
                'country': geo_data.get('countryCode', 'N/A'),
                'country_name': geo_data.get('country', 'N/A'),
                'isp': geo_data.get('isp', 'N/A'),
                'org': geo_data.get('org', 'N/A'),
                'ip': geo_data.get('query', cleaned_target),
                'method': 'Force Domain Lookup (CDN Bypass)',
                'latency': 0
            }
        
        # If all fails, return CDN detection info
        return {
            'success': False,
            'error': 'All domains behind CDN, real VPN infrastructure not accessible without proxy',
            'method': 'infrastructure detection'
        }

    def _get_geo_data_direct_bypass_cdn(self, target):
        """
        USER NEED: Sometimes force domain lookup despite CDN for testing purposes
        Bypass CDN avoidance when user specifically needs domain testing
        """
        try:
            import socket
            
            # Direct domain resolution (no CDN avoidance)
            if self._is_valid_ip(target):
                print(f"🔍 Direct IP lookup (bypass CDN check): {target}")
                return self._get_geo_data_direct(target)
            else:
                print(f"🔍 Force domain resolution (bypass CDN check): {target}")
                # Get first available IP (no scoring)
                ip = socket.gethostbyname(target)
                print(f"🔍 Force resolved {target} → {ip}")
                return self._get_geo_data_direct(ip)
                
        except Exception as e:
            print(f"❌ Force domain lookup failed: {e}")
            return None

    def _test_with_actual_vpn_connection(self, account):
        """Test dengan actual VPN connection seperti metode user"""
        if not os.path.exists(self.xray_path):
            print(f"⚠️  Xray not found at {self.xray_path}, skipping proxy test")
            return {'success': False, 'error': 'Xray not available', 'method': 'proxy'}
        
        try:
            # Create Xray config
            config = self.create_xray_config(account)
            if not config:
                return {'success': False, 'error': 'Config creation failed', 'method': 'proxy'}
            
            # Write temp config
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(config, f)
                temp_config = f.name
            
            try:
                # Start Xray process
                xray_process = subprocess.Popen(
                    [self.xray_path, '-c', temp_config],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                time.sleep(2)  # Wait for startup
                
                # Test connection
                proxy_arg = f"http://127.0.0.1:{self.local_http_port}"
                start_time = time.monotonic()
                
                subprocess.run(
                    ['curl', '-s', '-I', self.test_url, '--proxy', proxy_arg, 
                     '--connect-timeout', str(self.timeout_seconds)],
                    check=True, capture_output=True, timeout=self.timeout_seconds + 2
                )
                
                end_time = time.monotonic()
                latency_ms = (end_time - start_time) * 1000
                
                # Get real IP via proxy
                geo_result = subprocess.run(
                    ['curl', '-s', self.geo_api_url, '--proxy', proxy_arg],
                    capture_output=True, text=True, timeout=10
                )
                
                if geo_result.returncode == 0:
                    geo_data = json.loads(geo_result.stdout)
                    return {
                        'success': True,
                        'country': geo_data.get('countryCode', 'N/A'),
                        'country_name': geo_data.get('country', 'N/A'),
                        'isp': geo_data.get('isp', 'N/A'),
                        'org': geo_data.get('org', 'N/A'),
                        'ip': geo_data.get('query', 'N/A'),
                        'method': 'VPN Proxy',
                        'latency': latency_ms
                    }
                
            finally:
                # Cleanup
                if 'xray_process' in locals():
                    xray_process.kill()
                os.unlink(temp_config)
                
        except Exception as e:
            return {'success': False, 'error': str(e), 'method': 'proxy'}
        
        return {'success': False, 'error': 'Connection failed', 'method': 'proxy'}

# Integration function untuk existing tester
def get_real_geolocation(account):
    """
    Integration function yang bisa dipanggil dari tester.py
    Implements user's proven method untuk real ISP detection
    """
    tester = RealGeolocationTester()
    result = tester.test_real_location(account)
    
    if result.get('success'):
        # Convert ke format yang compatible dengan existing system
        from utils import get_flag_emoji
        
        country_code = result.get('country', 'N/A')
        country_flag = get_flag_emoji(country_code) if country_code != 'N/A' else '❓'
        
        return {
            "Country": country_flag,
            "Provider": result.get('isp', result.get('org', '-')),
            "Tested IP": result.get('ip', '-'),
            "Resolution Method": result.get('method', 'Real Geo'),
            "Real Location": True,
            "Latency": result.get('latency', 0),
            "Jitter": result.get('jitter', 0)
        }
    
    return None  # Fallback ke method lain

if __name__ == "__main__":
    # Test dengan sample account
    test_account = {
        'type': 'trojan',
        'server': 'cdn.cloudflare.com',
        'server_port': 443,
        'password': 'test',
        'transport': {
            'type': 'ws',
            'path': '/path/159.89.15.20-443/ws',
            'headers': {'Host': 'sg.real.server.com'}
        },
        'tls': {
            'enabled': True,
            'sni': 'sg.digitalocean.server.com'
        }
    }
    
    tester = RealGeolocationTester()
    result = tester.test_real_location(test_account)
    print(f"Test result: {result}")