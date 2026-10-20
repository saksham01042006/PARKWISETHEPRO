# ParkWise — Smart Parking Management System

A DBMS course project demonstrating a relational database and a Flask web application. The frontend provides an interactive parking map, time-based slot search, booking, booking history, cancellation, extension and a simulated checkout. MySQL is the source of truth for slot availability and booking records; if MySQL is unavailable, the UI shows an error instead of silently displaying fake slot data.

## Project structure

```text
parkwise/
├── app.py                 # Flask routes and request validation
├── database.py            # MySQL connection pool, queries and transactions
├── database.sql           # Schema, seed data, views, triggers and report queries
├── templates/index.html   # Main UI
├── static/style.css       # UI styles
├── static/script.js       # Frontend API integration
├── .env.example           # Environment variable template (safe to commit)
├── PROJECT_REPORT.md      # Report content for submission
├── ER_DIAGRAM.mmd         # Mermaid ER diagram source
├── VIVA_QUESTIONS.md      # Viva preparation and demo flow
├── tests.py               # API route tests (mocked data layer)
└── requirements.txt       # Python dependencies
```

## Requirements
- Python 3.10 or newer
- MySQL 8.0 or newer (InnoDB)
- A terminal with the MySQL client, or MySQL Workbench to execute the SQL script

## Local setup (Windows PowerShell)

1. Open a terminal in the project directory.
2. Create and activate a virtual environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install packages:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Copy `.env.example` to `.env` and set `DB_PASSWORD` to your actual local MySQL password. Do not commit `.env`.
5. Import the schema:

   ```powershell
   mysql -u root -p < database.sql
   ```

   **Warning:** `database.sql` drops and recreates the `parkwise` database. Back up any existing project data before running it.

   If PowerShell does not accept input redirection for your MySQL setup, open MySQL Workbench and run the full `database.sql` script there. The script uses MySQL `DELIMITER` for triggers.

6. Start Flask:

   ```powershell
   python app.py
   ```

7. Open `http://127.0.0.1:5000/api/health`. Expected response: `{"success": true, "database": "connected"}`. Then open `http://127.0.0.1:5000`.

## Test routes without the browser

- Health: `GET http://127.0.0.1:5000/api/health`
- Slots: `GET /api/slots?location=VIT%20Parking&vehicle_type=car&booking_date=2026-10-20&start_time=10:00&duration_hours=2`
- Booking history: `GET /api/bookings?user_id=1&status=all`
- Dashboard: `GET /api/stats`

Booking, cancellation and extension endpoints accept JSON. Examples and response expectations are described in `PROJECT_REPORT.md` and the JavaScript frontend.

## Automated route tests

After installing the requirements, run:

```powershell
python -m unittest tests.py
```

These tests mock database functions and do not replace end-to-end testing against a real MySQL server. Use the test plan in `PROJECT_REPORT.md` for database integration checks.

## Demo data

The SQL seed creates sample users, vehicles, lots, zones, 13 slots, amenities and booking/payment history. No sign-in is required: the frontend and API use demo user ID `1` for bookings. This is a local classroom demonstration configuration, not production authentication; bookings are not private to individual visitors.

Payment methods are simulated; the application does not process real UPI, card or cash transactions. The demo UPI ID is illustrative only. The hero parking strip is a visual interaction demo; the main map, slot cards and booking history are driven by the Flask/MySQL API.

## Database features to explain in viva

- Primary and foreign keys, `UNIQUE`, `NOT NULL`, `CHECK` constraints and `ENUM` statuses
- One-to-many relationships and the `slot_amenities` many-to-many bridge table
- Availability query using `NOT EXISTS` and time-range overlap conditions
- Transaction boundaries, `SELECT ... FOR UPDATE`, commit and rollback
- Indexes for booking lookups, views for reporting and triggers for validation
- Stored price snapshots and extension audit history

## Docker / deployment note

The included Dockerfile runs Flask through Gunicorn. A deployed instance also needs a reachable MySQL service and environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). Do not deploy this version publicly without adding real authentication, authorization and a real payment-provider integration.
