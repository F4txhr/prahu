import os
import json
import re
import asyncio
import requests
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file
from flask_socketio import SocketIO, emit
import threading
import tempfile
import subprocess
from dotenv import load_dotenv
from urllib.parse import urlparse

# Import existing modules
from github_client import GitHubClient
from core import (
    deduplicate_accounts, sort_priority, ensure_ws_path_field,
    build_final_accounts, load_template, test_all_accounts
)
from extractor import extract_accounts_from_config
from converter import parse_link, inject_outbounds_to_template
from database import save_github_config, get_github_config, save_test_session, get_latest_test_session

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Global variables to store session data
session_data = {
    'github_client': None,
    'all_accounts': [],
    'test_results': [],
    'final_config': None,
    'github_path': None,
    'github_sha': None,
    'custom_servers': None  # Store custom servers untuk config generation
}

MAX_CONCURRENT_TESTS = 5
TEMPLATE_FILE = "template.json"

def fetch_vpn_links_from_url(url, url_type='auto'):
    """
    Fetch VPN links from URL (API or raw text)
    url_type: 'api', 'raw', or 'auto'
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        vpn_links = []
        
        # Try JSON first (API response)
        try:
            data = response.json()
            
            # Extract VPN links from JSON (flexible extraction)
            def extract_from_json(obj):
                if isinstance(obj, str):
                    if any(proto in obj for proto in ['vless://', 'vmess://', 'trojan://', 'ss://']):
                        vpn_links.append(obj)
                elif isinstance(obj, list):
                    for item in obj:
                        extract_from_json(item)
                elif isinstance(obj, dict):
                    for value in obj.values():
                        extract_from_json(value)
            
            extract_from_json(data)
            
        except json.JSONDecodeError:
            # Not JSON, treat as plain text
            pass
        
        # If no links found in JSON or it's plain text, use regex
        if not vpn_links:
            content = response.text
            vpn_pattern = r"(?:vless|vmess|trojan|ss)://[^\s\n\r]+"
            vpn_links = re.findall(vpn_pattern, content)
        
        return {
            'success': True,
            'links': vpn_links,
            'count': len(vpn_links)
        }
        
    except requests.exceptions.Timeout:
        return {'success': False, 'error': 'Request timeout - URL took too long to respond'}
    except requests.exceptions.ConnectionError:
        return {'success': False, 'error': 'Connection error - Could not reach URL'}
    except requests.exceptions.HTTPError as e:
        return {'success': False, 'error': f'HTTP error: {e}'}
    except Exception as e:
        return {'success': False, 'error': f'Error fetching from URL: {e}'}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/setup-github', methods=['POST'])
def setup_github():
    data = request.json
    token = data.get('token')
    owner = data.get('owner')
    repo = data.get('repo')
    
    if token and owner and repo:
        # Save to local database
        save_github_config(token, owner, repo)
        session_data['github_client'] = GitHubClient(token, owner, repo)
        return jsonify({'success': True, 'message': 'GitHub configured and saved locally'})
    else:
        return jsonify({'success': False, 'message': 'All fields are required'})

# Removed duplicate endpoint - using new implementation below

@app.route('/api/list-github-files')
def list_github_files():
    if not session_data['github_client']:
        return jsonify({'success': False, 'message': 'GitHub not configured'})
    
    files = session_data['github_client'].list_files_in_repo()
    json_files = [f for f in files if f.get('type') == 'file' and f.get('name', '').endswith('.json')]
    return jsonify({'success': True, 'files': json_files})

@app.route('/api/load-config', methods=['POST'])
def load_config():
    data = request.json
    source = data.get('source')  # 'local' or 'github'
    
    try:
        if source == 'github':
            file_path = data.get('file_path')
            if not session_data['github_client'] or not file_path:
                return jsonify({'success': False, 'message': 'GitHub client not configured or file path missing'})
            
            content, sha = session_data['github_client'].get_file(file_path)
            if content:
                config_data = json.loads(content)
                session_data['github_path'] = file_path
                session_data['github_sha'] = sha
            else:
                return jsonify({'success': False, 'message': 'Failed to load file from GitHub'})
        else:
            # Load from local template
            with open(TEMPLATE_FILE, 'r') as f:
                config_data = json.load(f)
            session_data['github_path'] = None
            session_data['github_sha'] = None
        
        # Extract existing accounts
        existing_accounts = extract_accounts_from_config(config_data)
        existing_accounts = ensure_ws_path_field(existing_accounts)
        session_data['all_accounts'] = existing_accounts if isinstance(existing_accounts, list) else []
        
        return jsonify({
            'success': True, 
            'message': f'Loaded {len(session_data["all_accounts"])} existing accounts',
            'account_count': len(session_data['all_accounts'])
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error loading config: {str(e)}'})

def smart_detect_input_type(text):
    """
    USER REQUEST: Smart auto-detection of input type
    Detects if input is VPN links or URLs to fetch from
    """
    text = text.strip()
    
    # Check if text contains direct VPN links
    vpn_pattern = r"(?:vless|vmess|trojan|ss)://[^\s]+"
    vpn_links = re.findall(vpn_pattern, text)
    
    if vpn_links:
        # Contains VPN links - use direct parsing
        return {
            'type': 'direct_links',
            'links': vpn_links,
            'detection': f'Found {len(vpn_links)} VPN links'
        }
    
    # Check if text is a single URL
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if len(lines) == 1:
        line = lines[0]
        parsed = urlparse(line)
        if parsed.scheme and parsed.netloc:
            # Single URL - try to fetch from it
            return {
                'type': 'fetch_url',
                'url': line,
                'detection': f'Detected URL: {parsed.netloc}'
            }
    
    # Check if text contains multiple URLs
    url_pattern = r'https?://[^\s]+'
    urls = re.findall(url_pattern, text)
    if urls:
        return {
            'type': 'multiple_urls',
            'urls': urls,
            'detection': f'Found {len(urls)} URLs'
        }
    
    # No VPN links or URLs found
    return {
        'type': 'unknown',
        'detection': 'No VPN links or URLs detected'
    }

@app.route('/api/add-links-and-test', methods=['POST'])
def add_links_and_test():
    data = request.json
    input_text = data.get('links', '').strip()
    
    if not input_text:
        return jsonify({'success': False, 'message': 'No input provided'})
    
    # Smart auto-detection
    detection_result = smart_detect_input_type(input_text)
    
    found_links = []
    fetch_info = {}
    
    if detection_result['type'] == 'direct_links':
        # Direct VPN links found
        found_links = detection_result['links']
        fetch_info = {
            'detection': detection_result['detection'],
            'type': 'direct_links'
        }
        
    elif detection_result['type'] == 'fetch_url':
        # Single URL to fetch from
        url = detection_result['url']
        fetch_result = fetch_vpn_links_from_url(url)
        
        if not fetch_result['success']:
            return jsonify({
                'success': False, 
                'message': f"Failed to fetch from URL: {fetch_result['error']}",
                'detection': detection_result['detection']
            })
        
        found_links = fetch_result['links']
        fetch_info = {
            'url': url,
            'type': 'auto_fetch',
            'fetched_count': fetch_result['count'],
            'detection': detection_result['detection']
        }
        
    elif detection_result['type'] == 'multiple_urls':
        # Multiple URLs - try to fetch from all
        all_links = []
        successful_urls = []
        failed_urls = []
        
        for url in detection_result['urls']:
            fetch_result = fetch_vpn_links_from_url(url)
            if fetch_result['success'] and fetch_result['links']:
                all_links.extend(fetch_result['links'])
                successful_urls.append({'url': url, 'count': fetch_result['count']})
            else:
                failed_urls.append({'url': url, 'error': fetch_result.get('error', 'No links found')})
        
        found_links = all_links
        fetch_info = {
            'type': 'multiple_fetch',
            'successful_urls': successful_urls,
            'failed_urls': failed_urls,
            'total_fetched': len(all_links),
            'detection': detection_result['detection']
        }
        
    else:
        # Unknown input type
        return jsonify({
            'success': False, 
            'message': 'No VPN links or valid URLs found in input',
            'detection': detection_result['detection']
        })
    
    if not found_links:
        return jsonify({
            'success': False, 
            'message': 'No valid VPN links found after processing',
            'detection': detection_result.get('detection', 'Unknown')
        })
    
    # Parse each link
    accounts_from_links = []
    invalid_links = []
    
    for link in found_links:
        parsed = parse_link(link)
        if parsed:
            accounts_from_links.append(parsed)
        else:
            invalid_links.append(link[:50] + "..." if len(link) > 50 else link)
    
    if not accounts_from_links:
        return jsonify({'success': False, 'message': 'No valid accounts could be parsed from the links'})
    
    # Combine with existing accounts and deduplicate
    if not isinstance(session_data['all_accounts'], list):
        session_data['all_accounts'] = []
    
    all_accounts = session_data['all_accounts'] + accounts_from_links
    session_data['all_accounts'] = deduplicate_accounts(all_accounts)
    session_data['all_accounts'] = ensure_ws_path_field(session_data['all_accounts'])
    
    # Create success response with detection info
    response = {
        'success': True,
        'new_accounts': len(accounts_from_links),
        'total_accounts': len(session_data['all_accounts']),
        'invalid_links': invalid_links,
        'ready_to_test': True,
        'detection_info': fetch_info
    }
    
    # Create smart message based on detection type
    if fetch_info.get('type') == 'direct_links':
        response['message'] = f"🔗 Detected {len(found_links)} VPN links, added {len(accounts_from_links)} valid accounts. Ready to test!"
    elif fetch_info.get('type') == 'auto_fetch':
        response['message'] = f"🌐 Auto-fetched {fetch_info['fetched_count']} links from URL, added {len(accounts_from_links)} valid accounts. Ready to test!"
    elif fetch_info.get('type') == 'multiple_fetch':
        successful_count = len(fetch_info['successful_urls'])
        total_urls = successful_count + len(fetch_info['failed_urls'])
        response['message'] = f"🔄 Fetched from {successful_count}/{total_urls} URLs, got {fetch_info['total_fetched']} links, added {len(accounts_from_links)} valid accounts. Ready to test!"
    else:
        response['message'] = f"✅ Added {len(accounts_from_links)} accounts. Ready to test!"
    
    return jsonify(response)

@socketio.on('start_testing')
def handle_start_testing():
    print(f"🔍 DEBUG: start_testing received, accounts count: {len(session_data['all_accounts'])}")
    
    if not session_data['all_accounts']:
        print("❌ DEBUG: No accounts found in session_data")
        emit('testing_error', {'message': 'No accounts to test'})
        return
    
    print("✅ DEBUG: Starting testing process in backend...")
    
    def run_tests():
        # Create a new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Initialize test results with better structure
            live_results = []
            for i, acc in enumerate(session_data['all_accounts']):
                result = {
                    "index": i,
                    "OriginalTag": acc.get("tag", f"Account-{i+1}"),
                    "OriginalAccount": acc,
                    "VpnType": acc.get("type", "unknown"),
                    "type": acc.get("type", "unknown"),  # Backup field
                    "server": acc.get("server", "-"),   # For tested IP fallback
                    "Country": "❓",
                    "Provider": "-",
                    "Tested IP": "-",
                    "Latency": -1,
                    "Jitter": -1,
                    "ICMP": "N/A",
                    "Status": "WAIT",
                    "Retry": 0
                }
                live_results.append(result)
            
            session_data['test_results'] = live_results
            
            # USER REQUEST: Don't emit initial WAIT accounts - show accounts only when testing starts
            initial_data = {
                'results': [],  # Empty - accounts will appear when testing starts
                'total': len(live_results),
                'completed': 0
            }
            print(f"Starting testing for {len(live_results)} accounts - table will show accounts as they are tested")
            socketio.emit('testing_update', initial_data)
            
            # Create semaphore and run tests
            semaphore = asyncio.Semaphore(MAX_CONCURRENT_TESTS)
            
            # Create a background task to emit updates
            def emit_periodic_updates():
                import time
                import threading
                
                def update_loop():
                    while True:
                        time.sleep(1)  # Update every second
                        
                        # Better status detection - exclude only WAIT status
                        completed = len([res for res in live_results if res["Status"] not in ["WAIT", "🔄", "🔁"]])
                        
                        try:
                            # USER REQUEST: Progressive display - only send accounts that are being tested or completed
                            active_results = [dict(res) for res in live_results if res["Status"] != "WAIT"]
                            
                            data_to_send = {
                                'results': active_results,  # Only active/completed accounts
                                'total': len(live_results),
                                'completed': completed
                            }
                            print(f"Emitting periodic update: {completed}/{len(live_results)} completed, {len(active_results)} active accounts")
                            socketio.emit('testing_update', data_to_send)
                        except Exception as e:
                            print(f"Update emit error: {e}")
                            break
                        
                        # Check if testing is done - but continue a bit more to ensure final states
                        if completed >= len(live_results):
                            time.sleep(2)  # Give extra time for final status updates
                            break
                
                thread = threading.Thread(target=update_loop, daemon=True)
                thread.start()
                return thread
            
            # Start periodic updates
            update_thread = emit_periodic_updates()
            
            # Main async function to run tests
            async def run_all_tests():
                await test_all_accounts(session_data['all_accounts'], semaphore, live_results)
                
                # Count successful accounts (USER REQUEST: exclude dead accounts from final config)
                successful_accounts = [res for res in live_results if res["Status"] == "✅"]
                dead_accounts = [res for res in live_results if res["Status"] == "Dead"]
                
                print(f"📊 Testing completed: {len(successful_accounts)} successful, {len(dead_accounts)} dead")
                if dead_accounts:
                    print(f"💀 Dead accounts excluded from final config: {len(dead_accounts)} accounts")
                    for dead in dead_accounts:
                        print(f"   - {dead.get('VpnType', 'N/A')} account {dead.get('index', 'unknown')} (dead after 3 timeouts)")
                
                # Sort by priority
                successful_accounts.sort(key=sort_priority)
                
                # Save test session to database
                session_id = save_test_session({
                    'results': live_results,
                    'successful': len(successful_accounts),
                    'total': len(live_results),
                    'timestamp': datetime.now().isoformat()
                })
                
                # Auto-generate configuration if we have successful accounts
                if successful_accounts:
                    try:
                        # DEPRECATED: session_data custom_servers tidak digunakan lagi
                        # Sekarang custom servers akan diambil dari frontend saat download
                        print(f"🔄 Auto-generate: Using original servers (custom servers will be applied on download)")
                        final_accounts_to_inject = build_final_accounts(successful_accounts)
                        fresh_template_data = load_template(TEMPLATE_FILE)
                        final_config_data = inject_outbounds_to_template(fresh_template_data, final_accounts_to_inject)
                        final_config_str = json.dumps(final_config_data, indent=2, ensure_ascii=False)
                        session_data['final_config'] = final_config_str
                        
                        socketio.emit('config_generated', {
                            'success': True,
                            'account_count': len(final_accounts_to_inject)
                        })
                    except Exception as e:
                        socketio.emit('config_generated', {
                            'success': False,
                            'error': str(e)
                        })
                
                # Force final status update to ensure all accounts show final state
                print(f"Final status update: forcing all pending accounts to complete")
                for res in live_results:
                    if res["Status"] in ["🔄", "🔁", "WAIT"]:
                        # If still in testing state, mark as failed or timeout
                        res["Status"] = "❌"
                        res["Latency"] = "Timeout"
                        print(f"Forcing completion for account {res.get('index', 'unknown')}: {res.get('VpnType', 'unknown')}")
                
                # Emit one final update with corrected statuses
                final_completed = len([res for res in live_results if res["Status"] not in ["WAIT", "🔄", "🔁"]])
                final_data = {
                    'results': [dict(res) for res in live_results],
                    'total': len(live_results),
                    'completed': final_completed
                }
                print(f"Emitting final testing update: {final_completed}/{len(live_results)} completed")
                socketio.emit('testing_update', final_data)
                
                # Emit final results
                socketio.emit('testing_complete', {
                    'results': live_results,
                    'successful': len(successful_accounts),
                    'total': len(live_results),
                    'session_id': session_id
                })
            
            # Run the async test function
            loop.run_until_complete(run_all_tests())
            
        except Exception as e:
            socketio.emit('testing_error', {'message': f'Testing failed: {str(e)}'})
        finally:
            loop.close()
    
    # Start testing in a separate thread
    testing_thread = threading.Thread(target=run_tests)
    testing_thread.daemon = True
    testing_thread.start()

@app.route('/api/generate-config', methods=['POST'])
def generate_config():
    if not session_data['test_results']:
        return jsonify({'success': False, 'message': 'No test results available'})
    
    try:
        data = request.json or {}
        custom_servers_input = data.get('custom_servers', '').strip()
        
        # Get successful accounts
        successful_accounts = [res for res in session_data['test_results'] if res["Status"] == "●"]
        
        if not successful_accounts:
            return jsonify({'success': False, 'message': 'No successful accounts to generate config'})
        
        # Sort by priority
        successful_accounts.sort(key=sort_priority)
        
        # Parse custom servers dari frontend
        custom_servers = None
        if custom_servers_input:
            custom_servers = parse_servers_input(custom_servers_input)
            print(f"🔄 Generate-config: Using custom servers from frontend = {custom_servers}")
        else:
            print(f"🔄 Generate-config: No custom servers, using original servers")
        
        # Build final accounts dengan optional server replacement
        final_accounts_to_inject = build_final_accounts(successful_accounts, custom_servers)
        
        # Load fresh template
        fresh_template_data = load_template(TEMPLATE_FILE)
        
        # Inject accounts
        final_config_data = inject_outbounds_to_template(fresh_template_data, final_accounts_to_inject)
        final_config_str = json.dumps(final_config_data, indent=2, ensure_ascii=False)
        
        session_data['final_config'] = final_config_str
        
        return jsonify({
            'success': True,
            'message': f'Generated config with {len(final_accounts_to_inject)} accounts' + 
                      (f' using {len(custom_servers)} custom servers' if custom_servers else ''),
            'account_count': len(final_accounts_to_inject),
            'custom_servers_used': len(custom_servers) if custom_servers else 0
        })
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error generating config: {str(e)}'})

@app.route('/api/download-config')
def download_config():
    if not session_data['final_config']:
        return jsonify({'success': False, 'message': 'No config available for download'})
    
    timestamp = datetime.now().strftime("%Y%m%d-%H%M")
    filename = f"VortexVpn-{timestamp}.json"
    
    # Create temporary file
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as f:
        f.write(session_data['final_config'])
        temp_path = f.name
    
    return send_file(temp_path, as_attachment=True, download_name=filename, mimetype='application/json')

@app.route('/api/upload-to-github', methods=['POST'])
def upload_to_github():
    if not session_data['final_config']:
        return jsonify({'success': False, 'message': 'No config available for upload'})
    
    if not session_data['github_client']:
        return jsonify({'success': False, 'message': 'GitHub not configured'})
    
    data = request.json
    commit_message = data.get('commit_message', 'Update VPN configuration')
    
    timestamp = datetime.now().strftime("%Y%m%d-%H%M")
    upload_path = session_data['github_path'] if session_data['github_path'] else f"VortexVpn-{timestamp}.json"
    
    try:
        result = session_data['github_client'].update_or_create_file(
            upload_path, 
            session_data['final_config'], 
            commit_message, 
            session_data['github_sha']
        )
        
        if result:
            return jsonify({'success': True, 'message': f'Successfully uploaded to {upload_path}'})
        else:
            return jsonify({'success': False, 'message': 'Failed to upload to GitHub'})
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error uploading to GitHub: {str(e)}'})

@app.route('/api/get-results')
def get_results():
    return jsonify({
        'results': session_data['test_results'],
        'total_accounts': len(session_data['all_accounts']),
        'has_config': session_data['final_config'] is not None
    })

@app.route('/api/get-testing-status')
def get_testing_status():
    """USER REQUEST: Get current testing status for page refresh persistence"""
    # Check if there are test results that indicate ongoing or completed testing
    if session_data['test_results']:
        # Count completed vs total
        completed = len([r for r in session_data['test_results'] if r['Status'] not in ['WAIT', '🔄', '🔁']])
        total = len(session_data['test_results'])
        
        return jsonify({
            'has_active_testing': True,
            'results': session_data['test_results'],
            'completed': completed,
            'total': total,
            'accounts_count': len(session_data['all_accounts'])
        })
    else:
        return jsonify({
            'has_active_testing': False,
            'accounts_count': len(session_data['all_accounts'])
        })

@app.route('/api/load-template-config')
def load_template_config():
    """USER REQUEST: Load local template configuration"""
    try:
        import os
        template_path = os.path.join(os.getcwd(), 'template.json')
        
        if os.path.exists(template_path):
            with open(template_path, 'r') as f:
                template_config = json.load(f)
            
            # Store in session
            session_data['template_config'] = template_config
            
            return jsonify({
                'success': True,
                'message': 'Template configuration loaded successfully',
                'config': template_config
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Template file not found. Please ensure template.json exists.'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to load template: {str(e)}'
        })

@app.route('/api/get-github-config')
def get_github_config():
    """USER REQUEST: Get saved GitHub config from database for auto-fill"""
    try:
        # Simple file-based storage for GitHub config
        config_file = 'github_config.json'
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                github_config = json.load(f)
            
            # Don't send token for security, just owner (repo editable)
            return jsonify({
                'success': True,
                'owner': github_config.get('owner', ''),
                'repo': github_config.get('repo', ''),
                'has_token': bool(github_config.get('token', ''))
            })
        else:
            return jsonify({
                'success': False,
                'message': 'No saved GitHub configuration found'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to load GitHub config: {str(e)}'
        })

@app.route('/api/save-github-config', methods=['POST'])
def save_github_config():
    """USER REQUEST: Save GitHub config to database with token persistence"""
    try:
        data = request.json
        token = data.get('token', '').strip()
        owner = data.get('owner', '').strip()
        repo = data.get('repo', '').strip()
        
        if not all([token, owner, repo]):
            return jsonify({
                'success': False,
                'message': 'Token, owner, and repo are required'
            })
        
        # Save to simple file storage
        github_config = {
            'token': token,
            'owner': owner,
            'repo': repo
        }
        
        config_file = 'github_config.json'
        with open(config_file, 'w') as f:
            json.dump(github_config, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'GitHub configuration saved successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Failed to save GitHub config: {str(e)}'
        })

@app.route('/api/get-accounts')
def get_accounts():
    """Get all parsed VPN accounts for server replacement"""
    return jsonify({
        'success': True,
        'accounts': session_data['all_accounts'],
        'total': len(session_data['all_accounts'])
    })

@app.route('/api/preview-server-replacement', methods=['POST'])
def preview_server_replacement():
    """Preview server replacement distribution"""
    try:
        data = request.json
        servers_input = data.get('servers', '').strip()
        
        if not servers_input:
            return jsonify({'success': False, 'message': 'No servers provided'})
        
        if not session_data['all_accounts']:
            return jsonify({'success': False, 'message': 'No VPN accounts found'})
        
        # Parse servers (comma or line separated)
        servers = parse_servers_input(servers_input)
        
        # Generate random distribution
        import random
        accounts = session_data['all_accounts'].copy()
        random.shuffle(accounts)
        
        # Calculate distribution
        accounts_per_server = len(accounts) // len(servers)
        remainder = len(accounts) % len(servers)
        
        distribution = {}
        start_idx = 0
        
        for i, server in enumerate(servers):
            # Add extra account to first few servers if there's remainder
            count = accounts_per_server + (1 if i < remainder else 0)
            end_idx = start_idx + count
            
            distribution[server] = accounts[start_idx:end_idx]
            start_idx = end_idx
        
        return jsonify({
            'success': True,
            'distribution': distribution,
            'total_accounts': len(accounts),
            'total_servers': len(servers)
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Preview error: {str(e)}'})

@app.route('/api/apply-server-replacement', methods=['POST'])
def apply_server_replacement():
    """Store custom servers untuk config generation (tidak untuk testing)"""
    try:
        data = request.json
        servers_input = data.get('servers', '').strip()
        
        if not servers_input:
            return jsonify({'success': False, 'message': 'No servers provided'})
        
        if not session_data['all_accounts']:
            return jsonify({'success': False, 'message': 'No VPN accounts found'})
        
        # Parse servers
        servers = parse_servers_input(servers_input)
        
        # Store servers untuk config generation (BUKAN untuk testing)
        session_data['custom_servers'] = servers
        
        print(f"🔄 Stored {len(servers)} custom servers untuk config generation")
        print(f"🔄 Servers: {servers}")
        
        return jsonify({
            'success': True,
            'message': f'Custom servers stored for config generation. Will be applied to {len(session_data["all_accounts"])} accounts when generating final config.',
            'total_accounts': len(session_data['all_accounts']),
            'servers_stored': len(servers),
            'note': 'Servers will be applied only during config generation, not during testing.'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Storage error: {str(e)}'})

def parse_servers_input(servers_input):
    """Parse server input (comma or line separated)"""
    if not servers_input:
        return []
    
    # Try comma separation first
    servers = [s.strip() for s in servers_input.split(',') if s.strip()]
    
    # If only one result, try line separation
    if len(servers) == 1:
        servers = [s.strip() for s in servers_input.split('\n') if s.strip()]
    
    return servers

if __name__ == '__main__':
    load_dotenv()
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)