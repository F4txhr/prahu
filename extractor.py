import re

VALID_ACCOUNT_TYPES = {"vmess", "vless", "trojan", "shadowsocks"}

def extract_path_from_plugin_opts(opts_string: str) -> str | None:
    """Ekstrak 'path' dari string plugin_opts."""
    if not isinstance(opts_string, str):
        return None
    match = re.search(r'path=([^;]+)', opts_string)
    if match:
        return match.group(1)
    return None

def extract_accounts_from_config(config_data):
    """
    Extract VPN accounts from a sing-box configuration file.
    
    Args:
        config_data (dict): The loaded configuration data
        
    Returns:
        list: List of VPN account configurations
    """
    if not isinstance(config_data, dict):
        return []
    
    outbounds = config_data.get('outbounds', [])
    if not isinstance(outbounds, list):
        return []
    
    # Filter for VPN-type outbounds
    vpn_types = ['vless', 'trojan', 'shadowsocks', 'vmess']
    accounts = []
    
    for outbound in outbounds:
        if isinstance(outbound, dict) and outbound.get('type') in vpn_types:
            # Skip selector outbounds and other non-server outbounds
            if 'outbounds' in outbound or outbound.get('tag') in ['direct', 'block', 'dns-out']:
                continue
            
            accounts.append(outbound)
    
    return accounts