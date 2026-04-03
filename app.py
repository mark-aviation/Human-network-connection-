import os, uuid, json, csv, io
from pathlib import Path
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template, Response, session, redirect, url_for, g
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
from sqlalchemy import func
from models import db, Company, Employee, Relationship, EventLog, COMPANY_COLORS, User
from auth import auth_bp, login_required, editor_required, admin_required, get_current_user

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def _log_event(employee_id, event_type, description, db_session, extra_data=None):
    """Helper — create an EventLog entry."""
    try:
        ev = EventLog(
            employee_id=employee_id,
            event_type=event_type,
            description=description,
            extra_data=json.dumps(extra_data) if extra_data else None,
        )
        db_session.session.add(ev)
    except Exception:
        pass  # Never let logging break the main operation


def _error_response(message, status_code=400):
    """
    Standardized error response format.
    All API errors follow: {"error": "message"}
    
    Args:
        message: Human-readable error message
        status_code: HTTP status code (400, 401, 403, 404, 409, 422, 500)
    
    Returns:
        Tuple of (jsonify response, status_code)
    """
    return jsonify({"error": str(message)}), status_code


def _success_response(data, status_code=200):
    """Standardized success response - returns data directly or wrapped."""
    if isinstance(data, dict) and "error" not in data:
        return jsonify(data), status_code
    return jsonify(data), status_code


def create_app(config=None):
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", "sqlite:///humannetwork.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_recycle": 280, "pool_pre_ping": True},
        UPLOAD_FOLDER=Path(__file__).parent / "static" / "uploads",
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        ALLOWED_EXTENSIONS={"png", "jpg", "jpeg", "webp", "gif"},
        IMAGE_URL_BASE="/static/uploads/",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        SESSION_PERMANENT=True,
    )
    if config: app.config.update(config)
    app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    db.init_app(app)
    
    # ── PRAGMA foreign_keys enforcement ──────────────
    # Ensure referential integrity in SQLite by enabling FK constraints on connection
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        from sqlalchemy import event
        @event.listens_for(db.engine, "connect")
        def set_sqlite_pragma(dbapi_conn, connection_record):
            if hasattr(dbapi_conn, 'execute'):
                dbapi_conn.execute("PRAGMA foreign_keys=ON")
    
    app.register_blueprint(auth_bp)
    with app.app_context():
        db.create_all()
        _seed_sample_data()
        _seed_admin_user()
    _register_routes(app)

    # ── Security headers ──────────────────────────
    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["X-Frame-Options"]          = "DENY"
        response.headers["X-XSS-Protection"]         = "1; mode=block"
        response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]        = "camera=(), microphone=(), geolocation=()"
        return response

    return app


