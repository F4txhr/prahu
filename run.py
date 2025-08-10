#!/usr/bin/env python3
"""
VortexVPN Manager - Web Interface
Simple startup script for the VPN configuration manager.
"""

import os
import sys
import subprocess
import webbrowser
from pathlib import Path

def check_requirements():
    """Check if all required files exist."""
    required_files = [
        'app.py',
        'template.json',
        'requirements.txt',
        'templates/index.html',
        'static/css/style.css',
        'static/js/app.js'
    ]
    
    missing_files = []
    for file_path in required_files:
        if not Path(file_path).exists():
            missing_files.append(file_path)
    
    if missing_files:
        print("❌ Missing required files:")
        for file in missing_files:
            print(f"   - {file}")
        print("\nPlease ensure all files are in the correct locations.")
        return False
    
    return True

def install_dependencies():
    """Install required Python packages."""
    print("📦 Installing dependencies...")
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
        print("✅ Dependencies installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install dependencies: {e}")
        return False

def start_application():
    """Start the VortexVPN web application."""
    print("\n🚀 Starting VortexVPN Manager...")
    print("📱 Optimized for mobile and Android devices")
    print("🌐 Web interface will be available at:")
    print("   - Local: http://localhost:5000")
    print("   - Network: http://your-ip:5000 (for mobile access)")
    print("\n⏹️  Press Ctrl+C to stop the server")
    print("=" * 50)
    
    # Open browser automatically (optional)
    try:
        webbrowser.open('http://localhost:5000')
    except:
        pass
    
    # Start the Flask application
    try:
        from app import app, socketio
        socketio.run(app, debug=False, host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        print("\n\n🛑 Application stopped by user")
    except Exception as e:
        print(f"\n❌ Application error: {e}")
        print("Please check the troubleshooting section in README.md")

def main():
    """Main startup function."""
    print("🌪️  VortexVPN Manager - Web Interface")
    print("=" * 50)
    
    # Check if all required files exist
    if not check_requirements():
        return 1
    
    # Install dependencies if needed
    try:
        import flask
        import flask_socketio
        print("✅ Dependencies already installed")
    except ImportError:
        if not install_dependencies():
            return 1
    
    # Start the application
    start_application()
    return 0

if __name__ == '__main__':
    sys.exit(main())