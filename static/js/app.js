// Global variables
let socket;
// USER REQUEST: currentSection removed - single page layout only
let isGitHubConfigured = false;
let testResults = [];
let totalAccounts = 0;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Initialize the application
function initializeApp() {
    // Show loading screen briefly for better UX
    setTimeout(() => {
        hideLoadingScreen();
    }, 1000);
    
    // Initialize Socket.IO
    initializeSocket();
    
    // Setup navigation
    // USER REQUEST: Navigation removed - single page layout only
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup form handlers
    setupFormHandlers();
    
    // Load saved GitHub configuration
    loadSavedGitHubConfig();
    
    // Auto-load template configuration
    autoLoadConfiguration();
    
    // USER REQUEST: Check for ongoing testing on page refresh
    checkTestingStatusOnLoad();
    
    // Update status
    updateStatus('Ready', 'success');
}

// USER REQUEST: Check testing status on page load for refresh persistence
async function checkTestingStatusOnLoad() {
    try {
        const response = await fetch('/api/get-testing-status');
        const data = await response.json();
        
        if (data.has_active_testing) {
            console.log('🔄 Found active testing session, restoring...');
            
            // Show testing UI
            showTestingProgress();
            initializeTestingTable();
            
            // Restore results
            updateLiveResults(data.results);
            
            // Update progress
            updateTestingProgress({
                results: data.results,
                total: data.total,
                completed: data.completed
            });
            
            // Reconnect to socket for live updates
            if (socket) {
                console.log('📡 Reconnecting to testing updates...');
            }
            
            // USER REQUEST: Clear textarea after testing starts/resumes
            clearVpnInput();
        }
    } catch (error) {
        console.error('Error checking testing status:', error);
    }
}

// USER REQUEST: Handle setup source change (Template vs GitHub) - Smart detect
function handleSetupSourceChange(event) {
    const selectedSource = event.target.value;
    const githubCard = document.getElementById('github-setup-card');
    const templateCard = document.getElementById('template-status-card');
    
    if (selectedSource === 'github') {
        githubCard.style.display = 'block';
        templateCard.style.display = 'none';
        
        // Load saved GitHub config from database
        loadSavedGitHubConfig();
    } else {
        githubCard.style.display = 'none';
        templateCard.style.display = 'block';
        
        // Show template ready status
        showSetupStatus('Template configuration ready. Start testing to use local template.', 'success');
    }
}

// USER REQUEST: Smart detect - auto-load configuration saat start testing
function getSelectedConfigSource() {
    const selectedRadio = document.querySelector('input[name="setup-source"]:checked');
    return selectedRadio ? selectedRadio.value : 'template';
}

// Load configuration based on selected source
async function loadConfigurationBasedOnSource() {
    const source = getSelectedConfigSource();
    console.log(`🔧 DEBUG: loadConfigurationBasedOnSource called, source=${source}`);
    
    if (source === 'template') {
        // Auto-load template configuration
        console.log('📁 DEBUG: Loading template configuration...');
        try {
            const response = await fetch('/api/load-template-config');
            const data = await response.json();
            console.log('📁 DEBUG: Template response:', data);
            
            if (data.success) {
                console.log('✅ DEBUG: Template configuration loaded automatically');
                return { success: true, source: 'template' };
            } else {
                throw new Error(data.message);
            }
        } catch (error) {
            console.error('❌ DEBUG: Template auto-load error:', error);
            showToast('Template Error', 'Failed to load template configuration', 'error');
            return { success: false, source: 'template', error: error.message };
        }
    } else {
        // Use GitHub configuration (already saved)
        console.log('🐙 DEBUG: Using saved GitHub configuration');
        return { success: true, source: 'github' };
    }
}

// Show setup status message
function showSetupStatus(message, type) {
    const statusCard = document.getElementById('setup-status');
    const statusMessage = document.getElementById('setup-status-message');
    
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusCard.style.display = 'block';
}

// USER REQUEST: Clear VPN input textarea
function clearVpnInput() {
    const textarea = document.getElementById('vpn-links');
    if (textarea) {
        textarea.value = '';
        // Also reset smart detection indicator
        const indicator = document.getElementById('detection-indicator');
        if (indicator) {
            indicator.innerHTML = `
                <span class="detection-icon">🤖</span>
                <span class="detection-text">Ready for smart detection...</span>
            `;
        }
    }
}

// Hide loading screen and show app
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    
    loadingScreen.style.opacity = '0';
    loadingScreen.style.visibility = 'hidden';
    
    app.classList.remove('hidden');
}

// Initialize Socket.IO connection
function initializeSocket() {
    socket = io();
    
    socket.on('connect', function() {
        console.log('Connected to server');
        updateStatus('Connected', 'success');
    });
    
    socket.on('disconnect', function() {
        console.log('Disconnected from server');
        updateStatus('Disconnected', 'error');
    });
    
    socket.on('testing_update', function(data) {
        console.log('🔍 DEBUG: Received testing_update:', data);
        console.log(`🔍 DEBUG: Data contains ${data.results?.length || 0} results, ${data.completed}/${data.total} completed`);
        updateTestingProgress(data);
    });
    
    socket.on('testing_complete', function(data) {
        console.log('Received testing_complete:', data);
        handleTestingComplete(data);
    });
    
    socket.on('config_generated', function(data) {
        handleConfigGenerated(data);
    });
    
    socket.on('testing_error', function(data) {
        showToast('Testing Error', data.message, 'error');
        hideTestingProgress();
    });
}

// USER REQUEST: Navigation functions removed - single page layout only

