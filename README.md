# The Human Network — Living Atlas
### Full-Stack Python Org & Relationship Mapper

---

## Project Structure

```
human-network/
├── app.py              # 💎 Flask app + API routes (Senior Python Engineer)
├── models.py           # 🏛️  SQLAlchemy ORM models (Software Architect)
├── schema.sql          # 🏛️  Raw MySQL schema (alternative to ORM migration)
├── requirements.txt    # Python dependencies
├── templates/
│   └── index.html      # 📐🎨 HTML structure + CSS design system (UX Architect + UI Designer)
└── static/
    ├── js/
    │   └── network.js  # 🎬 D3.js graph + interactions (Visual Storyteller)
    └── uploads/        # Profile pictures (auto-created on startup)
```

---

## Quick Start

### 1. MySQL Database
```bash
# Option A: Let SQLAlchemy create tables automatically (recommended)
# Just set DATABASE_URL and run the app — db.create_all() handles it.

# Option B: Run the SQL schema directly
mysql -u root -p < schema.sql
```

### 2. Environment
```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure Database URL
```bash
# Set your MySQL connection string
export DATABASE_URL="mysql+pymysql://USER:PASSWORD@localhost/human_network"
export SECRET_KEY="your-secret-key-here"

# Or create a .env file:
echo 'DATABASE_URL=mysql+pymysql://root:password@localhost/human_network' > .env
echo 'SECRET_KEY=change-me-in-production' >> .env
```

### 4. Run
```bash
python app.py
# Open http://localhost:5000
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/graph` | Full graph: nodes + edges split by type |
| GET    | `/api/employees/<id>` | Single employee detail |
| POST   | `/api/employees` | Create employee + upload profile picture |
| POST   | `/api/employees/<id>/image` | Replace profile picture only |
| POST   | `/api/relationships` | Create a relationship edge |

### POST /api/employees — multipart/form-data
| Field | Type | Required |
|-------|------|----------|
| name | string | ✅ |
| title | string | ✅ |
| department | string | ✅ |
| node_tier | `executive` \| `manager` \| `contributor` | — |
| persona_description | string | — |
| hobbies | comma-separated string | — |
| profile_image | file (.png/.jpg/.webp) | — |

### POST /api/relationships — JSON body
```json
{
  "source_id": 1,
  "target_id": 3,
  "connection_type": "informal",
  "label": "Co-leads roadmap",
  "strength": 0.8
}
```

---

## Design System: "The Living Atlas"

| Token | Value |
|-------|-------|
| Primary Purple | `#8127cf` |
| Secondary Teal | `#006b5f` |
| Tertiary Coral | `#a63047` |
| Surface Canvas | `#faf8ff` |
| No-Line Rule | Use tonal layers, never 1px solid borders |
| Glassmorphism | `backdrop-filter: blur(12px)`, 80% opacity surface |
| Connector curves | Organic bezier arcs, never 90° angles |

---

## Agent Contributions

| Agent | Role | Deliverables |
|-------|------|-------------|
| 🏛️ Software Architect | System design | `models.py`, `schema.sql`, ADRs |
| 💎 Senior Python Engineer | Backend & API | `app.py`, all endpoints, file upload logic |
| 📐 UX Architect | Layout & structure | HTML skeleton, CSS token system, grid layout |
| 🎨 UI Designer | Visual design | Living Atlas styling, glassmorphism panel, avatar CSS |
| 🎬 Visual Storyteller | Interactive canvas | D3.js graph, node click narrative, panel population |
