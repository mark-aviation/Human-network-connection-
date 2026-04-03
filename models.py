"""
Phase A — Intelligence Layer
New fields:
  Employee: notes (dossier), tags (comma-sep)
  Relationship: reverse_label, started_date, strength (already exists)
  EventLog: new table tracking all changes
"""
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

COMPANY_COLORS = [
    {"fill": "rgba(129,39,207,0.07)",  "stroke": "#8127cf", "label": "#8127cf"},
    {"fill": "rgba(0,107,95,0.07)",    "stroke": "#006b5f", "label": "#006b5f"},
    {"fill": "rgba(166,48,71,0.07)",   "stroke": "#a63047", "label": "#a63047"},
    {"fill": "rgba(30,90,180,0.07)",   "stroke": "#1e5ab4", "label": "#1e5ab4"},
    {"fill": "rgba(180,100,20,0.07)",  "stroke": "#b46414", "label": "#b46414"},
    {"fill": "rgba(60,140,60,0.07)",   "stroke": "#3c8c3c", "label": "#3c8c3c"},
]


class Company(db.Model):
    __tablename__ = "companies"
    id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name         = db.Column(db.String(120), nullable=False, unique=True)
    industry     = db.Column(db.String(80),  nullable=True)
    description  = db.Column(db.Text,        nullable=True)
    logo_image   = db.Column(db.String(255), nullable=True)
    color_index  = db.Column(db.Integer,     default=0)
    founded_year = db.Column(db.Integer,     nullable=True)
    created_at   = db.Column(db.DateTime,    default=datetime.utcnow)
    employees    = db.relationship("Employee", backref="company", lazy="dynamic")

    def to_dict(self, image_url_base="/static/uploads/"):
        colors = COMPANY_COLORS[self.color_index % len(COMPANY_COLORS)]
        return {
            "id":          self.id,
            "name":        self.name,
            "industry":    self.industry or "",
            "description": self.description or "",
            "logo":        f"{image_url_base}{self.logo_image}" if self.logo_image else None,
            "color":       colors,
            "color_index": self.color_index,
            "founded":     self.founded_year,
            "headcount":   self.employees.count(),
        }


class Employee(db.Model):
    __tablename__ = "employees"
    id            = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name          = db.Column(db.String(120), nullable=False)
    title         = db.Column(db.String(120), nullable=False)
    department    = db.Column(db.String(80),  nullable=False)
    company_id    = db.Column(db.Integer, db.ForeignKey("companies.id"), nullable=True)
    persona_description = db.Column(db.Text, nullable=True)
    hobbies       = db.Column(db.String(255), nullable=True)
    profile_image = db.Column(db.String(255), nullable=True)
    email         = db.Column(db.String(180), nullable=True)
    node_tier     = db.Column(
        db.Enum("executive", "manager", "contributor", name="node_tier_enum"),
        nullable=False, default="contributor"
    )
    # ── Phase A new fields ──
    notes         = db.Column(db.Text, nullable=True)          # private dossier
    tags          = db.Column(db.String(255), nullable=True)   # comma-separated tags
    # ────────────────────────
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    outgoing_edges = db.relationship("Relationship", foreign_keys="Relationship.source_id",
        backref="source", lazy="dynamic", cascade="all, delete-orphan")
    incoming_edges = db.relationship("Relationship", foreign_keys="Relationship.target_id",
        backref="target", lazy="dynamic")
    events        = db.relationship("EventLog", backref="employee", lazy="dynamic",
        cascade="all, delete-orphan")

    def to_node(self, image_url_base):
        co = self.company
        return {
            "id":           self.id,
            "name":         self.name,
            "title":        self.title,
            "department":   self.department,
            "company_id":   self.company_id,
            "company_name": co.name if co else "",
            "persona":      self.persona_description or "",
            "hobbies":      [h.strip() for h in (self.hobbies or "").split(",") if h.strip()],
            "notes":        self.notes or "",
            "tags":         [t.strip() for t in (self.tags or "").split(",") if t.strip()],
            "image":        f"{image_url_base}{self.profile_image}" if self.profile_image else None,
            "email":        self.email or "",
            "tier":         self.node_tier,
        }


class Relationship(db.Model):
    __tablename__ = "relationships"
    id              = db.Column(db.Integer, primary_key=True, autoincrement=True)
    source_id       = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False)
    target_id       = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False)
    connection_type = db.Column(
        db.Enum("formal", "informal", "cross_company", name="connection_type_enum"),
        nullable=False, default="formal"
    )
    label         = db.Column(db.String(80), nullable=True)
    reverse_label = db.Column(db.String(80), nullable=True)   # Phase A: bidirectional
    strength      = db.Column(db.Float, default=1.0)
    started_date  = db.Column(db.Date, nullable=True)          # Phase A: timeline
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("source_id", "target_id", "connection_type", name="uq_relationship"),
    )

    def to_edge(self):
        return {
            "id":            self.id,
            "source":        self.source_id,
            "target":        self.target_id,
            "type":          self.connection_type,
            "label":         self.label or "",
            "reverse_label": self.reverse_label or "",
            "strength":      self.strength,
            "started_date":  self.started_date.isoformat() if self.started_date else None,
        }


class User(db.Model):
    """App users with role-based access control."""
    __tablename__ = "users"
    id            = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username      = db.Column(db.String(80),  nullable=False, unique=True)
    email         = db.Column(db.String(180), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=True)   # None for OAuth-only users
    google_id     = db.Column(db.String(120), nullable=True, unique=True)
    api_key       = db.Column(db.String(64),  nullable=True, unique=True)
    role          = db.Column(
        db.Enum("admin", "editor", "viewer", name="user_role_enum"),
        nullable=False, default="viewer"
    )
    is_active     = db.Column(db.Boolean, default=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    last_login    = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            "id":         self.id,
            "username":   self.username,
            "email":      self.email,
            "role":       self.role,
            "is_active":  self.is_active,
            "created_at": self.created_at.isoformat(),
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }


class EventLog(db.Model):
    """Tracks every meaningful change — company move, new connection, edit, etc."""
    __tablename__ = "event_logs"
    id          = db.Column(db.Integer, primary_key=True, autoincrement=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id"), nullable=False)
    event_type  = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text, nullable=False)
    extra_data  = db.Column(db.Text, nullable=True)           # JSON string for extra data
    occurred_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":          self.id,
            "employee_id": self.employee_id,
            "event_type":  self.event_type,
            "description": self.description,
            "extra_data":  self.extra_data,
            "occurred_at": self.occurred_at.isoformat(),
        }