// Setup all event listeners
function setupEventListeners() {
    // GitHub configuration source radio buttons
    const configSourceRadios = document.querySelectorAll('input[name="config-source"]');
    configSourceRadios.forEach(radio => {
        radio.addEventListener('change', handleConfigSourceChange);
    });
    
    // Filter controls
    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', filterResults);
    }
}

// Setup form handlers
function setupFormHandlers() {
    // USER REQUEST: Setup source options (Template vs GitHub)
    document.querySelectorAll('input[name="setup-source"]').forEach(radio => {
        radio.addEventListener('change', handleSetupSourceChange);
    });
    
    // GitHub setup
    document.getElementById('setup-github-btn').addEventListener('click', setupGitHub);
    
    // Template setup - USER REQUEST: Smart detect, no manual load button
    
    // Add links and test
    document.getElementById('add-and-test-btn').addEventListener('click', addLinksAndTest);
    
    // Smart detection preview
    document.getElementById('vpn-links').addEventListener('input', function() {
        updateSmartDetectionPreview(this.value);
    });
    
    // Input change handler for replacement stats (auto-update)
    document.getElementById('replacement-servers').addEventListener('input', updateReplacementStats);
    
    // Download configuration
    document.getElementById('download-config-btn').addEventListener('click', downloadConfiguration);
    
    // Upload to GitHub
    document.getElementById('upload-github-btn').addEventListener('click', uploadToGitHub);
}

// Handle configuration source change
function handleConfigSourceChange(event) {
    const githubFileSelection = document.getElementById('github-file-selection');
    
    if (event.target.value === 'github') {
        if (isGitHubConfigured) {
            githubFileSelection.classList.remove('hidden');
            loadGitHubFiles();
        } else {
            showToast('GitHub Required', 'Please configure GitHub integration first', 'warning');
            document.querySelector('input[name="config-source"][value="local"]').checked = true;
        }
    } else {
        githubFileSelection.classList.add('hidden');
    }
}

// Update status indicator
function updateStatus(text, type = 'info') {
    const statusText = document.getElementById('status-text');
    const statusDot = document.querySelector('.status-dot');
    
    statusText.textContent = text;
    
    // Remove existing status classes
    statusDot.classList.remove('success', 'error', 'warning', 'info');
    
    // Add new status class
    statusDot.classList.add(type);
    
    // Update CSS custom property for status color
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    statusDot.style.background = colors[type] || colors.info;
}

// Show toast notification
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon"></div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        removeToast(toast);
    }, 5000);
    
    // Click to dismiss
    toast.addEventListener('click', () => {
        removeToast(toast);
    });
}

