import sqlite3
import json
import os
from pathlib import Path

DB_FILE = "vortexvpn.db"

def init_db():
    """Initialize the local database."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Create settings table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create test_sessions table for storing test results
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS test_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def save_setting(key, value):
    """Save a setting to the database."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
    ''', (key, str(value)))
    
    conn.commit()
    conn.close()

def get_setting(key, default=None):
    """Get a setting from the database."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
    result = cursor.fetchone()
    
    conn.close()
    
    if result:
        try:
            # Try to parse as JSON first
            return json.loads(result[0])
        except:
            # Return as string if not JSON
            return result[0]
    
    return default

def save_github_config(token, owner, repo):
    """Save GitHub configuration."""
    config = {
        'token': token,
        'owner': owner,
        'repo': repo
    }
    save_setting('github_config', json.dumps(config))

def get_github_config():
    """Get GitHub configuration."""
    config = get_setting('github_config')
    # get_setting already parses JSON, so just return it
    return config

def save_test_session(results_data):
    """Save test session results."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO test_sessions (session_data)
        VALUES (?)
    ''', (json.dumps(results_data),))
    
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return session_id

def get_latest_test_session():
    """Get the latest test session."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT session_data FROM test_sessions 
        ORDER BY created_at DESC LIMIT 1
    ''')
    result = cursor.fetchone()
    
    conn.close()
    
    if result:
        try:
            return json.loads(result[0])
        except:
            return None
    return None

# Initialize database on import
init_db()