def _register_routes(app):

    # ── Page routes ──────────────────────────────
    @app.route("/favicon.ico")
    def favicon():
        """Return 204 No Content for favicon requests to suppress 404 errors."""
        return "", 204

    @app.route("/")
    @login_required
    def index():
        user = get_current_user()
        return render_template("index.html", active="map", current_user=user)

    @app.route("/directory")
    @login_required
    def directory():
        user = get_current_user()
        return render_template("directory.html", active="directory", current_user=user)

    @app.route("/insights")
    @login_required
    def insights():
        user = get_current_user()
        return render_template("insights.html", active="insights", current_user=user)

    @app.route("/settings")
    @login_required
    def settings():
        user = get_current_user()
        return render_template("settings.html", active="settings", current_user=user)

    # ── Graph API ────────────────────────────────
    @app.route("/api/graph")
    @login_required
    def get_graph():
        base = app.config["IMAGE_URL_BASE"]
        nodes = [e.to_node(base) for e in Employee.query.all()]
        rels  = Relationship.query.all()
        edges = [r.to_edge() for r in rels]
        comps = [c.to_dict(base) for c in Company.query.all()]
        return jsonify({
            "nodes": nodes,
            "companies": comps,
            "edges": {
                "formal":        [e for e in edges if e["type"] == "formal"],
                "informal":      [e for e in edges if e["type"] == "informal"],
                "cross_company": [e for e in edges if e["type"] == "cross_company"],
            }
        })

    @app.route("/api/companies/<int:cid>/org")
    def get_org(cid):
        co = Company.query.get_or_404(cid)
        base = app.config["IMAGE_URL_BASE"]
        members = co.employees.all()
        member_ids = {e.id for e in members}
        edges = Relationship.query.filter(
            Relationship.source_id.in_(member_ids),
            Relationship.target_id.in_(member_ids),
        ).all()
        return jsonify({
            "company": co.to_dict(base),
            "nodes":   [e.to_node(base) for e in members],
            "edges":   [r.to_edge() for r in edges],
        })

    # ── Directory API ────────────────────────────
    @app.route("/api/employees")
    @login_required
    def list_employees():
        base = app.config["IMAGE_URL_BASE"]
        q    = request.args.get("q", "").lower()
        cid  = request.args.get("company_id")
        dept = request.args.get("department")
        tier = request.args.get("tier")
        query = Employee.query
        if cid:  query = query.filter(Employee.company_id == int(cid))
        if dept: query = query.filter(Employee.department.ilike(f"%{dept}%"))
        if tier: query = query.filter(Employee.node_tier == tier)
        emps = query.all()
        if q:
            emps = [e for e in emps if q in e.name.lower() or q in e.title.lower() or q in (e.department or "").lower()]
        return jsonify([e.to_node(base) for e in emps])

    @app.route("/api/employees/<int:eid>")
    @login_required
    def get_employee(eid):
        return jsonify(Employee.query.get_or_404(eid).to_node(app.config["IMAGE_URL_BASE"]))

    @app.route("/api/employees", methods=["POST"])
    @editor_required
    def create_employee():
        required = ["name", "title", "department"]
        missing  = [f for f in required if not request.form.get(f, "").strip()]
        if missing: return _error_response(f"Missing required fields: {', '.join(missing)}", 422)
        img = _save_upload(request.files.get("profile_image"), app)
        e = Employee(
            name=request.form["name"].strip(), title=request.form["title"].strip(),
            department=request.form["department"].strip(),
            company_id=request.form.get("company_id") or None,
            persona_description=request.form.get("persona_description","").strip() or None,
            hobbies=request.form.get("hobbies","").strip() or None,
            email=request.form.get("email","").strip() or None,
            node_tier=request.form.get("node_tier","contributor"),
            profile_image=img,
        )
        db.session.add(e); db.session.commit()
        return jsonify(e.to_node(app.config["IMAGE_URL_BASE"])), 201

    @app.route("/api/employees/<int:eid>", methods=["PUT"])
    @editor_required
    def update_employee(eid):
        e = Employee.query.get_or_404(eid)
        data = request.get_json(force=True)

        # Track company change for event log
        old_company_id = e.company_id
        old_title      = e.title

        for f in ["name","title","department","persona_description","hobbies","email","node_tier","notes","tags"]:
            if f in data: setattr(e, f, data[f] or None)
        if "company_id" in data: e.company_id = data["company_id"] or None

        # Auto-log meaningful changes
        base = app.config["IMAGE_URL_BASE"]
        if "company_id" in data and data["company_id"] != old_company_id:
            old_co  = Company.query.get(old_company_id)
            new_co  = Company.query.get(data["company_id"]) if data["company_id"] else None
            old_name = old_co.name if old_co else "No company"
            new_name = new_co.name if new_co else "No company"
            _log_event(e.id, "company_change",
                f"Moved from {old_name} to {new_name}", db)

        if "title" in data and data["title"] != old_title:
            _log_event(e.id, "promotion",
                f"Title changed from '{old_title}' to '{data['title']}'", db)

        db.session.commit()
        return jsonify(e.to_node(base))

    @app.route("/api/employees/<int:eid>", methods=["DELETE"])
    @editor_required
    def delete_employee(eid):
        e = Employee.query.get_or_404(eid)
        db.session.delete(e); db.session.commit()
        return jsonify({"deleted": eid})

    @app.route("/api/employees/<int:eid>/image", methods=["POST"])
    def upload_image(eid):
        e = Employee.query.get_or_404(eid)
        file = request.files.get("profile_image")
        if not file or not file.filename: return _error_response("No file provided", 400)
        if e.profile_image:
            old = app.config["UPLOAD_FOLDER"] / e.profile_image
            if old.exists(): old.unlink()
        e.profile_image = _save_upload(file, app)
        db.session.commit()
        return jsonify({"image": app.config["IMAGE_URL_BASE"] + e.profile_image})

    # ── Companies API ────────────────────────────
    @app.route("/api/companies")
    def list_companies():
        base = app.config["IMAGE_URL_BASE"]
        return jsonify([c.to_dict(base) for c in Company.query.all()])

    @app.route("/api/companies", methods=["POST"])
    def create_company():
        data = request.get_json(force=True)
        if not data.get("name","").strip(): return _error_response("Company name is required", 422)
        co = Company(
            name=data["name"].strip(), industry=data.get("industry","").strip() or None,
            description=data.get("description","").strip() or None,
            color_index=int(data.get("color_index", 0)),
            founded_year=data.get("founded_year") or None,
        )
        db.session.add(co); db.session.commit()
        return jsonify(co.to_dict(app.config["IMAGE_URL_BASE"])), 201

    @app.route("/api/companies/<int:cid>", methods=["PUT"])
    def update_company(cid):
        co = Company.query.get_or_404(cid)
        data = request.get_json(force=True)
        for f in ["name","industry","description","founded_year","color_index"]:
            if f in data: setattr(co, f, data[f] or None)
        db.session.commit()
        return jsonify(co.to_dict(app.config["IMAGE_URL_BASE"]))

    @app.route("/api/companies/<int:cid>", methods=["DELETE"])
    def delete_company(cid):
        co = Company.query.get_or_404(cid)
        # Unassign employees
        for e in co.employees.all(): e.company_id = None
        db.session.delete(co); db.session.commit()
        return jsonify({"deleted": cid})

    # ── Relationships API ────────────────────────
    @app.route("/api/relationships", methods=["POST"])
    def create_relationship():
        data = request.get_json(force=True)
        if not data.get("source_id") or not data.get("target_id"):
            return _error_response("Both source_id and target_id are required", 422)
        Employee.query.get_or_404(data["source_id"])
        Employee.query.get_or_404(data["target_id"])

        started = None
        if data.get("started_date"):
            from datetime import date
            try: started = date.fromisoformat(data["started_date"])
            except: pass

        rel = Relationship(
            source_id=data["source_id"], target_id=data["target_id"],
            connection_type=data.get("connection_type","formal"),
            label=data.get("label",""),
            reverse_label=data.get("reverse_label",""),
            strength=float(data.get("strength",1.0)),
            started_date=started,
        )
        db.session.add(rel)
        try: db.session.commit()
        except Exception as e: db.session.rollback(); return _error_response("Relationship already exists or data is invalid", 409)

        # Log connection event for both people
        src = Employee.query.get(rel.source_id)
        tgt = Employee.query.get(rel.target_id)
        if src and tgt:
            _log_event(src.id, "connected", f"Connected with {tgt.name} ({rel.connection_type.replace('_',' ')})", db)
            _log_event(tgt.id, "connected", f"Connected with {src.name} ({rel.connection_type.replace('_',' ')})", db)

        return jsonify(rel.to_edge()), 201

    @app.route("/api/relationships/<int:rid>", methods=["PUT"])
    def update_relationship(rid):
        r = Relationship.query.get_or_404(rid)
        data = request.get_json(force=True)
        if "label"          in data: r.label         = data["label"] or ""
        if "reverse_label"  in data: r.reverse_label = data["reverse_label"] or ""
        if "connection_type"in data: r.connection_type = data["connection_type"]
        if "strength"       in data: r.strength       = float(data["strength"])
        if "started_date"   in data and data["started_date"]:
            from datetime import date
            try: r.started_date = date.fromisoformat(data["started_date"])
            except: pass
        db.session.commit()
        return jsonify(r.to_edge())

    @app.route("/api/relationships/<int:rid>", methods=["DELETE"])
    def delete_relationship(rid):
        r = Relationship.query.get_or_404(rid)
        db.session.delete(r); db.session.commit()
        return jsonify({"deleted": rid})

    # ── Event Log API ─────────────────────────────
    @app.route("/api/employees/<int:eid>/events")
    def get_events(eid):
        Employee.query.get_or_404(eid)
        events = EventLog.query.filter_by(employee_id=eid).order_by(EventLog.occurred_at.desc()).all()
        return jsonify([e.to_dict() for e in events])

    @app.route("/api/employees/<int:eid>/events", methods=["POST"])
    def add_event(eid):
        Employee.query.get_or_404(eid)
        data = request.get_json(force=True)
        if not data.get("description","").strip():
            return _error_response("Event description is required", 422)
        ev = EventLog(
            employee_id=eid,
            event_type=data.get("event_type","note"),
            description=data["description"].strip(),
            extra_data=data.get("extra_data"),
        )
        if data.get("occurred_at"):
            from datetime import datetime as dt
            try: ev.occurred_at = dt.fromisoformat(data["occurred_at"])
            except: pass
        db.session.add(ev); db.session.commit()
        return jsonify(ev.to_dict()), 201

    @app.route("/api/events/<int:evid>", methods=["DELETE"])
    def delete_event(evid):
        ev = EventLog.query.get_or_404(evid)
        db.session.delete(ev); db.session.commit()
        return jsonify({"deleted": evid})

    @app.route("/api/feed")
    def get_feed():
        """Global activity feed — latest events across all people"""
        limit  = int(request.args.get("limit", 30))
        events = EventLog.query.order_by(EventLog.occurred_at.desc()).limit(limit).all()
        base   = app.config["IMAGE_URL_BASE"]
        result = []
        for ev in events:
            emp = Employee.query.get(ev.employee_id)
            if emp:
                result.append({
                    **ev.to_dict(),
                    "employee_name":  emp.name,
                    "employee_title": emp.title,
                    "employee_image": f"{base}{emp.profile_image}" if emp.profile_image else None,
                })
        return jsonify(result)

    # ── Insights API ─────────────────────────────
    # Optimized with SQLAlchemy aggregations (no Python loops)
    @app.route("/api/insights")
    @login_required
    def get_insights():
        base = app.config["IMAGE_URL_BASE"]
        
        # Use subqueries and func.count() to aggregate in SQL, not Python
        from sqlalchemy import func, case
        
        # 1. Total counts (single query each)
        total_people = Employee.query.count()
        total_companies = Company.query.count()
        total_connections = Relationship.query.count()
        
        # 2. Connection count per employee (subquery)
        conn_query = db.session.query(
            func.count(Relationship.id).label("conn_count"),
            case(
                (Relationship.source_id != None, Relationship.source_id),
                else_=Relationship.target_id
            ).label("emp_id")
        ).group_by("emp_id").all()
        
        conn_map = {}
        for row in conn_query:
            if row.emp_id in conn_map:
                conn_map[row.emp_id] += row.conn_count
            else:
                conn_map[row.emp_id] = row.conn_count
        
        # 3. Most connected (top 5 by connection count)
        most_connected_ids = sorted(conn_map, key=conn_map.get, reverse=True)[:5]
        most_connected = []
        for eid in most_connected_ids:
            e = Employee.query.get(eid)
            if e:
                most_connected.append({**e.to_node(base), "connections": conn_map[eid]})
        
        # 4. Isolated nodes (employees with no connections)
        isolated_ids = [e.id for e in Employee.query.all() if e.id not in conn_map]
        isolated = [e.to_node(base) for e in Employee.query.filter(Employee.id.in_(isolated_ids)).all()] if isolated_ids else []
        
        # 5. Department breakdown (GROUP BY in SQL)
        dept_breakdown = db.session.query(
            Employee.department, func.count(Employee.id).label("count")
        ).group_by(Employee.department).all()
        dept_breakdown_list = [{"dept": dept or "Unassigned", "count": count} for dept, count in dept_breakdown]
        
        # 6. Company breakdown (GROUP BY with JOIN in SQL)
        company_breakdown = db.session.query(
            Company.name, func.count(Employee.id).label("count")
        ).outerjoin(Employee).group_by(Company.id, Company.name).all()
        company_breakdown_list = [{"company": name or "No Company", "count": count} for name, count in company_breakdown]
        
        # 7. Edge type breakdown (GROUP BY on connection_type)
        edge_type_counts = db.session.query(
            Relationship.connection_type, func.count(Relationship.id).label("count")
        ).group_by(Relationship.connection_type).all()
        edge_types = {"formal": 0, "informal": 0, "cross_company": 0}
        for conn_type, count in edge_type_counts:
            if conn_type in edge_types:
                edge_types[conn_type] = count
        
        # 8. Cross-company bridges (people with cross_company connections)
        bridge_query = Relationship.query.filter_by(connection_type="cross_company").all()
        bridge_ids = set()
        for r in bridge_query:
            bridge_ids.add(r.source_id)
            bridge_ids.add(r.target_id)
        bridges = [e.to_node(base) for e in Employee.query.filter(Employee.id.in_(bridge_ids)).all()] if bridge_ids else []
        
        # 9. Health score (informal vs formal relationships)
        health = round((edge_types["informal"] / total_connections * 100) if total_connections else 0)
        
        return jsonify({
            "summary": {
                "total_people":         total_people,
                "total_companies":      total_companies,
                "total_connections":    total_connections,
                "cross_company_links":  edge_types["cross_company"],
                "health_score":         health,
            },
            "most_connected":    most_connected,
            "isolated":          isolated,
            "bridges":           bridges,
            "dept_breakdown":    dept_breakdown_list,
            "company_breakdown": company_breakdown_list,
            "edge_types":        edge_types,
        })

    # ── PDS Export (Personal Data Sheet) ─────────
    @app.route("/api/export/pds")
    @login_required
    def export_pds():
        """
        Export employee data in PDS format for your separate Personal Data Sheet generator.
        Includes all employee fields, relationships, and metadata.
        JSON structure optimized for piping into your PDS tool.
        """
        base = app.config["IMAGE_URL_BASE"]
        
        employees_data = []
        for e in Employee.query.all():
            # Build relationship data
            outgoing = []
            for rel in e.outgoing_edges:
                target = Employee.query.get(rel.target_id)
                if target:
                    outgoing.append({
                        "target_id": rel.target_id,
                        "target_name": target.name,
                        "type": rel.connection_type,
                        "label": rel.label or "",
                        "strength": rel.strength,
                        "started": rel.started_date.isoformat() if rel.started_date else None,
                    })
            
            incoming = []
            for rel in e.incoming_edges:
                source = Employee.query.get(rel.source_id)
                if source:
                    incoming.append({
                        "source_id": rel.source_id,
                        "source_name": source.name,
                        "type": rel.connection_type,
                        "label": rel.label or "",
                        "reverse_label": rel.reverse_label or "",
                        "strength": rel.strength,
                        "started": rel.started_date.isoformat() if rel.started_date else None,
                    })
            
            # Get company data
            company = None
            if e.company_id:
                co = Company.query.get(e.company_id)
                if co:
                    company = {
                        "id": co.id,
                        "name": co.name,
                        "industry": co.industry,
                        "color_index": co.color_index,
                    }
            
            # Build complete employee record
            employee_record = {
                "id": e.id,
                "name": e.name,
                "title": e.title,
                "department": e.department,
                "tier": e.node_tier,
                "email": e.email,
                "company": company,
                "persona": e.persona_description,
                "hobbies": [h.strip() for h in (e.hobbies or "").split(",") if h.strip()],
                "notes": e.notes,
                "tags": [t.strip() for t in (e.tags or "").split(",") if t.strip()],
                "profile_image": f"{base}{e.profile_image}" if e.profile_image else None,
                "relationships": {
                    "outgoing": outgoing,
                    "incoming": incoming,
                },
                "created_at": e.created_at.isoformat(),
                "updated_at": e.updated_at.isoformat(),
            }
            
            employees_data.append(employee_record)
        
        # Build metadata
        companies_list = [c.to_dict(base) for c in Company.query.all()]
        
        pds_export = {
            "metadata": {
                "export_date": datetime.utcnow().isoformat(),
                "total_employees": len(employees_data),
                "total_companies": len(companies_list),
                "total_relationships": Relationship.query.count(),
            },
            "employees": employees_data,
            "companies": companies_list,
        }
        
        return jsonify(pds_export)

    # ── PDF Export ───────────────────────────────
    @app.route("/api/export/pdf")
    def export_pdf():
        """
        Generates a clean HTML people directory that the browser prints as PDF.
        Returns an HTML page styled for print with @media print CSS.
        """
        base  = app.config["IMAGE_URL_BASE"]
        emps  = Employee.query.order_by(Employee.node_tier, Employee.name).all()
        comps = {c.id: c for c in Company.query.all()}

        rows_html = ""
        for e in emps:
            co     = comps.get(e.company_id)
            co_name= co.name if co else "—"
            tier_color = {"executive":"#8127cf","manager":"#006b5f","contributor":"#4d4354"}.get(e.node_tier,"#4d4354")
            rows_html += f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #eee">
                <strong style="font-family:Manrope,sans-serif;font-size:13px">{e.name}</strong>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{e.title}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{e.department}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{co_name}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee">
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px;background:{tier_color}22;color:{tier_color}">{e.node_tier}</span>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{e.email or "—"}</td>
            </tr>"""

        rels   = Relationship.query.all()
        emp_map= {e.id: e for e in emps}
        rel_rows = ""
        for r in rels:
            src = emp_map.get(r.source_id)
            tgt = emp_map.get(r.target_id)
            if not src or not tgt: continue
            type_color = {"formal":"#7e7385","informal":"#006b5f","cross_company":"#b49632"}.get(r.connection_type,"#7e7385")
            date_str = r.started_date.strftime("%b %Y") if r.started_date else "—"
            rel_rows += f"""
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px">{src.name}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px">{tgt.name}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee">
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px;background:{type_color}22;color:{type_color}">{r.connection_type.replace("_"," ")}</span>
              </td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{r.label or "—"}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{date_str}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#4d4354">{round(r.strength*100)}%</td>
            </tr>"""

        from datetime import datetime as dt
        html = f"""<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<title>The Human Network — Export</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  * {{ box-sizing:border-box;margin:0;padding:0; }}
  body {{ font-family:'DM Sans',sans-serif;color:#131b2e;background:white;padding:40px; }}
  h1 {{ font-family:Manrope,sans-serif;font-size:28px;font-weight:800;color:#8127cf;letter-spacing:-.02em;margin-bottom:4px; }}
  h2 {{ font-family:Manrope,sans-serif;font-size:18px;font-weight:700;color:#131b2e;margin:32px 0 12px;letter-spacing:-.01em; }}
  .meta {{ font-size:12px;color:#7e7385;margin-bottom:32px; }}
  table {{ width:100%;border-collapse:collapse;margin-bottom:40px; }}
  th {{ text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7e7385;border-bottom:2px solid #8127cf;font-family:Manrope,sans-serif; }}
  @media print {{
    body {{ padding:20px; }}
    @page {{ margin:1cm; }}
    h2 {{ page-break-before:auto; }}
    table {{ page-break-inside:auto; }}
    tr {{ page-break-inside:avoid; }}
  }}
</style>
</head>
<body>
  <h1>The Human Network</h1>
  <div class="meta">Exported on {dt.now().strftime("%B %d, %Y")} · {len(emps)} people · {len(rels)} connections</div>

  <h2>People Directory</h2>
  <table>
    <thead><tr>
      <th>Name</th><th>Title</th><th>Department</th><th>Company</th><th>Tier</th><th>Email</th>
    </tr></thead>
    <tbody>{rows_html}</tbody>
  </table>

  <h2>Connections</h2>
  <table>
    <thead><tr>
      <th>From</th><th>To</th><th>Type</th><th>Label</th><th>Since</th><th>Strength</th>
    </tr></thead>
    <tbody>{rel_rows}</tbody>
  </table>

  <script>window.onload = () => window.print();</script>
</body></html>"""

        return Response(html, mimetype="text/html")

    # ── Export API ───────────────────────────────
    @app.route("/api/export/json")
    def export_json():
        base  = app.config["IMAGE_URL_BASE"]
        data  = {
            "companies": [c.to_dict(base) for c in Company.query.all()],
            "employees": [e.to_node(base)  for e in Employee.query.all()],
            "relationships": [r.to_edge()  for r in Relationship.query.all()],
        }
        return Response(json.dumps(data, indent=2), mimetype="application/json",
            headers={"Content-Disposition": "attachment;filename=human_network.json"})

    @app.route("/api/export/csv")
    def export_csv():
        base   = app.config["IMAGE_URL_BASE"]
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id","name","title","department","company","tier","email","hobbies","tags","notes"])
        for e in Employee.query.all():
            co = Company.query.get(e.company_id) if e.company_id else None
            writer.writerow([e.id, e.name, e.title, e.department,
                co.name if co else "", e.node_tier, e.email or "",
                e.hobbies or "", e.tags or "", (e.notes or "").replace("\n"," ")])
        return Response(output.getvalue(), mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=employees.csv"})

    # ── CSV Templates ────────────────────────────
    @app.route("/api/templates/people.csv")
    def template_people():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["name","title","department","company","tier","email","hobbies","tags","notes"])
        writer.writerow(["Jane Smith","Product Manager","Product","Apex Innovations","manager","jane@example.com","Reading, Hiking","product,manager","Met at conference 2023"])
        writer.writerow(["John Doe","Engineer","Engineering","Nova Ventures","contributor","john@example.com","Coding, Chess","engineer","Strong technical background"])
        return Response(output.getvalue(), mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=people_template.csv"})

    @app.route("/api/templates/connections.csv")
    def template_connections():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["from_name","to_name","type","label","reverse_label","strength","started_date"])
        writer.writerow(["Jane Smith","John Doe","formal","Manager","Reports to","1.0","2023-01-15"])
        writer.writerow(["Jane Smith","John Doe","informal","Mentor","Mentee","0.8","2023-06-01"])
        return Response(output.getvalue(), mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=connections_template.csv"})

    # ── Import People from CSV ───────────────────
    @app.route("/api/import/people", methods=["POST"])
    def import_people():
        file = request.files.get("file")
        if not file or not file.filename.endswith(".csv"):
            return _error_response("Please upload a valid CSV file", 400)

        preview_only = request.form.get("preview", "true").lower() == "true"
        base = app.config["IMAGE_URL_BASE"]

        stream  = io.StringIO(file.stream.read().decode("utf-8-sig"))
        reader  = csv.DictReader(stream)
        rows    = []
        errors  = []
        results = []

        for i, row in enumerate(reader, start=2):
            name = (row.get("name") or "").strip()
            if not name:
                errors.append({"row": i, "error": "Name is required"})
                continue

            title      = (row.get("title") or "").strip() or "Unknown"
            department = (row.get("department") or "").strip() or "Unknown"
            co_name    = (row.get("company") or "").strip()
            tier       = (row.get("tier") or "contributor").strip().lower()
            email      = (row.get("email") or "").strip() or None
            hobbies    = (row.get("hobbies") or "").strip() or None
            tags       = (row.get("tags") or "").strip() or None
            notes      = (row.get("notes") or "").strip() or None

            if tier not in ("executive","manager","contributor"):
                tier = "contributor"

            rows.append({
                "row": i, "name": name, "title": title, "department": department,
                "company": co_name, "tier": tier, "email": email,
                "hobbies": hobbies, "tags": tags, "notes": notes,
                "status": "new" if not Employee.query.filter_by(name=name).first() else "update"
            })

        if preview_only:
            return jsonify({"rows": rows, "errors": errors, "total": len(rows)})

        # Actual import
        for r in rows:
            # Resolve or create company
            co_id = None
            if r["company"]:
                co = Company.query.filter_by(name=r["company"]).first()
                if not co:
                    co = Company(name=r["company"], color_index=len(Company.query.all()) % 6)
                    db.session.add(co)
                    db.session.flush()
                co_id = co.id

            # Update or create employee
            emp = Employee.query.filter_by(name=r["name"]).first()
            if emp:
                emp.title = r["title"]; emp.department = r["department"]
                emp.company_id = co_id; emp.node_tier = r["tier"]
                if r["email"]:   emp.email   = r["email"]
                if r["hobbies"]: emp.hobbies = r["hobbies"]
                if r["tags"]:    emp.tags    = r["tags"]
                if r["notes"]:   emp.notes   = r["notes"]
                results.append({**r, "action": "updated"})
            else:
                emp = Employee(name=r["name"], title=r["title"], department=r["department"],
                    company_id=co_id, node_tier=r["tier"], email=r["email"],
                    hobbies=r["hobbies"], tags=r["tags"], notes=r["notes"])
                db.session.add(emp)
                db.session.flush()
                _log_event(emp.id, "joined", f"Added via CSV import", db)
                results.append({**r, "action": "created"})

        db.session.commit()
        return jsonify({"imported": len(results), "errors": errors, "results": results})

    # ── Import Connections from CSV ──────────────
    @app.route("/api/import/connections", methods=["POST"])
    def import_connections():
        file = request.files.get("file")
        if not file or not file.filename.endswith(".csv"):
            return _error_response("Please upload a valid CSV file", 400)

        preview_only = request.form.get("preview", "true").lower() == "true"
        stream  = io.StringIO(file.stream.read().decode("utf-8-sig"))
        reader  = csv.DictReader(stream)
        rows    = []
        errors  = []

        for i, row in enumerate(reader, start=2):
            from_name = (row.get("from_name") or "").strip()
            to_name   = (row.get("to_name")   or "").strip()
            if not from_name or not to_name:
                errors.append({"row": i, "error": "from_name and to_name required"}); continue

            src = Employee.query.filter_by(name=from_name).first()
            tgt = Employee.query.filter_by(name=to_name).first()

            src_status = "found" if src else "not found"
            tgt_status = "found" if tgt else "not found"

            conn_type = (row.get("type") or "informal").strip().lower()
            if conn_type not in ("formal","informal","cross_company"):
                conn_type = "informal"

            rows.append({
                "row": i, "from_name": from_name, "to_name": to_name,
                "from_status": src_status, "to_status": tgt_status,
                "type": conn_type,
                "label":         (row.get("label") or "").strip(),
                "reverse_label": (row.get("reverse_label") or "").strip(),
                "strength":      float(row.get("strength") or 1.0),
                "started_date":  (row.get("started_date") or "").strip() or None,
            })

        if preview_only:
            return jsonify({"rows": rows, "errors": errors, "total": len(rows)})

        # Actual import
        imported = 0
        for r in rows:
            src = Employee.query.filter_by(name=r["from_name"]).first()
            tgt = Employee.query.filter_by(name=r["to_name"]).first()
            if not src or not tgt: continue

            from datetime import date as dt_date
            started = None
            if r["started_date"]:
                try: started = dt_date.fromisoformat(r["started_date"])
                except: pass

            existing = Relationship.query.filter_by(
                source_id=src.id, target_id=tgt.id, connection_type=r["type"]).first()
            if existing:
                existing.label         = r["label"] or existing.label
                existing.reverse_label = r["reverse_label"] or existing.reverse_label
                existing.strength      = r["strength"]
                if started: existing.started_date = started
            else:
                rel = Relationship(source_id=src.id, target_id=tgt.id,
                    connection_type=r["type"], label=r["label"],
                    reverse_label=r["reverse_label"], strength=r["strength"],
                    started_date=started)
                db.session.add(rel)
                imported += 1

        db.session.commit()
        return jsonify({"imported": imported, "errors": errors})

    # ── Influence Score API ──────────────────────
    @app.route("/api/influence")
    def get_influence():
        """
        Influence score per person (0-100):
        - Each connection = +5 points
        - Informal connection = +8 (more valuable than formal)
        - Cross-company connection = +12 (hardest to build)
        - Being executive = +10 base
        - Being manager = +5 base
        - Strength multiplier applied to each connection
        """
        base  = app.config["IMAGE_URL_BASE"]
        rels  = Relationship.query.all()
        emps  = Employee.query.all()

        scores = {}
        for e in emps:
            base_score = 10 if e.node_tier == "executive" else 5 if e.node_tier == "manager" else 0
            scores[e.id] = base_score

        type_weight = {"formal": 5, "informal": 8, "cross_company": 12}
        for r in rels:
            w  = type_weight.get(r.connection_type, 5) * (r.strength or 1.0)
            scores[r.source_id] = scores.get(r.source_id, 0) + w
            scores[r.target_id] = scores.get(r.target_id, 0) + w

        # Normalise to 0-100
        max_score = max(scores.values()) if scores else 1
        normalised = {k: round(v / max_score * 100) for k, v in scores.items()}

        results = []
        for e in sorted(emps, key=lambda x: normalised.get(x.id, 0), reverse=True):
            co = Company.query.get(e.company_id) if e.company_id else None
            results.append({
                **e.to_node(base),
                "score":        normalised.get(e.id, 0),
                "raw_score":    round(scores.get(e.id, 0), 1),
                "company_name": co.name if co else "",
            })

        return jsonify(results)

    # ── Tags API ─────────────────────────────────
    @app.route("/api/tags")
    def get_all_tags():
        """Returns all unique tags across all employees."""
        all_tags = set()
        for e in Employee.query.all():
            if e.tags:
                for t in e.tags.split(","):
                    t = t.strip()
                    if t: all_tags.add(t)
        return jsonify(sorted(all_tags))

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_): return _error_response("File exceeds maximum size of 5MB", 413)

    @app.errorhandler(404)
    def not_found(_): return _error_response("Resource not found", 404)

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        return _error_response("An unexpected server error occurred. Please try again later.", 500)


def _allowed_file(filename, allowed):
    return "." in filename and Path(filename).suffix.lstrip(".").lower() in allowed

def _save_upload(file, app):
    if not file or not file.filename: return None
    if not _allowed_file(file.filename, app.config["ALLOWED_EXTENSIONS"]): return None
    ext  = Path(secure_filename(file.filename)).suffix.lower()
    name = f"{uuid.uuid4().hex}{ext}"
    file.save(app.config["UPLOAD_FOLDER"] / name)
    return name


def _seed_sample_data():
    if Company.query.first(): return
    from datetime import date
    apex = Company(name="Apex Innovations", industry="Technology", description="A forward-thinking tech company building tools that put humans first.", color_index=0, founded_year=2018)
    nova = Company(name="Nova Ventures",    industry="Finance & Strategy", description="A boutique strategy firm connecting capital with emerging ideas.", color_index=1, founded_year=2015)
    db.session.add_all([apex, nova]); db.session.flush()

    sarah  = Employee(name="Sarah Chen",      title="Chief Innovation Officer", department="Executive",   company_id=apex.id, node_tier="executive",   persona_description="A visionary leader who prioritizes empathy and collaborative brainstorming.", hobbies="Trail Running, Oil Painting, Jazz Piano", email="sarah@apex.io",   tags="executive,innovator,speaker",    notes="Met at TechSummit 2022. Strong advocate for human-centered design. Potential board candidate.")
    marcus = Employee(name="Marcus Vane",     title="Lead Architect",           department="Engineering", company_id=apex.id, node_tier="manager",     persona_description="Systems thinker who believes the best architecture is the one the team can maintain.", hobbies="Rock Climbing, Open Source, Woodworking", email="marcus@apex.io", tags="engineer,architect,open-source", notes="Previously at Google for 4 years. Left to pursue more impactful work. Strong systems thinking.")
    elena  = Employee(name="Elena Rodriguez", title="Director of Product",      department="Product",     company_id=apex.id, node_tier="manager",     persona_description="User-obsessed product leader who turns messy signals into crisp strategy.", hobbies="Ceramics, Cycling, Science Fiction", email="elena@apex.io",   tags="product,strategy,ux",            notes="Runs best retrospectives in the industry. Has been approached by two competitors in the last year.")
    aiko   = Employee(name="Aiko Tanaka",     title="Senior Engineer",          department="Engineering", company_id=apex.id, node_tier="contributor", persona_description="Full-stack craftsperson with a strong focus on performance and accessibility.", hobbies="Kendo, Origami, Competitive Puzzles", email="aiko@apex.io",   tags="engineer,accessibility,fullstack",notes="Published internal guide on progressive enhancement. Quietly influential in the team.")
    dev    = Employee(name="Dev Patel",       title="Product Designer",         department="Design",      company_id=apex.id, node_tier="contributor", persona_description="Interaction designer who prototypes before wireframing.", hobbies="Film Photography, Skateboarding, Typography", email="dev@apex.io",     tags="designer,ux,motion",             notes="Motion design work went viral internally. Looking to move into a lead role within 12 months.")
    julian = Employee(name="Julian Frost",    title="Managing Partner",         department="Leadership",  company_id=nova.id, node_tier="executive",   persona_description="Believes psychological safety is the ultimate infrastructure.", hobbies="Improv Comedy, Distance Running, Cooking", email="julian@nova.vc",  tags="investor,partner,advisor",       notes="97% LP retention rate. Has invested in 3 unicorns. Key relationship to maintain.")
    priya  = Employee(name="Priya Sharma",    title="Investment Analyst",       department="Finance",     company_id=nova.id, node_tier="contributor", persona_description="Sharp pattern-recogniser who reads balance sheets the way others read fiction.", hobbies="Chess, Hiking, Podcasting", email="priya@nova.vc",    tags="finance,analyst,investor",       notes="Was at Aiko's previous company. That connection is what brought Nova and Apex together.")
    leon   = Employee(name="Leon Carter",     title="Head of Strategy",         department="Strategy",    company_id=nova.id, node_tier="manager",     persona_description="Turns ambiguity into roadmaps.", hobbies="Jazz Drums, Urban Sketching, Sailing", email="leon@nova.vc",   tags="strategy,advisor,ex-google",     notes="Former Google strategy lead. His technical credibility is what makes the Marcus relationship work.")
    db.session.add_all([sarah,marcus,elena,aiko,dev,julian,priya,leon]); db.session.flush()

    edges = [
        Relationship(source_id=sarah.id,  target_id=marcus.id, connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2020,3,1)),
        Relationship(source_id=sarah.id,  target_id=elena.id,  connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2021,1,15)),
        Relationship(source_id=marcus.id, target_id=aiko.id,   connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2021,6,1)),
        Relationship(source_id=elena.id,  target_id=dev.id,    connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2022,2,1)),
        Relationship(source_id=marcus.id, target_id=elena.id,  connection_type="informal",      label="Collaborator",    reverse_label="Collaborator",    strength=0.8, started_date=date(2021,9,1)),
        Relationship(source_id=aiko.id,   target_id=dev.id,    connection_type="informal",      label="Mentor",          reverse_label="Mentee",          strength=0.7, started_date=date(2022,5,1)),
        Relationship(source_id=julian.id, target_id=leon.id,   connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2018,1,1)),
        Relationship(source_id=leon.id,   target_id=priya.id,  connection_type="formal",        label="Manager",         reverse_label="Reports to",      strength=1.0, started_date=date(2020,8,1)),
        Relationship(source_id=julian.id, target_id=priya.id,  connection_type="informal",      label="Mentor",          reverse_label="Mentee",          strength=0.9, started_date=date(2020,9,1)),
        Relationship(source_id=sarah.id,  target_id=julian.id, connection_type="cross_company", label="Board Advisor",   reverse_label="Advisee",         strength=0.6, started_date=date(2022,11,1)),
        Relationship(source_id=marcus.id, target_id=leon.id,   connection_type="cross_company", label="Tech Advisor",    reverse_label="Advisee",         strength=0.5, started_date=date(2023,3,1)),
        Relationship(source_id=elena.id,  target_id=priya.id,  connection_type="cross_company", label="Conference peer", reverse_label="Conference peer", strength=0.4, started_date=date(2023,6,1)),
        Relationship(source_id=aiko.id,   target_id=priya.id,  connection_type="cross_company", label="Ex-colleague",    reverse_label="Ex-colleague",    strength=0.7, started_date=date(2019,1,1)),
    ]
    db.session.add_all(edges)

    # Seed initial event logs
    events = [
        EventLog(employee_id=sarah.id,  event_type="joined",         description="Joined Apex Innovations as Chief Innovation Officer",             occurred_at=__import__('datetime').datetime(2018,3,1)),
        EventLog(employee_id=marcus.id, event_type="joined",         description="Joined Apex Innovations as Lead Architect",                       occurred_at=__import__('datetime').datetime(2020,3,1)),
        EventLog(employee_id=elena.id,  event_type="joined",         description="Joined Apex Innovations as Director of Product",                  occurred_at=__import__('datetime').datetime(2021,1,15)),
        EventLog(employee_id=aiko.id,   event_type="joined",         description="Joined Apex Innovations as Senior Engineer",                      occurred_at=__import__('datetime').datetime(2021,6,1)),
        EventLog(employee_id=dev.id,    event_type="joined",         description="Joined Apex Innovations as Product Designer",                     occurred_at=__import__('datetime').datetime(2022,2,1)),
        EventLog(employee_id=julian.id, event_type="joined",         description="Founded Nova Ventures as Managing Partner",                       occurred_at=__import__('datetime').datetime(2015,1,1)),
        EventLog(employee_id=leon.id,   event_type="joined",         description="Joined Nova Ventures as Head of Strategy from Google",            occurred_at=__import__('datetime').datetime(2018,1,1)),
        EventLog(employee_id=priya.id,  event_type="joined",         description="Joined Nova Ventures as Investment Analyst",                      occurred_at=__import__('datetime').datetime(2020,8,1)),
        EventLog(employee_id=marcus.id, event_type="note",           description="Previously at Google for 4 years before joining Apex",           occurred_at=__import__('datetime').datetime(2020,3,2)),
        EventLog(employee_id=priya.id,  event_type="connected",      description="Connected with Aiko Tanaka — former colleague from previous role",occurred_at=__import__('datetime').datetime(2019,1,15)),
        EventLog(employee_id=sarah.id,  event_type="connected",      description="Connected with Julian Frost as Board Advisor",                    occurred_at=__import__('datetime').datetime(2022,11,5)),
    ]
    db.session.add_all(events)
    db.session.commit()
    print("✅  Phase A sample data seeded.")


def _seed_admin_user():
    """Create default admin user if none exists."""
    import hashlib
    if User.query.first(): return
    salt = os.environ.get("SECRET_KEY", "hn-default-salt")
    pw   = os.environ.get("ADMIN_PASSWORD", "admin123")
    pw_hash = hashlib.sha256(f"{salt}{pw}".encode()).hexdigest()
    admin = User(
        username="admin",
        email="admin@humannetwork.local",
        password_hash=pw_hash,
        role="admin",
        is_active=True,
    )
    db.session.add(admin)
    db.session.commit()
    print(f"✅  Default admin created — username: admin / password: {pw}")


app = create_app()
if __name__ == "__main__":
    app.run(debug=True, port=5000, host="100.87.134.59")