// Remove toast notification
function removeToast(toast) {
    toast.classList.remove('show');
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

// Set button loading state
function setButtonLoading(buttonId, loading = true) {
    const button = document.getElementById(buttonId);
    const btnText = button.querySelector('.btn-text');
    const btnLoader = button.querySelector('.btn-loader');
    
    if (loading) {
        button.disabled = true;
        btnText.style.opacity = '0';
        btnLoader.classList.remove('hidden');
    } else {
        button.disabled = false;
        btnText.style.opacity = '1';
        btnLoader.classList.add('hidden');
    }
}

// GitHub Integration Functions
async function setupGitHub() {
    const token = document.getElementById('github-token').value.trim();
    const owner = document.getElementById('github-owner').value.trim();
    const repo = document.getElementById('github-repo').value.trim();
    
    if (!token || !owner || !repo) {
        showToast('Missing Information', 'Please fill in all GitHub fields', 'warning');
        return;
    }
    
    setButtonLoading('setup-github-btn', true);
    updateStatus('Configuring GitHub...', 'info');
    
    try {
        // USER REQUEST: Save GitHub config to database
        const response = await fetch('/api/save-github-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token, owner, repo }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateGitHubStatus('Configured');
            showToast('GitHub Saved', 'GitHub configuration saved successfully!', 'success');
            updateStatus('GitHub configuration saved', 'success');
            
            // USER REQUEST: No manual file selection, will auto-detect saat start testing
            showSetupStatus('GitHub configuration saved. Start testing to automatically use GitHub config.', 'success');
        } else {
            updateGitHubStatus('Error');
            showToast('Save Failed', data.message, 'error');
            updateStatus('GitHub save failed', 'error');
        }
    } catch (error) {
        console.error('GitHub setup error:', error);
        updateGitHubStatus('error');
        showToast('Network Error', 'Failed to connect to server', 'error');
        updateStatus('Network error', 'error');
    } finally {
        setButtonLoading('setup-github-btn', false);
    }
}

// Update GitHub status badge
function updateGitHubStatus(status) {
    const badge = document.getElementById('github-status');
    
    badge.classList.remove('success', 'error');
    
    if (status === 'success') {
        badge.textContent = 'Configured';
        badge.classList.add('success');
    } else if (status === 'error') {
        badge.textContent = 'Error';
        badge.classList.add('error');
    } else {
        badge.textContent = 'Not Configured';
    }
}

// Load GitHub files
async function loadGitHubFiles() {
    if (!isGitHubConfigured) return;
    
    const select = document.getElementById('github-files');
    select.innerHTML = '<option value="">Loading...</option>';
    
    try {
        const response = await fetch('/api/list-github-files');
        const data = await response.json();
        
        if (data.success) {
            select.innerHTML = '<option value="">Select a file...</option>';
            data.files.forEach(file => {
                const option = document.createElement('option');
                option.value = file.path;
                option.textContent = file.name;
                select.appendChild(option);
            });
        } else {
            select.innerHTML = '<option value="">Error loading files</option>';
            showToast('Load Error', data.message, 'error');
        }
    } catch (error) {
        console.error('Load GitHub files error:', error);
        select.innerHTML = '<option value="">Network error</option>';
        showToast('Network Error', 'Failed to load GitHub files', 'error');
    }
}

// USER REQUEST: Load saved GitHub configuration from database with auto-fill
async function loadSavedGitHubConfig() {
    try {
        const response = await fetch('/api/get-github-config');
        const data = await response.json();
        
        if (data.success) {
            // Auto-fill owner (from database)
            if (data.owner) {
                document.getElementById('github-owner').value = data.owner;
            }
            
            // Auto-fill repo but keep it editable (USER REQUEST)
            if (data.repo) {
                document.getElementById('github-repo').value = data.repo;
            }
            
            // Show token status without revealing actual token
            if (data.has_token) {
                document.getElementById('github-token').placeholder = 'Token saved (enter new token to update)';
                updateGitHubStatus('Configured');
            } else {
                updateGitHubStatus('Token Required');
            }
        } else {
            console.log('No saved GitHub config found');
            updateGitHubStatus('Not Configured');
        }
    } catch (error) {
        console.error('Error loading GitHub config:', error);
        updateGitHubStatus('Error');
    }
}

// Auto-load configuration on startup
async function autoLoadConfiguration() {
    const requestData = { source: 'local' };
    
    try {
        const response = await fetch('/api/load-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        
        const data = await response.json();
        
        if (data.success) {
            updateStatus('Template loaded', 'success');
            showSetupStatus('Local template loaded successfully', 'success');
        } else {
            updateStatus('Template load failed', 'warning');
            showSetupStatus('Failed to load local template', 'error');
        }
    } catch (error) {
        console.error('Auto-load configuration error:', error);
        updateStatus('Template unavailable', 'warning');
        showSetupStatus('Template file not found', 'error');
    }
}

// Manual configuration loading
async function loadConfiguration() {
    const configSource = document.querySelector('input[name="config-source"]:checked').value;
    let requestData = { source: configSource };
    
    if (configSource === 'github') {
        const filePath = document.getElementById('github-files').value;
        if (!filePath) {
            showToast('File Required', 'Please select a GitHub file', 'warning');
            return;
        }
        requestData.file_path = filePath;
    }
    
    setButtonLoading('load-config-btn', true);
    updateStatus('Loading configuration...', 'info');
    
    try {
        const response = await fetch('/api/load-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Success', data.message, 'success');
            updateStatus('Configuration loaded', 'success');
            showSetupStatus(data.message, 'success');
        } else {
            showToast('Load Failed', data.message, 'error');
            updateStatus('Load failed', 'error');
            showSetupStatus(data.message, 'error');
        }
    } catch (error) {
        console.error('Load configuration error:', error);
        showToast('Network Error', 'Failed to load configuration', 'error');
        updateStatus('Network error', 'error');
        showSetupStatus('Network error occurred', 'error');
    } finally {
        setButtonLoading('load-config-btn', false);
    }
}

// Show setup status message
function showSetupStatus(message, type) {
    const statusCard = document.getElementById('setup-status');
    const statusMessage = document.getElementById('setup-status-message');
    
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusCard.style.display = 'block';
}

// Smart detection preview
function updateSmartDetectionPreview(text) {
    const indicator = document.getElementById('detection-indicator');
    const iconSpan = indicator.querySelector('.detection-icon');
    const textSpan = indicator.querySelector('.detection-text');
    
    if (!text.trim()) {
        iconSpan.textContent = '🤖';
        textSpan.textContent = 'Ready for smart detection...';
        return;
    }
    
    // Simple client-side detection preview
    const vpnPattern = /(?:vless|vmess|trojan|ss):\/\/[^\s]+/g;
    const vpnMatches = text.match(vpnPattern) || [];
    
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urlMatches = text.match(urlPattern) || [];
    
    if (vpnMatches.length > 0) {
        iconSpan.textContent = '🔗';
        textSpan.textContent = `Detected ${vpnMatches.length} VPN link${vpnMatches.length > 1 ? 's' : ''} - Ready to parse!`;
    } else if (urlMatches.length === 1) {
        iconSpan.textContent = '🌐';
        textSpan.textContent = `Detected single URL - Will auto-fetch VPN links`;
    } else if (urlMatches.length > 1) {
        iconSpan.textContent = '📚';
        textSpan.textContent = `Detected ${urlMatches.length} URLs - Will fetch from all sources`;
    } else {
        iconSpan.textContent = '❓';
        textSpan.textContent = 'No VPN links or URLs detected yet...';
    }
}

// Add links and start testing - USER REQUEST: Smart detect config source
async function addLinksAndTest() {
    const inputText = document.getElementById('vpn-links').value.trim();
    
    if (!inputText) {
        showToast('No Input', 'Please paste VPN links or URLs', 'warning');
        return;
    }
    
    setButtonLoading('add-and-test-btn', true);
    updateStatus('🤖 Smart processing input...', 'info');
    
    // USER REQUEST: Smart detect dan auto-load configuration
    console.log('🔧 DEBUG: Loading configuration based on source...');
    const configResult = await loadConfigurationBasedOnSource();
    console.log('🔧 DEBUG: Config result:', configResult);
    
    if (!configResult.success) {
        console.log('❌ DEBUG: Configuration load failed:', configResult);
        setButtonLoading('add-and-test-btn', false);
        updateStatus('Configuration load failed', 'error');
        return;
    }
    
    console.log(`✅ DEBUG: Using ${configResult.source} configuration for testing`);
    
    try {
        const response = await fetch('/api/add-links-and-test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                links: inputText
            }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Success', data.message, 'success');
            updateStatus('Starting tests...', 'info');
            
            // Update account counts
            totalAccounts = data.total_accounts;
            document.getElementById('total-accounts').textContent = totalAccounts;
            document.getElementById('test-status').textContent = '🔄';
            
            // Load parsed accounts for server replacement
            await loadParsedAccounts();
            
            // Show quick stats
            document.getElementById('quick-stats').style.display = 'block';
            
            // Clear the textarea and reset detection
            document.getElementById('vpn-links').value = '';
            updateSmartDetectionPreview('');
            
            if (data.invalid_links.length > 0) {
                showToast('Some Invalid Links', `${data.invalid_links.length} links could not be parsed`, 'warning');
            }
            
            // USER REQUEST: Single page layout - no section switching needed, start testing directly
            startTesting();
            
        } else {
            showToast('Add Failed', data.message, 'error');
            updateStatus('Add failed', 'error');
        }
    } catch (error) {
        console.error('Add links error:', error);
        showToast('Network Error', 'Failed to add links', 'error');
        updateStatus('Network error', 'error');
    } finally {
        setButtonLoading('add-and-test-btn', false);
    }
}

