"""
THE HUMAN NETWORK — PyWebView Desktop Wrapper
──────────────────────────────────────────────
Wraps the Flask application using PyWebView for a native desktop window.
PyWebView provides a more native UI feel with WebKit/CEF rendering.

Usage:
    python pywebview_wrapper.py

Requirements:
    pip install pywebview flask flask-sqlalchemy
"""

import os
import sys
from pathlib import Path
from threading import Thread
import time

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    import webview
    from app import create_app
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("Install with: pip install pywebview flask flask-sqlalchemy")
    sys.exit(1)


class FlaskPyWebViewWrapper:
    """Bridges Flask app with PyWebView native window."""
    
    def __init__(self, host="localhost", port=5000, title="The Human Network"):
        self.host = host
        self.port = port
        self.title = title
        self.app = create_app()
        self.flask_thread = None
        self.webview = None
    
    def run_flask(self):
        """Run Flask app in background thread."""
        self.app.run(host=self.host, port=self.port, debug=False, use_reloader=False)
    
    def expose_python_functions(self):
        """Expose Python functions to JavaScript via PyWebView JS bridge."""
        class API:
            def __init__(self, wrapper):
                self.wrapper = wrapper
            
            def get_app_info(self):
                """Get application metadata."""
                return {
                    "app_name": "The Human Network",
                    "version": "1.0.0",
                    "desktop_mode": True,
                    "renderer": "PyWebView",
                    "backend": f"Flask @ {self.wrapper.host}:{self.wrapper.port}",
                }
            
            def minimize_window(self):
                """Minimize the window."""
                self.wrapper.webview.minimize()
            
            def maximize_window(self):
                """Maximize the window."""
                self.wrapper.webview.maximize()
            
            def full_screen_toggle(self):
                """Toggle fullscreen mode."""
                self.wrapper.webview.toggle_fullscreen()
            
            def open_devtools(self):
                """Open developer tools (if supported)."""
                try:
                    self.wrapper.webview.evaluate_js("console.log('DevTools requested')")
                except:
                    pass
        
        return API(self)
    
    def start(self):
        """Start Flask backend and PyWebView frontend."""
        print("🚀 THE HUMAN NETWORK — PyWebView Desktop Wrapper")
        print(f"📡 Flask backend: http://{self.host}:{self.port}")
        print("⏩ Starting...")
        
        # Start Flask in background thread
        self.flask_thread = Thread(target=self.run_flask, daemon=True)
        self.flask_thread.start()
        
        # Wait for Flask to be ready
        time.sleep(2)
        
        # Prepare API
        api = self.expose_python_functions()
        
        # Create and start PyWebView window
        try:
            self.webview = webview.create_window(
                self.title,
                url=f"http://{self.host}:{self.port}",
                js_api=api,
                width=1600,
                height=1000,
                resizable=True,
                fullscreen=False,
                background_color="#131b2e",  # Match app dark theme
                min_size=(800, 600),
            )
            
            # Start the window (blocking)
            webview.start(debug=False)
            
        except Exception as e:
            print(f"❌ PyWebView error: {e}")
            print("Make sure you have the required system dependencies:")
            print("  - Linux: sudo apt install libgtk-3-dev libglib2.0-dev")
            print("  - macOS: Should work out of the box")
            print("  - Windows: Should work out of the box")
            sys.exit(1)


if __name__ == "__main__":
    wrapper = FlaskPyWebViewWrapper()
    wrapper.start()
