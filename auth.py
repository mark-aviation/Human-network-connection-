"""
THE HUMAN NETWORK — auth.py
Authentication: session login, Google OAuth, API key, role-based access control
"""
import os, secrets, hashlib
from datetime import datetime
from functools import wraps
from flask import Blueprint, request, session, redirect, url_for, jsonify, render_template_string
from models import db, User

auth_bp = Blueprint("auth", __name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

def _hash_password(pw: str) -> str:
    """SHA-256 + salt. Use bcrypt in production for stronger security."""
    salt = os.environ.get("SECRET_KEY", "hn-default-salt")
    return hashlib.sha256(f"{salt}{pw}".encode()).hexdigest()

def _make_api_key() -> str:
    return secrets.token_hex(32)

def get_current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return User.query.get(uid)

# ── Role decorators ───────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # Check session
        if session.get("user_id"):
            session.permanent = True  # Refresh session lifetime on every request
            return f(*args, **kwargs)
        # Check API key header
        api_key = request.headers.get("X-API-Key") or request.args.get("api_key")
        if api_key:
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            user = User.query.filter_by(api_key=key_hash, is_active=True).first()
            if user:
                session["user_id"] = user.id
                session.permanent = True
                return f(*args, **kwargs)
        if request.is_json or request.path.startswith("/api/"):
            return jsonify({"error": "Authentication required", "redirect": "/auth/login"}), 401
        return redirect(url_for("auth.login_page"))
    return decorated

def role_required(*roles):
    """Decorator: require one of the given roles."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            # First check authentication
            uid = session.get("user_id")
            if not uid:
                api_key = request.headers.get("X-API-Key") or request.args.get("api_key")
                if api_key:
                    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
                    user = User.query.filter_by(api_key=key_hash, is_active=True).first()
                    if user:
                        session["user_id"] = user.id
                        session.permanent = True
                        uid = user.id
                if not uid:
                    if request.is_json or request.path.startswith("/api/"):
                        return jsonify({"error": "Authentication required", "redirect": "/auth/login"}), 401
                    return redirect(url_for("auth.login_page"))
            # Then check role
            user = User.query.get(uid)
            if not user or user.role not in roles:
                if request.is_json or request.path.startswith("/api/"):
                    return jsonify({"error": "Insufficient permissions"}), 403
                return redirect(url_for("auth.login_page"))
            return f(*args, **kwargs)
        return decorated
    return decorator

# Convenience role decorators
admin_required  = role_required("admin")
editor_required = role_required("admin", "editor")

# ── Routes ────────────────────────────────────────────────────────────────────

LOGIN_HTML = """
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Sign In — The Human Network</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --primary: #8127cf; --primary-glow: #9c48ea; --primary-muted: rgba(129,39,207,0.12);
      --secondary: #71f8e4;
      --surface: #0e1321; --surface-card: #1a2035; --surface-low: #141c2f; --surface-mid: #1a2440;
      --text-primary: #e8eaf6; --text-secondary: #b0b8d8; --text-muted: #7b84a8;
      --outline-variant: rgba(90,98,132,0.26);
      --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 9999px;
      --shadow-float: 0 16px 40px rgba(129,39,207,0.20);
    }
    html, body { height: 100%; }
    body {
      background: var(--surface);
      color: var(--text-primary);
      font-family: 'DM Sans', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background-image: radial-gradient(ellipse at 20% 50%, rgba(129,39,207,0.08) 0%, transparent 60%),
                        radial-gradient(ellipse at 80% 20%, rgba(113,248,228,0.05) 0%, transparent 50%);
    }
    .login-wrap {
      width: 100%; max-width: 420px; padding: 16px;
    }
    .login-logo {
      text-align: center; margin-bottom: 32px;
    }
    .login-logo h1 {
      font-family: 'Manrope', sans-serif;
      font-size: 1.5rem; font-weight: 800;
      color: var(--primary); letter-spacing: -.03em;
    }
    .login-logo p { color: var(--text-muted); font-size: .875rem; margin-top: 4px; }
    .login-card {
      background: var(--surface-card);
      border-radius: var(--radius-lg);
      padding: 32px;
      border: 1px solid var(--outline-variant);
      box-shadow: var(--shadow-float);
    }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: .8125rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
    input {
      width: 100%; padding: 12px 14px;
      background: var(--surface-low); border: 1.5px solid var(--outline-variant);
      border-radius: var(--radius-md); font-family: 'DM Sans', sans-serif;
      font-size: .9375rem; color: var(--text-primary); outline: none;
      transition: border-color 150ms;
    }
    input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-muted); }
    .btn-login {
      width: 100%; padding: 13px;
      background: linear-gradient(135deg, var(--primary), var(--primary-glow));
      color: white; border: none; border-radius: var(--radius-md);
      font-family: 'Manrope', sans-serif; font-size: .9375rem; font-weight: 700;
      cursor: pointer; transition: opacity 150ms, transform 150ms;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-top: 8px;
    }
    .btn-login:hover { opacity: .9; transform: translateY(-1px); }
    .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: var(--text-muted); font-size: .8125rem; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--outline-variant); }
    .btn-google {
      width: 100%; padding: 12px;
      background: var(--surface-mid); border: 1.5px solid var(--outline-variant);
      border-radius: var(--radius-md); color: var(--text-primary);
      font-family: 'DM Sans', sans-serif; font-size: .9375rem; font-weight: 500;
      cursor: pointer; transition: background 150ms;
      display: flex; align-items: center; justify-content: center; gap: 10px;
    }
    .btn-google:hover { background: var(--surface-low); }
    .google-icon { width: 18px; height: 18px; }
    .error-msg {
      background: rgba(166,48,71,0.15); border: 1px solid rgba(166,48,71,0.3);
      color: #f87171; border-radius: var(--radius-md); padding: 10px 14px;
      font-size: .8125rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;
    }
    .material-symbols-outlined { font-size: 20px; vertical-align: middle; }
  </style>