// Update account counts and statistics
async function updateAccountCounts() {
    try {
        const response = await fetch('/api/get-results');
        const data = await response.json();
        
        totalAccounts = data.total_accounts;
        
        // Update UI
        document.getElementById('total-accounts').textContent = totalAccounts;
        document.getElementById('test-total').textContent = totalAccounts;
        
        // Count by type (this would need to be implemented in the backend)
        // For now, we'll just show the total
        document.getElementById('vless-count').textContent = '—';
        document.getElementById('trojan-count').textContent = '—';
        document.getElementById('ss-count').textContent = '—';
        
    } catch (error) {
        console.error('Update account counts error:', error);
    }
}

// Log activity
function logActivity(message) {
    const activityCard = document.getElementById('recent-activity');
    const activityLog = document.getElementById('activity-log');
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = 'activity-entry';
    logEntry.innerHTML = `
        <span class="activity-time">${timestamp}</span>
        <span class="activity-message">${message}</span>
    `;
    
    activityLog.insertBefore(logEntry, activityLog.firstChild);
    activityCard.style.display = 'block';
    
    // Keep only last 10 entries
    while (activityLog.children.length > 10) {
        activityLog.removeChild(activityLog.lastChild);
    }
}

// Testing Functions
function startTesting() {
    console.log(`🔍 DEBUG: startTesting called, totalAccounts=${totalAccounts}`);
    
    if (totalAccounts === 0) {
        console.log('❌ DEBUG: No accounts found, stopping');
        showToast('No Accounts', 'Please add some VPN accounts first', 'warning');
        return;
    }
    
    console.log('✅ DEBUG: Starting testing process...');
    updateStatus('Starting tests...', 'info');
    
    showTestingProgress();
    
    // Start testing via Socket.IO
    console.log('📡 DEBUG: Emitting start_testing to backend...');
    socket.emit('start_testing');
    console.log('📡 DEBUG: start_testing emitted successfully');
}

// Show testing progress UI
function showTestingProgress() {
    document.getElementById('testing-progress').style.display = 'block';
    document.getElementById('live-results').style.display = 'block';
    
    // Reset progress
    updateProgressBar(0);
    updateTestStats(0, 0, 0);
    
    // Initialize table with empty rows to show structure
    initializeTestingTable();
}

// Global tracking for progressive table display
let displayedAccountsCount = 0;
let globalTestOrder = new Map(); // Maps result ID to global display order

// Initialize testing table (USER REQUEST: Empty table, show accounts as they are tested)
function initializeTestingTable() {
    const tableBody = document.getElementById('testing-table-body');
    if (!tableBody) return;
    
    // USER REQUEST: Start with empty table, populate as tests progress
    tableBody.innerHTML = '';
    displayedAccountsCount = 0;
    globalTestOrder.clear();
    
    console.log('🔄 Initialized empty testing table - accounts will appear as they are tested');
}

// Hide testing progress UI
function hideTestingProgress() {
    updateStatus('Testing stopped', 'warning');
}

// Update testing progress
function updateTestingProgress(data) {
    console.log('🔍 DEBUG: updateTestingProgress called with:', data); // Debug log
    
    if (!data || !data.results) {
        console.error('❌ DEBUG: Invalid data received:', data);
        return;
    }
    
    console.log(`🔍 DEBUG: Processing ${data.results.length} results`);
    
    // Better status detection - exclude only pending states
    const pendingStates = ['WAIT', '🔄', '🔁'];
    const completed = data.results.filter(r => !pendingStates.includes(r.Status)).length;
    const total = data.total || data.results.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    updateProgressBar(percentage);
    
    // Update progress text
    document.getElementById('progress-text').textContent = `${completed} / ${total} accounts tested`;
    document.getElementById('progress-percent').textContent = `${percentage}%`;
    
    // Count stats - use emoji status
    const successful = data.results.filter(r => r.Status === '✅' || r.Status === '●').length;
    const failed = data.results.filter(r => r.Status === '❌' || r.Status.startsWith('✖')).length;
    const testing = data.results.filter(r => pendingStates.includes(r.Status)).length;
    
    updateTestStats(successful, failed, testing);
    
    // Update live results table
    updateLiveResults(data.results);
    
    updateStatus(`Testing... ${completed}/${total}`, 'info');
}

// Handle testing completion
function handleTestingComplete(data) {
    console.log('🎯 DEBUG: handleTestingComplete called with:', data);
    
    updateStatus(`Testing complete: ${data.successful}/${data.total} successful`, 'success');
    
    showToast('Testing Complete', `${data.successful} out of ${data.total} accounts passed`, 'success');
    
    testResults = data.results;
    
    // USER FIX: Update results section with both summary and detailed view
    updateResultsSummary(data);
    displayDetailedResults(data.results);
    
    console.log('📊 DEBUG: Results section populated with summary and detailed view');
    
    // Update test status
    document.getElementById('test-status').textContent = data.successful > 0 ? '✅' : '❌';
    
    // Show notification for auto-generated config
    if (data.successful > 0) {
        document.getElementById('config-notification').style.display = 'block';
    }
}

