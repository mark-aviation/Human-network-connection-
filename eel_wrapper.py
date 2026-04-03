"""
THE HUMAN NETWORK — Eel Desktop Wrapper
────────────────────────────────────────────
Wraps the Flask application using Eel for a native desktop window.
Eel is lightweight and uses a simple Python ↔ JS bridge via WebSocket.

Usage:
    python eel_wrapper.py

Requirements:
    pip install Eel flask flask-sqlalchemy
"""

import os
import sys
from pathlib import Path
from threading import Thread
import time
import webbrowser

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    import eel
    from app import create_app
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("Install with: pip install Eel flask flask-sqlalchemy")
    sys.exit(1)


class FlaskEelWrapper:
    """Bridges Flask app with Eel desktop window."""
    
    def __init__(self, host="localhost", port=5000, ui_port=8000):
        self.host = host
        self.port = port
        self.ui_port = ui_port
        self.app = create_app()
        self.flask_thread = None
    
    def run_flask(self):
        """Run Flask app in background thread."""
        self.app.run(host=self.host, port=self.port, debug=False, use_reloader=False)
    
    def run_eel_window(self):
        """Launch Eel desktop window pointing to Flask app."""
        # Initialize Eel
        eel.init(".", allowed_extensions=[".js", ".html", ".css"])
        
        # Expose Python functions to JavaScript
        @eel.expose
        def get_app_version():
            """Python function callable from JavaScript."""
            return "THE HUMAN NETWORK v1.0.0 (Eel Desktop)"
        
        @eel.expose
        def get_config():
            """Expose app config to frontend."""
            return {
                "app_name": "The Human Network",
                "desktop_mode": True,
                "flask_url": f"http://{self.host}:{self.port}",
            }
        
        # Optional: Call JS from Python
        def on_ready():
            print("✅ Desktop window ready!")
            eel.console_log("🚀 Eel Desktop App Loaded!")
        
        try:
            # Start Eel window
            eel.start(
                "index.html",  # Not used in our case since we load via Flask
                mode="chrome",  # or 'edge', 'firefox', 'default'
                host=self.host,
                port=self.ui_port,
                size=(1600, 1000),
                position=(50, 50),
                disable_cache=True,
                cmdline_args=["--disable-web-security"],  # For local dev only
                on_ready=on_ready,
                app_mode=True,
            )
        except Exception as e:
            print(f"⚠️  Eel error: {e}")
            print("Falling back to browser...")
            webbrowser.open(f"http://{self.host}:{self.port}")
    
    def start(self):
        """Start Flask backend and Eel frontend."""
        print("🚀 THE HUMAN NETWORK — Eel Desktop Wrapper")
        print(f"📡 Flask backend: http://{self.host}:{self.port}")
        print("⏩ Starting...")
        
        # Start Flask in background thread
        self.flask_thread = Thread(target=self.run_flask, daemon=True)
        self.flask_thread.start()
        
        # Wait for Flask to be ready
        time.sleep(2)
        
        # Start Eel window (blocking)
        self.run_eel_window()


if __name__ == "__main__":
    wrapper = FlaskEelWrapper()
    wrapper.start()
