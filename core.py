import re
import json
import asyncio
from converter import extract_ip_port_from_path
from tester import test_account

def clean_account_dict(account: dict) -> dict:
    return {k: v for k, v in account.items() if not k.startswith("_")}

def deduplicate_accounts(accounts: list) -> list:
    # Simple: no deduplication. Add logic if needed.
    return accounts

def sort_priority(res):
    country = res.get("Country", "")
    if "🇮🇩" in country:
        return (0,)
    if "🇸🇬" in country:
        return (1,)
    if "🇯🇵" in country:
        return (2,)
    if "🇰🇷" in country:
        return (3,)
    if "🇺🇸" in country:
        return (4,)
    return (5, country)

def clean_provider_name(provider):
    provider = re.sub(r"\(.*?\)", "", provider)
    provider = provider.replace(",", "")
    provider = provider.strip()
    return provider

def ensure_ws_path_field(accounts: list) -> list:
    """
    Pastikan setiap akun memiliki _ws_path atau _ss_path.
    Jika belum ada, coba ambil dari plugin_opts/transport.
    """
    for acc in accounts:
        if acc.get("type") == "shadowsocks" and not acc.get("_ss_path"):
            plugin_opts = acc.get("plugin_opts", "")
            m = re.search(r'path=([^;]+)', plugin_opts)
            if m:
                acc["_ss_path"] = m.group(1)
        elif acc.get("type") in ("vless", "trojan") and not acc.get("_ws_path"):
            transport = acc.get("transport", {})
            if isinstance(transport, dict) and transport.get("type") == "ws":
                acc["_ws_path"] = transport.get("path", "")
    return accounts

async def test_all_accounts(accounts: list, semaphore, live_results):
    print(f"🔍 DEBUG: test_all_accounts called with {len(accounts)} accounts")
    
    tasks = [
        test_account(acc, semaphore, i, live_results)
        for i, acc in enumerate(accounts)
    ]
    print(f"🔍 DEBUG: Created {len(tasks)} test tasks")
    
    results = []
    for i, future in enumerate(asyncio.as_completed(tasks)):
        print(f"🔍 DEBUG: Processing task {i+1}/{len(tasks)}")
        result = await future
        print(f"🔍 DEBUG: Task {i+1} completed with status: {result.get('Status', 'unknown')}")
        live_results[result["index"]].update(result)
        results.append(result)
    
    print(f"🔍 DEBUG: test_all_accounts completed, {len(results)} results")
    return results

def build_final_accounts(successful_results, custom_servers=None):
    """
    Build final accounts untuk config dengan optional server replacement
    
    Args:
        successful_results: Test results yang successful
        custom_servers: Optional list server baru untuk replacement
    """
    final_accounts = []
    
    # Jika ada custom servers, buat random distribution
    server_assignments = None
    if custom_servers:
        server_assignments = generate_server_assignments(successful_results, custom_servers)
        print(f"🔄 Config: Applying server replacement dengan {len(custom_servers)} servers")
        print(f"🔄 Config: Custom servers = {custom_servers}")
        print(f"🔄 Config: Server assignments = {server_assignments}")
    else:
        print(f"🔄 Config: No custom servers found - using original servers")
    
    for i, res in enumerate(successful_results):
        account_obj = res["OriginalAccount"].copy()  # Copy untuk avoid mutation
        country = res["Country"]
        provider = clean_provider_name(res["Provider"])
        tag = f"{country} {provider} -{i+1}"
        tag = " ".join(tag.split())  # Hilangkan spasi ganda
        
        # 🔄 APPLY SERVER REPLACEMENT untuk config final (bukan testing)
        if server_assignments and i < len(server_assignments):
            original_server = account_obj.get('server', '')
            new_server = server_assignments[i]
            account_obj['server'] = new_server
            print(f"🔄 Config: Account {i+1} server {original_server} → {new_server}")
            print(f"🔄 Config: Updated account server field = {account_obj.get('server')}")
        else:
            print(f"🔄 Config: Account {i+1} keeping original server = {account_obj.get('server')}")
        
        # 🔄 RESTORE original domain values (yang di-clean untuk testing)
        # USER REQUEST: "jika sudah ditest maka gabungkan lagi untuk dimasukkan kedalam config"
        restore_original_domains_for_config(account_obj, res)
        
        account_obj["tag"] = tag
        final_accounts.append(clean_account_dict(account_obj))
    
    return final_accounts

def restore_original_domains_for_config(account_obj, test_result):
    """
    USER REQUEST: Restore original domains untuk config final
    
    Testing: tod.com.do-v3.bhm69.site → do-v3.bhm69.site (cleaned for testing)
    Config: Restore → tod.com.do-v3.bhm69.site (original for config)
    """
    # Check if we have original account data in test result
    if "OriginalAccount" in test_result:
        original_account = test_result["OriginalAccount"]
        
        # Restore original SNI
        original_tls = original_account.get('tls', {})
        if 'tls' in account_obj and original_tls:
            if 'sni' in original_tls:
                account_obj['tls']['sni'] = original_tls['sni']
                print(f"🔄 Config: Restored original SNI = {original_tls['sni']}")
            if 'server_name' in original_tls:
                account_obj['tls']['server_name'] = original_tls['server_name']
                print(f"🔄 Config: Restored original server_name = {original_tls['server_name']}")
        
        # Restore original Host
        original_transport = original_account.get('transport', {})
        original_headers = original_transport.get('headers', {}) if original_transport else {}
        if 'transport' in account_obj and 'headers' in account_obj['transport'] and original_headers:
            if 'Host' in original_headers:
                account_obj['transport']['headers']['Host'] = original_headers['Host']
                print(f"🔄 Config: Restored original Host = {original_headers['Host']}")
        
        print(f"🔄 Config: Domain restoration completed for account")
    else:
        print(f"⚠️ Config: No original account data found, using current domains")

def generate_server_assignments(successful_results, custom_servers):
    """
    Generate random server assignments untuk successful accounts
    """
    import random
    
    account_count = len(successful_results)
    server_count = len(custom_servers)
    
    # Calculate even distribution
    accounts_per_server = account_count // server_count
    remainder = account_count % server_count
    
    # Create assignment list
    assignments = []
    for i, server in enumerate(custom_servers):
        # Add extra account to first few servers if there's remainder
        count = accounts_per_server + (1 if i < remainder else 0)
        assignments.extend([server] * count)
    
    # Random shuffle assignments
    random.shuffle(assignments)
    
    print(f"🎲 Generated {account_count} assignments across {server_count} servers")
    return assignments

# Duplicate function removed - using new implementation above

def load_template(template_file):
    with open(template_file, "r") as f:
        return json.load(f)