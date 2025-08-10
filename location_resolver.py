#!/usr/bin/env python3
"""
Smart Location Resolver untuk VPN configs yang menggunakan domain/SNI
Resolves ke real server location, bukan CDN/Cloudflare
"""

import socket
import re
import asyncio
from typing import Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    requests = None

from utils import geoip_lookup

class SmartLocationResolver:
    """Resolve real VPN server location meskipun menggunakan domain/SNI"""
    
    def __init__(self):
        self.dns_servers = [
            '8.8.8.8',      # Google DNS
            '1.1.1.1',      # Cloudflare DNS  
            '208.67.222.222', # OpenDNS
            '9.9.9.9'       # Quad9 DNS
        ]
        
        # Known CDN/Proxy providers yang biasanya bukan server VPN real
        self.cdn_providers = [
            'cloudflare', 'amazon', 'aws', 'google', 'microsoft',
            'akamai', 'fastly', 'maxcdn', 'keycdn', 'jsdelivr'
        ]
        
        # Common VPS/Hosting providers yang biasanya real VPN servers
        self.vps_providers = [
            'digitalocean', 'linode', 'vultr', 'hetzner', 'ovh',
            'contabo', 'hostinger', 'namecheap', 'godaddy'
        ]
    
    def _is_ip(self, address: str) -> bool:
        """Check if address is IP"""
        try:
            socket.inet_aton(address)
            return True
        except:
            return False
    
    def _is_cdn_provider(self, provider: str) -> bool:
        """Check if provider is CDN/Proxy (likely not real VPN server)"""
        provider_lower = provider.lower()
        return any(cdn in provider_lower for cdn in self.cdn_providers)
    
    def _resolve_domain_multiple_dns(self, domain: str) -> List[str]:
        """Resolve domain menggunakan multiple methods untuk dapat semua IPs"""
        all_ips = set()
        
        # Method 1: System resolver
        try:
            ip = socket.gethostbyname(domain)
            all_ips.add(ip)
        except:
            pass
        
        # Method 2: Manual dig command (if available)
        try:
            import subprocess
            result = subprocess.run(['dig', '+short', domain], 
                                  capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                for line in result.stdout.strip().split('\n'):
                    line = line.strip()
                    if line and self._is_ip(line):
                        all_ips.add(line)
        except (ImportError, FileNotFoundError, subprocess.TimeoutExpired):
            pass
        
        # Method 3: Use different DNS servers with nslookup
        for dns_server in self.dns_servers[:2]:  # Limit to 2 DNS servers
            try:
                import subprocess
                result = subprocess.run(['nslookup', domain, dns_server], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    # Extract IPs from nslookup output
                    ips = re.findall(r'Address: (\d+\.\d+\.\d+\.\d+)', result.stdout)
                    all_ips.update(ips)
            except (ImportError, FileNotFoundError, subprocess.TimeoutExpired):
                continue
        
        return list(all_ips)
    
    def _get_best_ip_for_location(self, ips: List[str]) -> Optional[str]:
        """Pilih IP terbaik untuk location lookup (hindari CDN)"""
        ip_scores = []
        
        for ip in ips:
            geo_info = geoip_lookup(ip)
            provider = geo_info.get('Provider', '').lower()
            country = geo_info.get('Country', '❓')
            
            score = 0
            
            # Penalize CDN providers
            if self._is_cdn_provider(provider):
                score -= 50
            
            # Reward VPS providers  
            if any(vps in provider for vps in self.vps_providers):
                score += 30
            
            # Reward if has country info
            if country != '❓':
                score += 20
            
            # Reward non-US IPs (karena banyak CDN di US)
            if '🇺🇸' not in country:
                score += 10
            
            ip_scores.append((ip, score, geo_info))
        
        if not ip_scores:
            return None
        
        # Sort by score dan return IP terbaik
        ip_scores.sort(key=lambda x: x[1], reverse=True)
        best_ip, best_score, best_geo = ip_scores[0]
        
        print(f"🎯 Best IP for location: {best_ip} (score: {best_score})")
        print(f"   Provider: {best_geo.get('Provider', '-')}")
        print(f"   Country: {best_geo.get('Country', '❓')}")
        
        return best_ip
    
    def resolve_vpn_location(self, account: dict) -> dict:
        """Main function untuk resolve VPN location"""
        server = account.get('server', '')
        port = account.get('server_port', 443)
        vpn_type = account.get('type', '')
        
        # 🎯 PRIORITY #1: Check IP dari path (highest priority)
        from converter import extract_ip_port_from_path
        path_str = account.get("_ss_path") or account.get("_ws_path") or ""
        path_ip, path_port = extract_ip_port_from_path(path_str)
        
        if path_ip:
            print(f"🎯 Found IP in path: {path_ip}:{path_port or port}")
            geo_info = geoip_lookup(path_ip)
            return {
                "Country": geo_info.get("Country", "❓"),
                "Provider": geo_info.get("Provider", "-"),
                "Tested IP": path_ip,
                "Resolution Method": "path IP (highest priority)"
            }
        
        # Get host/sni dari transport/tls config untuk fallback
        host = None
        sni = None
        
        # Get host from transport headers
        transport = account.get('transport', {})
        if isinstance(transport, dict):
            headers = transport.get('headers', {})
            if isinstance(headers, dict):
                host = headers.get('Host')
        
        # Get SNI from TLS config
        tls_config = account.get('tls', {})
        if isinstance(tls_config, dict):
            sni = tls_config.get('sni') or tls_config.get('server_name')
        
        # Priority untuk testing (setelah path IP):
        # 1. Jika server adalah IP, langsung pakai
        # 2. Jika ada host/sni yang berbeda dari server, test host/sni dulu
        # 3. Fallback ke server
        
        candidates = []
        
        if self._is_ip(server):
            candidates.append(('server_ip', server))
        else:
            # Server adalah domain, add ke candidates
            candidates.append(('server_domain', server))
        
        if host and host != server:
            candidates.append(('host', host))
        
        if sni and sni != server and sni != host:
            candidates.append(('sni', sni))
        
        print(f"🔍 Resolving location for {vpn_type} VPN:")
        print(f"   Server: {server}")
        if host: print(f"   Host: {host}")
        if sni: print(f"   SNI: {sni}")
        
        best_result = {
            "Country": "❓",
            "Provider": "-", 
            "Tested IP": "-",
            "Resolution Method": "Failed"
        }
        
        for method, candidate in candidates:
            print(f"\n🧪 Testing {method}: {candidate}")
            
            if self._is_ip(candidate):
                # Direct IP
                geo_info = geoip_lookup(candidate)
                result = {
                    "Country": geo_info.get("Country", "❓"),
                    "Provider": geo_info.get("Provider", "-"),
                    "Tested IP": candidate,
                    "Resolution Method": f"{method} (direct IP)"
                }
                
                if not self._is_cdn_provider(result["Provider"]):
                    print(f"✅ Good result from {method}: {result['Country']} - {result['Provider']}")
                    return result
                else:
                    print(f"⚠️  CDN detected from {method}: {result['Provider']}")
                    if best_result["Country"] == "❓":
                        best_result = result
            
            else:
                # Domain - resolve ke multiple IPs
                try:
                    ips = self._resolve_domain_multiple_dns(candidate)
                    print(f"   Resolved IPs: {ips}")
                    
                    if ips:
                        best_ip = self._get_best_ip_for_location(ips)
                        if best_ip:
                            geo_info = geoip_lookup(best_ip)
                            result = {
                                "Country": geo_info.get("Country", "❓"),
                                "Provider": geo_info.get("Provider", "-"),
                                "Tested IP": best_ip,
                                "Resolution Method": f"{method} (best of {len(ips)} IPs)"
                            }
                            
                            if not self._is_cdn_provider(result["Provider"]):
                                print(f"✅ Good result from {method}: {result['Country']} - {result['Provider']}")
                                return result
                            else:
                                print(f"⚠️  CDN detected from {method}: {result['Provider']}")
                                if best_result["Country"] == "❓":
                                    best_result = result
                
                except Exception as e:
                    print(f"❌ Error resolving {method}: {e}")
        
        print(f"\n🎯 Final result: {best_result}")
        return best_result

# Integration dengan existing tester
def enhance_geolocation(account: dict, basic_result: dict) -> dict:
    """Enhance basic test result dengan smart location resolution"""
    
    # Jika basic test gagal, return as-is
    if basic_result.get("Status") != "✅":
        return basic_result
    
    # Jika sudah ada country info dan provider bukan CDN, keep as-is
    current_provider = basic_result.get("Provider", "")
    if (basic_result.get("Country", "❓") != "❓" and 
        current_provider and 
        not any(cdn in current_provider.lower() for cdn in ['cloudflare', 'amazon', 'aws'])):
        return basic_result
    
    # Enhance dengan smart location resolver
    resolver = SmartLocationResolver()
    smart_location = resolver.resolve_vpn_location(account)
    
    # Update result dengan smart location
    enhanced_result = basic_result.copy()
    enhanced_result.update({
        "Country": smart_location["Country"],
        "Provider": smart_location["Provider"],
        "Tested IP": smart_location["Tested IP"],
        "Resolution Method": smart_location["Resolution Method"]
    })
    
    return enhanced_result

if __name__ == "__main__":
    # Test resolver
    test_account = {
        'type': 'trojan',
        'server': 'example.com',
        'server_port': 443,
        'transport': {
            'headers': {
                'Host': 'cdn.example.com'
            }
        },
        'tls': {
            'sni': 'sni.example.com'
        }
    }
    
    resolver = SmartLocationResolver()
    result = resolver.resolve_vpn_location(test_account)
    print(f"\nFinal Result: {result}")