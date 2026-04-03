# Human Network Connection

A web-based visualization tool for mapping and exploring organizational networks, employee relationships, and cross-company connections.

## Features

- 🌐 **Interactive Network Graph** - Visualize employees and relationships in a dynamic, zoomable network
- 🏢 **Company Management** - Create and manage multiple organizations
- 👥 **Employee Directory** - Add employees with profiles, roles, and hobbies
- 🔗 **Relationship Mapping** - Track formal, informal, and cross-company connections
- 📊 **Organizational Charts** - View hierarchy-based org charts by company
- 🎨 **Dark/Light Theme** - Toggle between light and dark modes
- 🔍 **Search & Filter** - Find employees, departments, and companies quickly

## Tech Stack

**Backend:**
- Flask (Python web framework)
- SQLAlchemy (ORM)
- SQLite or MySQL (database)

**Frontend:**
- Vanilla JavaScript (D3.js for network visualization)
- HTML5 & CSS3
- Responsive design

## Installation

### Prerequisites
- Python 3.8+
- pip (Python package manager)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mark-aviation/Human-network-connection-.git
   cd Human-network-connection-
   ```

2. **Create a virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install flask flask-sqlalchemy flask-cors werkzeug python-dotenv
   ```

4. **Configure environment**
   ```bash
   # Create .env file from example
   cp .env.example .env
   ```
   Edit `.env` and set your configuration (optional for local development):
   ```
   DATABASE_URL=sqlite:///humannetwork.db
   SECRET_KEY=your-secure-secret-key
   ```

5. **Run the application**
   ```bash
   python app.py
   ```
   The app will be available at `http://localhost:5000`

## Usage

### Main Pages

- **Map** (`/`) - Interactive network visualization of all employees and relationships
- **Directory** (`/directory`) - Browse and search employees, filter by company/department
- **Insights** (`/insights`) - Analytics and network insights (expandable)
- **Settings** (`/settings`) - Application configuration

### API Endpoints

#### Employees
- `GET /api/employees` - List all employees (supports filtering)
- `GET /api/employees/<id>` - Get employee details
- `POST /api/employees` - Create new employee
- `PUT /api/employees/<id>` - Update employee
- `DELETE /api/employees/<id>` - Delete employee
- `POST /api/employees/<id>/image` - Upload profile image

#### Companies
- `GET /api/companies` - List all companies
- `GET /api/companies/<id>/org` - Get company org chart
- `POST /api/companies` - Create company
- `PUT /api/companies/<id>` - Update company
- `DELETE /api/companies/<id>` - Delete company

#### Relationships
- `POST /api/relationships` - Create connection between employees
- `GET /api/graph` - Get full network graph data

## Project Structure

```
.
├── app.py              # Flask application and API routes
├── models.py           # Database models (Company, Employee, Relationship)
├── base.js             # Shared utilities (theme, API helpers, toast)
├── network.js          # D3.js network visualization
├── base.css            # Shared styling
├── index.html          # Main network map page
├── directory.html      # Employee directory page
├── insights.html       # Analytics page
├── settings.html       # Settings page
├── .env.example        # Environment variables template
├── .gitignore          # Git ignored files
└── static/uploads/     # User-uploaded profile images
```

## Database Models

### Company
- name, industry, description
- logo_image, color_index, founded_year
- Relationships: employees (1-to-many)

### Employee
- name, title, department, email
- company_id (foreign key)
- persona_description, hobbies
- profile_image, node_tier (executive/manager/contributor)

### Relationship
- source_id, target_id (foreign keys to Employee)
- connection_type (formal/informal/cross_company)
- label, strength

## Customization

### Colors & Styling
- Edit `base.css` for theme colors and layout
- Modify `COMPANY_COLORS` in `models.py` to add company colors

### Network Physics
- Adjust D3 force simulation parameters in `network.js`
- Configure node sizes via `TIER_R` and colors via `TIER_C`

## Security Notes

⚠️ **Important:**
- Never commit `.env` files (included in `.gitignore`)
- Set a strong `SECRET_KEY` for production
- Use environment variables for database credentials
- Keep `root:password` references out of code (all references removed)

## Development

### Adding Features
1. Add database model to `models.py`
2. Create API endpoint in `app.py`
3. Add frontend UI in corresponding HTML file
4. Update `network.js` or related JS files for visualization

### Testing
- Use browser DevTools to test API responses
- Check browser console for JavaScript errors
- Verify database with SQLAlchemy session queries

## Troubleshooting

**Port 5000 already in use:**
```bash
python app.py --port 5001
```

**Database errors:**
- Delete `humannetwork.db` to reset database
- Check `DATABASE_URL` in `.env`

**Image uploads not working:**
- Ensure `static/uploads/` directory exists and is writable
- Check `MAX_CONTENT_LENGTH` in `app.py` (default 5MB)

## License

This project is licensed under the MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit pull requests.

## Support

For issues and questions, please open an issue on GitHub.

---

**Last Updated:** April 2026