</head>
<body>
<div class="login-wrap">
  <div class="login-logo">
    <h1>The Human Network</h1>
    <p>Sign in to your account</p>
  </div>
  <div class="login-card">
    {% if error %}
    <div class="error-msg">
      <span class="material-symbols-outlined">error</span> {{ error }}
    </div>
    {% endif %}
    <form method="POST" action="/auth/login">
      <div class="form-group">
        <label>Username or Email</label>
        <input type="text" name="username" placeholder="Enter your username" required autocomplete="username"/>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" placeholder="Enter your password" required autocomplete="current-password"/>
      </div>
      <button type="submit" class="btn-login">
        <span class="material-symbols-outlined">lock_open</span> Sign In
      </button>
    </form>
    <div class="divider">or continue with</div>
    <a href="/auth/google">
      <button type="button" class="btn-google">
        <svg class="google-icon" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </button>
    </a>
  </div>
</div>
</body>
</html>
"""

@auth_bp.route("/auth/login", methods=["GET"])
def login_page():
    if session.get("user_id"):
        return redirect("/")
    return render_template_string(LOGIN_HTML, error=request.args.get("error"))

@auth_bp.route("/auth/login", methods=["POST"])
def login_post():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    user = User.query.filter(
        (User.username == username) | (User.email == username)
    ).first()

    if not user or not user.password_hash:
        return redirect("/auth/login?error=Invalid+username+or+password")

    if user.password_hash != _hash_password(password):
        return redirect("/auth/login?error=Invalid+username+or+password")

    if not user.is_active:
        return redirect("/auth/login?error=Account+is+disabled")

    session["user_id"] = user.id
    session.permanent = True
    user.last_login = datetime.utcnow()
    db.session.commit()
    return redirect(request.args.get("next") or "/")

@auth_bp.route("/auth/logout")
def logout():
    session.clear()
    return redirect("/auth/login")

@auth_bp.route("/auth/google")
def google_login():
    """Google OAuth — requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env"""
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        return redirect("/auth/login?error=Google+OAuth+not+configured.+Set+GOOGLE_CLIENT_ID+in+.env")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5000/auth/google/callback")
    scope = "openid email profile"
    state = secrets.token_hex(16)
    session["oauth_state"] = state
    google_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}&redirect_uri={redirect_uri}"
        f"&response_type=code&scope={scope}&state={state}"
    )
    return redirect(google_url)

@auth_bp.route("/auth/google/callback")
def google_callback():
    import urllib.request, urllib.parse, json
    state = request.args.get("state")
    if state != session.pop("oauth_state", None):
        return redirect("/auth/login?error=OAuth+state+mismatch")

    code = request.args.get("code")
    client_id     = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect_uri  = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5000/auth/google/callback")

    # Exchange code for token
    token_data = urllib.parse.urlencode({
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code"
    }).encode()
    try:
        with urllib.request.urlopen("https://oauth2.googleapis.com/token", token_data) as r:
            tokens = json.loads(r.read())
    except Exception:
        return redirect("/auth/login?error=Google+authentication+failed")

    # Get user info
    try:
        req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        with urllib.request.urlopen(req) as r:
            info = json.loads(r.read())
    except Exception:
        return redirect("/auth/login?error=Could+not+get+Google+profile")

    google_id = info.get("sub")
    email     = info.get("email")
    name      = info.get("name", email)

    user = User.query.filter_by(google_id=google_id).first()
    if not user:
        user = User.query.filter_by(email=email).first()
    if not user:
        # Auto-create viewer account for first Google login
        user = User(
            username=email.split("@")[0],
            email=email,
            google_id=google_id,
            role="viewer",
            is_active=True
        )
        db.session.add(user)

    user.google_id  = google_id
    user.last_login = datetime.utcnow()
    db.session.commit()
    session["user_id"] = user.id
    return redirect("/")

# ── API key management ─────────────────────────────────────────────────────────

@auth_bp.route("/api/auth/generate-key", methods=["POST"])
@login_required
def generate_api_key():
    user = get_current_user()
    raw_key  = _make_api_key()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    user.api_key = key_hash
    db.session.commit()
    return jsonify({"api_key": raw_key, "note": "Save this key — it won't be shown again."})

@auth_bp.route("/api/auth/me")
@login_required
def me():
    return jsonify(get_current_user().to_dict())

# ── User management (admin only) ───────────────────────────────────────────────

@auth_bp.route("/api/users", methods=["GET"])
@admin_required
def list_users():
    return jsonify([u.to_dict() for u in User.query.all()])

@auth_bp.route("/api/users", methods=["POST"])
@admin_required
def create_user():
    data = request.get_json()
    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"error": "Username already taken"}), 400
    user = User(
        username=data["username"],
        email=data["email"],
        password_hash=_hash_password(data["password"]),
        role=data.get("role", "viewer"),
    )
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201

@auth_bp.route("/api/users/<int:uid>", methods=["PUT"])
@admin_required
def update_user(uid):
    user = User.query.get_or_404(uid)
    data = request.get_json()
    if "role" in data:      user.role      = data["role"]
    if "is_active" in data: user.is_active = data["is_active"]
    if "password" in data:  user.password_hash = _hash_password(data["password"])
    db.session.commit()
    return jsonify(user.to_dict())

@auth_bp.route("/api/users/<int:uid>", methods=["DELETE"])
@admin_required
def delete_user(uid):
    user = User.query.get_or_404(uid)
    db.session.delete(user)
    db.session.commit()
    return jsonify({"deleted": uid})