// Handle auto-generated configuration - dengan custom servers auto-apply
async function handleConfigGenerated(data) {
    if (data.success) {
        // Auto-apply custom servers jika ada
        const customServers = getCustomServersForConfig();
        
        if (customServers) {
            console.log('Auto-applying custom servers:', customServers);
            updateReplacementStatus('Auto-applying...');
            
            try {
                // Generate config dengan custom servers
                const response = await fetch('/api/generate-config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ custom_servers: customServers }),
                });
                
                const configData = await response.json();
                
                if (configData.success) {
                    updateReplacementStatus(`Applied ${configData.custom_servers_used} servers`);
                    showToast('Config with Custom Servers', 
                        `Configuration generated with ${configData.account_count} accounts using ${configData.custom_servers_used} custom servers`, 
                        'success');
                } else {
                    updateReplacementStatus('Error');
                    console.error('Failed to apply custom servers:', configData.message);
                }
            } catch (error) {
                updateReplacementStatus('Error');
                console.error('Error applying custom servers:', error);
            }
        } else {
            showToast('Config Generated', `Configuration auto-generated with ${data.account_count} accounts`, 'success');
        }
        
        // Update export section
        document.getElementById('config-account-count').textContent = data.account_count;
        document.getElementById('config-timestamp').textContent = new Date().toLocaleTimeString();
        document.getElementById('config-badge').textContent = customServers ? 'Auto-Generated (Custom Servers)' : 'Auto-Generated';
        
        // Enable GitHub upload if configured
        if (isGitHubConfigured) {
            document.getElementById('github-upload-status').textContent = 'Ready';
            document.getElementById('github-upload-status').classList.add('success');
        }
    } else {
        showToast('Config Generation Failed', data.error, 'error');
    }
}

// Update progress bar
function updateProgressBar(percentage) {
    document.getElementById('progress-fill').style.width = `${percentage}%`;
}

// Update test statistics
function updateTestStats(successful, failed, testing) {
    document.getElementById('successful-count').textContent = successful;
    document.getElementById('failed-count').textContent = failed;
    document.getElementById('testing-count').textContent = testing;
}

// Update live results display (USER REQUEST: Progressive table, show accounts as tested)
function updateLiveResults(results) {
    console.log(`🔍 DEBUG: updateLiveResults called with ${results?.length || 0} results`);
    
    const tableBody = document.getElementById('testing-table-body');
    if (!tableBody) {
        console.error('❌ DEBUG: Table body not found');
        return;
    }
    
    if (!results || !Array.isArray(results)) {
        console.error('❌ DEBUG: Invalid results data:', results);
        return;
    }
    
    console.log('🔍 DEBUG: Table body found, processing results...');
    
    // USER REQUEST: Progressive display - backend already filtered, process all received results
    results.forEach((result, backendIndex) => {
        // USER REQUEST: Use result.index as primary ID for consistency
        const resultId = `account_${result.index !== undefined ? result.index : backendIndex}`;
        
        console.log(`🔍 DEBUG: Processing account ${result.index}: Status="${result.Status}", resultId="${resultId}"`);
        
        // Backend already filtered - all received results should be displayed
        // Assign global display order if not already assigned
        if (!globalTestOrder.has(resultId)) {
            displayedAccountsCount++;
            globalTestOrder.set(resultId, displayedAccountsCount);
            
            // USER REQUEST: Add new row when account starts testing
            console.log(`🆕 DEBUG: Adding NEW account ${displayedAccountsCount} to table (index ${result.index})`);
            console.log('🔍 DEBUG: Account data:', result);
            addNewTestingRow(result, displayedAccountsCount);
        } else {
            // Update existing row
            const displayOrder = globalTestOrder.get(resultId);
            console.log(`🔄 DEBUG: Updating EXISTING row ${displayOrder} (index ${result.index})`);
            updateExistingTestingRow(result, displayOrder);
        }
    });
}

// Add new testing row (USER REQUEST: Show account when testing starts)
function addNewTestingRow(result, displayOrder) {
    const tableBody = document.getElementById('testing-table-body');
    const row = document.createElement('tr');
    row.id = `testing-row-${displayOrder}`;
    row.className = 'testing-row-new'; // For animation
    
    // Start with testing status
    const rowHtml = createTestingRowHtml(result, displayOrder, true);
    row.innerHTML = rowHtml;
    
    tableBody.appendChild(row);
    
    // Add slide-in animation
    setTimeout(() => {
        row.classList.add('testing-row-visible');
    }, 100);
}

// Update existing testing row
function updateExistingTestingRow(result, displayOrder) {
    const row = document.getElementById(`testing-row-${displayOrder}`);
    if (!row) {
        console.warn(`Row not found for displayOrder ${displayOrder}`);
        return;
    }
    
    // USER REQUEST: Fix detection of completed tests
    const completedStates = ['✅', '●', 'Success', '❌', 'Failed', 'Dead', 'Timeout'];
    const isComplete = completedStates.some(state => result.Status.includes(state)) || 
                      (!result.Status.includes('Testing') && !result.Status.includes('Retry') && !result.Status.includes('🔄'));
    
    console.log(`Updating row ${displayOrder}: Status="${result.Status}", isComplete=${isComplete}, Data:`, result);
    
    const rowHtml = createTestingRowHtml(result, displayOrder, !isComplete);
    row.innerHTML = rowHtml;
    
    // Add completion animation if test is done
    if (isComplete) {
        row.classList.add('testing-row-completed');
        console.log(`✅ Row ${displayOrder} marked as completed`);
    }
}

