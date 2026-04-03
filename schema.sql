-- ════════════════════════════════════════════════════
-- 🏛️  SOFTWARE ARCHITECT — MySQL Schema
--     The Human Network | Living Atlas Design System
--
-- Run this once to create the database and tables,
-- OR let SQLAlchemy's db.create_all() do it automatically.
--
-- Arch Decision: InnoDB for FK enforcement + transactions.
-- ════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS human_network
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE human_network;

-- ── Employees (graph nodes) ───────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(120)  NOT NULL,
  title               VARCHAR(120)  NOT NULL,
  department          VARCHAR(80)   NOT NULL,
  persona_description TEXT,
  hobbies             VARCHAR(255),
  profile_image       VARCHAR(255),          -- filename only, e.g. "abc123.jpg"
  node_tier           ENUM('executive', 'manager', 'contributor')
                        NOT NULL DEFAULT 'contributor',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_department (department),
  INDEX idx_node_tier  (node_tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Relationships (graph edges) ───────────────────
--
-- connection_type:
--   formal   → solid grey line  (reporting / hierarchy)
--   informal → dotted teal line (mentorship / collaboration)
--
-- strength  → 0.0–1.0, used by frontend for edge thickness/opacity

CREATE TABLE IF NOT EXISTS relationships (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_id       INT UNSIGNED NOT NULL,
  target_id       INT UNSIGNED NOT NULL,
  connection_type ENUM('formal', 'informal') NOT NULL DEFAULT 'formal',
  label           VARCHAR(80),
  strength        FLOAT DEFAULT 1.0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_source FOREIGN KEY (source_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_target FOREIGN KEY (target_id)
    REFERENCES employees(id) ON DELETE CASCADE,

  -- Prevent duplicate edges of the same type between two nodes
  UNIQUE KEY uq_relationship (source_id, target_id, connection_type),

  INDEX idx_source (source_id),
  INDEX idx_target (target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Optional: seed sample data ───────────────────
-- The Flask app seeds this automatically on first run,
-- but you can also run this directly for a fresh start.

INSERT IGNORE INTO employees (name, title, department, node_tier, persona_description, hobbies) VALUES
('Sarah Chen',     'Chief Innovation Officer', 'Executive',  'executive',   'A visionary leader who prioritizes empathy and collaborative brainstorming.',      'Trail Running, Oil Painting, Jazz Piano'),
('Marcus Vane',    'Lead Architect',           'Engineering','manager',     'Systems thinker who believes the best architecture is the one the team can maintain.','Rock Climbing, Open Source, Woodworking'),
('Elena Rodriguez','Director of Product',      'Product',    'manager',     'User-obsessed product leader who turns messy signals into crisp strategy.',         'Ceramics, Cycling, Science Fiction'),
('Julian Frost',   'Head of Culture',          'People',     'manager',     'Believes psychological safety is the ultimate infrastructure.',                     'Improv Comedy, Distance Running, Cooking'),
('Aiko Tanaka',    'Senior Engineer',          'Engineering','contributor', 'Full-stack craftsperson with a strong focus on performance and accessibility.',      'Kendo, Origami, Competitive Puzzles'),
('Dev Patel',      'Product Designer',         'Design',     'contributor', 'Interaction designer who prototypes before wireframing.',                           'Film Photography, Skateboarding, Typography');
