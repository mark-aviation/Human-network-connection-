import os, uuid, json, csv, io
from pathlib import Path
from flask import Flask, jsonify, request, render_template, Response
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
from models import db, Company, Employee, Relationship, COMPANY_COLORS

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def create_app(config=None):
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "change-me-in-production"),
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", "sqlite:///humannetwork.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_recycle": 280, "pool_pre_ping": True},
        UPLOAD_FOLDER=Path(__file__).parent / "static" / "uploads",
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        ALLOWED_EXTENSIONS={"png", "jpg", "jpeg", "webp", "gif"},
        IMAGE_URL_BASE="/static/uploads/",
    )
    if config: app.config.update(config)
    app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        _seed_sample_data()
    _register_routes(app)
    return app


def _register_routes(app):

    # ── Page routes ──────────────────────────────
    @app.route("/")
    def index(): return render_template("index.html", active="map")

    @app.route("/directory")
    def directory(): return render_template("directory.html", active="directory")

    @app.route("/insights")
    def insights(): return render_template("insights.html", active="insights")

    @app.route("/settings")
    def settings(): return render_template("settings.html", active="settings")

    # ── Graph API ────────────────────────────────
    @app.route("/api/graph")
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
    def get_employee(eid):
        return jsonify(Employee.query.get_or_404(eid).to_node(app.config["IMAGE_URL_BASE"]))

    @app.route("/api/employees", methods=["POST"])
    def create_employee():
        required = ["name", "title", "department"]
        missing  = [f for f in required if not request.form.get(f, "").strip()]
        if missing: return jsonify({"error": f"Missing: {', '.join(missing)}"}), 400
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
    def update_employee(eid):
        e = Employee.query.get_or_404(eid)
        data = request.get_json(force=True)
        for f in ["name","title","department","persona_description","hobbies","email","node_tier"]:
            if f in data: setattr(e, f, data[f] or None)
        if "company_id" in data: e.company_id = data["company_id"] or None
        db.session.commit()
        return jsonify(e.to_node(app.config["IMAGE_URL_BASE"]))

    @app.route("/api/employees/<int:eid>", methods=["DELETE"])
    def delete_employee(eid):
        e = Employee.query.get_or_404(eid)
        db.session.delete(e); db.session.commit()
        return jsonify({"deleted": eid})

    @app.route("/api/employees/<int:eid>/image", methods=["POST"])
    def upload_image(eid):
        e = Employee.query.get_or_404(eid)
        file = request.files.get("profile_image")
        if not file or not file.filename: return jsonify({"error": "No file"}), 400
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
        if not data.get("name","").strip(): return jsonify({"error": "name required"}), 400
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
            return jsonify({"error": "source_id and target_id required"}), 400
        Employee.query.get_or_404(data["source_id"])
        Employee.query.get_or_404(data["target_id"])
        rel = Relationship(
            source_id=data["source_id"], target_id=data["target_id"],
            connection_type=data.get("connection_type","formal"),
            label=data.get("label",""), strength=float(data.get("strength",1.0)),
        )
        db.session.add(rel)
        try: db.session.commit()
        except: db.session.rollback(); return jsonify({"error": "Already exists or invalid"}), 409
        return jsonify(rel.to_edge()), 201

    @app.route("/api/relationships/<int:rid>", methods=["DELETE"])
    def delete_relationship(rid):
        r = Relationship.query.get_or_404(rid)
        db.session.delete(r); db.session.commit()
        return jsonify({"deleted": rid})

    # ── Insights API ─────────────────────────────
    @app.route("/api/insights")
    def get_insights():
        base  = app.config["IMAGE_URL_BASE"]
        emps  = Employee.query.all()
        rels  = Relationship.query.all()
        comps = Company.query.all()

        # Connection counts per person
        conn_count = {}
        for r in rels:
            conn_count[r.source_id] = conn_count.get(r.source_id, 0) + 1
            conn_count[r.target_id] = conn_count.get(r.target_id, 0) + 1

        # Most connected
        most_connected = []
        if conn_count:
            sorted_ids = sorted(conn_count, key=lambda x: conn_count[x], reverse=True)[:5]
            for eid in sorted_ids:
                e = Employee.query.get(eid)
                if e: most_connected.append({**e.to_node(base), "connections": conn_count[eid]})

        # Isolated nodes
        connected_ids = set(conn_count.keys())
        isolated = [e.to_node(base) for e in emps if e.id not in connected_ids]

        # Department breakdown
        dept_counts = {}
        for e in emps:
            dept_counts[e.department] = dept_counts.get(e.department, 0) + 1

        # Company breakdown
        comp_counts = {}
        for e in emps:
            if e.company_id:
                co = Company.query.get(e.company_id)
                if co: comp_counts[co.name] = comp_counts.get(co.name, 0) + 1

        # Edge type breakdown
        edge_types = {"formal": 0, "informal": 0, "cross_company": 0}
        for r in rels: edge_types[r.connection_type] = edge_types.get(r.connection_type, 0) + 1

        # Cross-company bridges (people with cross_company connections)
        bridge_ids = set()
        for r in rels:
            if r.connection_type == "cross_company":
                bridge_ids.add(r.source_id); bridge_ids.add(r.target_id)
        bridges = [e.to_node(base) for e in emps if e.id in bridge_ids]

        # Relationship health score (0-100): more informal = healthier
        total = len(rels)
        health = round((edge_types["informal"] / total * 100) if total else 0)

        return jsonify({
            "summary": {
                "total_people":      len(emps),
                "total_companies":   len(comps),
                "total_connections": total,
                "cross_company_links": edge_types["cross_company"],
                "health_score":      health,
            },
            "most_connected":    most_connected,
            "isolated":          isolated,
            "bridges":           bridges,
            "dept_breakdown":    [{"dept": k, "count": v} for k,v in dept_counts.items()],
            "company_breakdown": [{"company": k, "count": v} for k,v in comp_counts.items()],
            "edge_types":        edge_types,
        })

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
        writer.writerow(["id","name","title","department","company","tier","email"])
        for e in Employee.query.all():
            co = Company.query.get(e.company_id) if e.company_id else None
            writer.writerow([e.id, e.name, e.title, e.department, co.name if co else "", e.node_tier, e.email or ""])
        return Response(output.getvalue(), mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=employees.csv"})

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_): return jsonify({"error": "File > 5MB"}), 413

    @app.errorhandler(404)
    def not_found(_): return jsonify({"error": "Not found"}), 404


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
    apex = Company(name="Apex Innovations", industry="Technology", description="A forward-thinking tech company building tools that put humans first.", color_index=0, founded_year=2018)
    nova = Company(name="Nova Ventures",    industry="Finance & Strategy", description="A boutique strategy firm connecting capital with emerging ideas.", color_index=1, founded_year=2015)
    db.session.add_all([apex, nova]); db.session.flush()

    sarah  = Employee(name="Sarah Chen",      title="Chief Innovation Officer", department="Executive",   company_id=apex.id, node_tier="executive",   persona_description="A visionary leader who prioritizes empathy and collaborative brainstorming.", hobbies="Trail Running, Oil Painting, Jazz Piano", email="sarah@apex.io")
    marcus = Employee(name="Marcus Vane",     title="Lead Architect",           department="Engineering", company_id=apex.id, node_tier="manager",     persona_description="Systems thinker who believes the best architecture is the one the team can maintain.", hobbies="Rock Climbing, Open Source, Woodworking", email="marcus@apex.io")
    elena  = Employee(name="Elena Rodriguez", title="Director of Product",      department="Product",     company_id=apex.id, node_tier="manager",     persona_description="User-obsessed product leader who turns messy signals into crisp strategy.", hobbies="Ceramics, Cycling, Science Fiction", email="elena@apex.io")
    aiko   = Employee(name="Aiko Tanaka",     title="Senior Engineer",          department="Engineering", company_id=apex.id, node_tier="contributor", persona_description="Full-stack craftsperson with a strong focus on performance and accessibility.", hobbies="Kendo, Origami, Competitive Puzzles", email="aiko@apex.io")
    dev    = Employee(name="Dev Patel",       title="Product Designer",         department="Design",      company_id=apex.id, node_tier="contributor", persona_description="Interaction designer who prototypes before wireframing.", hobbies="Film Photography, Skateboarding, Typography", email="dev@apex.io")
    julian = Employee(name="Julian Frost",    title="Managing Partner",         department="Leadership",  company_id=nova.id, node_tier="executive",   persona_description="Believes psychological safety is the ultimate infrastructure.", hobbies="Improv Comedy, Distance Running, Cooking", email="julian@nova.vc")
    priya  = Employee(name="Priya Sharma",    title="Investment Analyst",       department="Finance",     company_id=nova.id, node_tier="contributor", persona_description="Sharp pattern-recogniser who reads balance sheets the way others read fiction.", hobbies="Chess, Hiking, Podcasting", email="priya@nova.vc")
    leon   = Employee(name="Leon Carter",     title="Head of Strategy",         department="Strategy",    company_id=nova.id, node_tier="manager",     persona_description="Turns ambiguity into roadmaps.", hobbies="Jazz Drums, Urban Sketching, Sailing", email="leon@nova.vc")
    db.session.add_all([sarah,marcus,elena,aiko,dev,julian,priya,leon]); db.session.flush()

    edges = [
        Relationship(source_id=sarah.id,  target_id=marcus.id, connection_type="formal",        label="Leads Engineering"),
        Relationship(source_id=sarah.id,  target_id=elena.id,  connection_type="formal",        label="Leads Product"),
        Relationship(source_id=marcus.id, target_id=aiko.id,   connection_type="formal",        label="Manages"),
        Relationship(source_id=elena.id,  target_id=dev.id,    connection_type="formal",        label="Manages"),
        Relationship(source_id=marcus.id, target_id=elena.id,  connection_type="informal",      label="Co-leads roadmap"),
        Relationship(source_id=aiko.id,   target_id=dev.id,    connection_type="informal",      label="Design × Eng pairing"),
        Relationship(source_id=julian.id, target_id=leon.id,   connection_type="formal",        label="Leads Strategy"),
        Relationship(source_id=leon.id,   target_id=priya.id,  connection_type="formal",        label="Manages"),
        Relationship(source_id=julian.id, target_id=priya.id,  connection_type="informal",      label="Mentors"),
        Relationship(source_id=sarah.id,  target_id=julian.id, connection_type="cross_company", label="Board advisor", strength=0.6),
        Relationship(source_id=marcus.id, target_id=leon.id,   connection_type="cross_company", label="Tech advisor",  strength=0.5),
        Relationship(source_id=elena.id,  target_id=priya.id,  connection_type="cross_company", label="Conference friends", strength=0.4),
        Relationship(source_id=aiko.id,   target_id=priya.id,  connection_type="cross_company", label="Ex-colleagues", strength=0.4),
    ]
    db.session.add_all(edges); db.session.commit()
    print("✅  v3 sample data seeded.")


app = create_app()
if __name__ == "__main__":
    app.run(debug=True, port=5000)