// Create testing table row HTML (USER REQUEST: Simplified latency, animated status)
function createTestingRowHtml(result, displayOrder, isActive = false) {
    const safeResult = {
        Status: result.Status || 'WAIT',
        VpnType: result.VpnType || result.type || 'N/A',
        Country: result.Country || '❓',
        Provider: result.Provider || '-',
        'Tested IP': result['Tested IP'] || result.server || '-',
        Latency: result.Latency || -1,
        Jitter: result.Jitter || -1,
        ICMP: result.ICMP || 'N/A'
    };
    
    // USER REQUEST: Simplified latency format (no long decimals)
    const latencyText = formatLatency(safeResult.Latency);
    const jitterText = formatLatency(safeResult.Jitter);
    
    // USER REQUEST: Animated status dot
    const statusHtml = createAnimatedStatus(safeResult.Status, isActive);
    
    return `
        <td class="order-cell">${displayOrder}</td>
        <td class="type-cell">${safeResult.VpnType}</td>
        <td class="country-cell">${safeResult.Country}</td>
        <td class="provider-cell">${safeResult.Provider}</td>
        <td class="ip-cell">${safeResult['Tested IP']}</td>
        <td class="latency-cell">${latencyText}</td>
        <td class="jitter-cell">${jitterText}</td>
        <td class="icmp-cell">${safeResult.ICMP}</td>
        <td class="status-cell">${statusHtml}</td>
    `;
}

// USER REQUEST: Format latency to be simple (no long decimals) + handle timeout/dead
function formatLatency(latency) {
    if (latency === -1 || latency === null || latency === undefined) {
        return '—';
    }
    
    // Handle special timeout/dead cases
    if (typeof latency === 'string') {
        if (latency.toLowerCase().includes('timeout')) {
            return 'Timeout';
        }
        if (latency.toLowerCase().includes('dead') || latency.toLowerCase().includes('unreachable')) {
            return 'Dead';
        }
        if (latency.toLowerCase().includes('failed') || latency.toLowerCase().includes('error')) {
            return 'Failed';
        }
    }
    
    const numLatency = parseFloat(latency);
    if (isNaN(numLatency)) return '—';
    
    // Round to whole number for clean display
    return `${Math.round(numLatency)}ms`;
}

// USER REQUEST: Minimalist status with dots only (no text for cleaner UI)
function createAnimatedStatus(status, isActive) {
    if (status.includes('Testing') || status.includes('Retry') || isActive) {
        return `<span class="status-dot testing-dot" title="Testing..."></span>`;
    } else if (status.includes('Timeout Retry')) {
        // USER REQUEST: Show retry progress for timeout (dot only with tooltip)
        const retryMatch = status.match(/Timeout Retry (\d+)\/(\d+)/);
        const retryText = retryMatch ? retryMatch[0] : 'Retrying...';
        return `<span class="status-dot retry-dot" title="${retryText}"></span>`;
    } else if (status === '●' || status === '✅' || status.includes('Success')) {
        return `<span class="status-dot success-dot" title="Success"></span>`;
    } else if (status.includes('Timeout') || status.includes('timeout')) {
        return `<span class="status-dot timeout-dot" title="Timeout"></span>`;
    } else if (status.includes('Dead') || status.includes('dead') || status.includes('unreachable')) {
        return `<span class="status-dot dead-dot" title="Dead"></span>`;
    } else if (status.startsWith('✖') || status.includes('Failed') || status.includes('Error') || status.includes('failed')) {
        return `<span class="status-dot failed-dot" title="Failed"></span>`;
    } else {
        return `<span class="status-dot waiting-dot" title="Waiting"></span>`;
    }
}

// Create testing table row (LEGACY - keeping for compatibility)
function createTestingTableRow(result, index) {
    const row = document.createElement('tr');
    
    // Make sure we have valid data
    const safeResult = {
        Status: result.Status || 'WAIT',
        VpnType: result.VpnType || result.type || 'N/A',
        Country: result.Country || '❓',
        Provider: result.Provider || '-',
        'Tested IP': result['Tested IP'] || result.server || '-',
        Latency: result.Latency || -1,
        Jitter: result.Jitter || -1,
        ICMP: result.ICMP || 'N/A'
    };
    
    const statusText = getStatusText(safeResult.Status);
    const statusClass = getStatusClass(safeResult.Status);
    const latencyText = safeResult.Latency !== -1 ? `${safeResult.Latency}ms` : '—';
    const jitterText = safeResult.Jitter !== -1 ? `${safeResult.Jitter}ms` : '—';
    
    row.innerHTML = `
        <td>${index + 1}</td>
        <td class="type-cell">${safeResult.VpnType}</td>
        <td>${safeResult.Country}</td>
        <td>${safeResult.Provider}</td>
        <td>${safeResult['Tested IP']}</td>
        <td class="latency-cell">${latencyText}</td>
        <td class="latency-cell">${jitterText}</td>
        <td class="status-cell">${safeResult.ICMP}</td>
        <td class="status-cell ${statusClass}">${statusText}</td>
    `;
    
    return row;
}

// Get CSS class for status
function getStatusClass(status) {
    if (status === '●') return 'status-success';
    if (status.startsWith('✖')) return 'status-failed';
    if (status.startsWith('Testing') || status.startsWith('Retry')) return 'status-testing';
    return 'status-waiting';
}

// Get status text for display
function getStatusText(status) {
    // Handle both old and new status formats
    if (status === '●' || status === '✅') return '✅';
    if (status.startsWith('✖') || status === '❌') return '❌';
    if (status.startsWith('Testing') || status === '🔄') return '🔄';
    if (status.startsWith('Retry') || status === '🔁') return '🔁';
    if (status === 'WAIT' || status === '⏳') return '⏳';
    return status;
}

// Results Functions
async function loadResults() {
    try {
        const response = await fetch('/api/get-results');
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            testResults = data.results;
            displayDetailedResults(data.results);
            updateResultsSummary(data);
            
            if (data.has_config) {
                showExportOptions();
            }
        }
    } catch (error) {
        console.error('Load results error:', error);
    }
}

// Update results summary
function updateResultsSummary(data) {
    console.log('🔍 DEBUG: updateResultsSummary called with:', data);
    
    // USER FIX: Use correct status symbols ✅ and ❌
    const successful = data.results.filter(r => r.Status === '✅').length;
    const failed = data.results.filter(r => r.Status === '❌' || r.Status === 'Dead').length;
    
    console.log(`📊 DEBUG: Results summary - ${successful} successful, ${failed} failed`);
    
    // Calculate average latency
    const successfulResults = data.results.filter(r => r.Status === '✅' && r.Latency !== -1);
    const avgLatency = successfulResults.length > 0 
        ? Math.round(successfulResults.reduce((sum, r) => sum + r.Latency, 0) / successfulResults.length)
        : 0;
    
    document.getElementById('summary-successful').textContent = successful;
    document.getElementById('summary-failed').textContent = failed;
    document.getElementById('summary-avg-latency').textContent = `${avgLatency}ms`;
    
    document.getElementById('results-summary').style.display = 'block';
    document.getElementById('detailed-results').style.display = 'block';
}

// Display detailed results
function displayDetailedResults(results) {
    const container = document.getElementById('results-table');
    container.innerHTML = '';
    
    if (results.length === 0) {
        container.innerHTML = '<p>No results available</p>';
        return;
    }
    
    // Create table
    const table = document.createElement('div');
    table.className = 'results-table';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'result-header';
    header.innerHTML = `
        <div>Status</div>
        <div>Location</div>
        <div>Type</div>
        <div>Latency</div>
        <div>IP</div>
    `;
    table.appendChild(header);
    
    // Add results
    results.forEach(result => {
        const row = createDetailedResultRow(result);
        table.appendChild(row);
    });
    
    container.appendChild(table);
}

// Create detailed result row
function createDetailedResultRow(result) {
    const row = document.createElement('div');
    row.className = 'result-row';
    
    const statusClass = getStatusClass(result.Status);
    const latencyText = result.Latency !== -1 ? `${result.Latency}ms` : '—';
    
    row.innerHTML = `
        <div class="result-status ${statusClass}"></div>
        <div>${result.Country} ${result.Provider}</div>
        <div>${result.VpnType.toUpperCase()}</div>
        <div>${latencyText}</div>
        <div>${result['Tested IP']}</div>
    `;
    
    return row;
}

// Filter results
function filterResults() {
    const filterValue = document.getElementById('filter-status').value;
    let filteredResults = testResults;
    
    if (filterValue === 'successful') {
        filteredResults = testResults.filter(r => r.Status === '●');
    } else if (filterValue === 'failed') {
        filteredResults = testResults.filter(r => r.Status.startsWith('✖'));
    }
    
    displayDetailedResults(filteredResults);
}

// Export Functions (Auto-generated, so no manual generation needed)

async function downloadConfiguration() {
    updateStatus('Downloading configuration...', 'info');
    
    try {
        const response = await fetch('/api/download-config');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = response.headers.get('Content-Disposition')?.split('filename=')[1] || 'VortexVpn-config.json';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showToast('Success', 'Configuration downloaded', 'success');
            updateStatus('Download complete', 'success');
            logActivity('Configuration downloaded');
        } else {
            const data = await response.json();
            showToast('Download Failed', data.message, 'error');
        }
    } catch (error) {
        console.error('Download error:', error);
        showToast('Network Error', 'Failed to download configuration', 'error');
        updateStatus('Download error', 'error');
    }
}

async function uploadToGitHub() {
    const commitMessage = document.getElementById('commit-message').value.trim();
    
    if (!commitMessage) {
        showToast('Commit Message Required', 'Please enter a commit message', 'warning');
        return;
    }
    
    setButtonLoading('upload-github-btn', true);
    updateStatus('Uploading to GitHub...', 'info');
    
    try {
        const response = await fetch('/api/upload-to-github', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ commit_message: commitMessage }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Success', data.message, 'success');
            updateStatus('Upload complete', 'success');
            logActivity('Configuration uploaded to GitHub');
        } else {
            showToast('Upload Failed', data.message, 'error');
            updateStatus('Upload failed', 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showToast('Network Error', 'Failed to upload to GitHub', 'error');
        updateStatus('Upload error', 'error');
    } finally {
        setButtonLoading('upload-github-btn', false);
    }
}

// Mobile-specific enhancements
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/static/sw.js')
            .then(function(registration) {
                console.log('ServiceWorker registration successful');
            })
            .catch(function(err) {
                console.log('ServiceWorker registration failed');
            });
    });
}

// Handle mobile back button
window.addEventListener('popstate', function(event) {
    // Handle navigation history
});

// Handle orientation change
window.addEventListener('orientationchange', function() {
    setTimeout(() => {
        // Refresh layout if needed
    }, 100);
});

// Touch gestures for better mobile UX
let touchStartY = 0;
let touchEndY = 0;

document.addEventListener('touchstart', function(event) {
    touchStartY = event.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', function(event) {
    touchEndY = event.changedTouches[0].screenY;
    handleGesture();
}, { passive: true });

function handleGesture() {
    const threshold = 50;
    const diff = touchStartY - touchEndY;
    
    if (Math.abs(diff) > threshold) {
        // Handle swipe gestures if needed
    }
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Manual test function untuk debug
function testTableDisplay() {
    console.log('Testing table display with sample data...');
    
    const sampleData = {
        results: [
            {
                index: 0,
                VpnType: 'vless',
                type: 'vless',
                Country: '🇸🇬 Singapore',
                Provider: 'CloudFlare',
                'Tested IP': '1.1.1.1',
                server: 'demo.example.com',
                Latency: 25,
                Jitter: 2,
                ICMP: '✔',
                Status: '●'
            },
            {
                index: 1,
                VpnType: 'trojan',
                type: 'trojan',
                Country: '🇯🇵 Japan',
                Provider: 'Tokyo Server',
                'Tested IP': '8.8.8.8',
                server: 'demo2.example.com',
                Latency: 45,
                Jitter: 5,
                ICMP: '✔',
                Status: 'Testing...'
            },
            {
                index: 2,
                VpnType: 'shadowsocks',
                type: 'shadowsocks',
                Country: '❓',
                Provider: '-',
                'Tested IP': '-',
                server: 'demo3.example.com',
                Latency: -1,
                Jitter: -1,
                ICMP: 'N/A',
                Status: 'WAIT'
            }
        ],
        total: 3,
        completed: 1
    };
    
    updateTestingProgress(sampleData);
}

// Make it globally accessible for testing
window.testTableDisplay = testTableDisplay;

// ========================================
// SERVER REPLACEMENT FUNCTIONALITY
// ========================================

// Global variable for parsed VPN accounts
let parsedVpnAccounts = [];

// Load parsed VPN accounts from backend
async function loadParsedAccounts() {
    try {
        const response = await fetch('/api/get-accounts');
        const data = await response.json();
        
        if (data.success) {
            parsedVpnAccounts = data.accounts;
            console.log(`Loaded ${parsedVpnAccounts.length} VPN accounts for server replacement`);
        }
    } catch (error) {
        console.error('Error loading parsed accounts:', error);
    }
}

// Update replacement stats when servers input changes
function updateReplacementStats() {
    const serversInput = document.getElementById('replacement-servers').value.trim();
    const replacementStats = document.getElementById('replacement-stats');
    const statusBadge = document.getElementById('server-replace-status');
    
    if (!serversInput) {
        replacementStats.style.display = 'none';
        statusBadge.textContent = 'Ready';
        statusBadge.className = 'badge';
        return;
    }
    
    // Parse servers (comma or line separated)
    const servers = parseServerInput(serversInput);
    
    // Update stats display
    document.getElementById('total-vpn-accounts').textContent = parsedVpnAccounts.length || 0;
    document.getElementById('total-servers').textContent = servers.length;
    document.getElementById('accounts-per-server').textContent = parsedVpnAccounts.length ? 
        `~${Math.ceil(parsedVpnAccounts.length / servers.length)}` : '0';
    
    replacementStats.style.display = 'block';
    statusBadge.textContent = `${servers.length} servers ready`;
    statusBadge.className = 'badge badge-info';
}

// Parse server input (comma or line separated)
function parseServerInput(input) {
    if (!input) return [];
    
    // Try comma separation first
    let servers = input.split(',').map(s => s.trim()).filter(s => s);
    
    // If only one result, try line separation
    if (servers.length === 1) {
        servers = input.split('\n').map(s => s.trim()).filter(s => s);
    }
    
    return servers;
}

// Auto-apply custom servers saat config generation
function getCustomServersForConfig() {
    const serversInput = document.getElementById('replacement-servers').value.trim();
    return serversInput || '';
}

// Update replacement status badge
function updateReplacementStatus(status) {
    const statusBadge = document.getElementById('server-replace-status');
    statusBadge.textContent = status;
    statusBadge.className = 'badge badge-success';
}

// Add CSS for dynamic elements
const dynamicStyles = document.createElement('style');
dynamicStyles.textContent = `
    .activity-entry {
        display: flex;
        justify-content: space-between;
        padding: var(--space-sm);
        border-bottom: 1px solid var(--border-primary);
        font-size: var(--font-size-sm);
    }
    
    .activity-time {
        color: var(--text-muted);
        font-size: var(--font-size-xs);
    }
    
    .activity-message {
        color: var(--text-secondary);
    }
    
    .results-table {
        display: flex;
        flex-direction: column;
    }
    
    .result-header,
    .result-row {
        display: grid;
        grid-template-columns: auto 2fr 1fr 1fr 1.5fr;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        align-items: center;
        border-bottom: 1px solid var(--border-primary);
    }
    
    .result-header {
        background: var(--bg-primary);
        font-weight: 600;
        font-size: var(--font-size-sm);
        color: var(--text-primary);
    }
    
    .result-row {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
    }
    
    .result-row:hover {
        background: var(--bg-primary);
    }
    
    .status-message {
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border-left: 4px solid;
    }
    
    .status-message.success {
        background: rgba(16, 185, 129, 0.1);
        border-color: var(--success);
        color: var(--success);
    }
    
    .status-message.error {
        background: rgba(239, 68, 68, 0.1);
        border-color: var(--error);
        color: var(--error);
    }
    
    @media (max-width: 768px) {
        .result-header,
        .result-row {
            grid-template-columns: auto 1fr auto;
        }
        
        .result-header div:nth-child(3),
        .result-header div:nth-child(5),
        .result-row div:nth-child(3),
        .result-row div:nth-child(5) {
            display: none;
        }
    }
`;

document.head.appendChild(dynamicStyles);
