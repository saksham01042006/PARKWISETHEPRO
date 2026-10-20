# Final Submission Checklist

## Before the demonstration
- [ ] Import `database.sql` into MySQL 8 using a disposable database (the script drops/recreates `parkwise`).
- [ ] Set `.env` locally; verify it is ignored by Git and never put credentials in screenshots or the ZIP.
- [ ] Run `python app.py` and verify `/api/health` says the database is connected.
- [ ] Check slot availability for a future time in the lot's operating hours.
- [ ] Create a booking and verify the `bookings` and `payments` rows in MySQL.
- [ ] Try to create an overlapping booking for the same slot; show that it is rejected.
- [ ] Cancel a booking and verify its status/payment status changed.
- [ ] Extend a booking and verify `booking_extensions` and additional `payments` rows.
- [ ] Run the analytical queries at the bottom of `database.sql`.
- [ ] Capture screenshots of the UI, successful booking, conflict response, schema, view and trigger for the report.
- [ ] Review `PROJECT_REPORT.md`, `ER_DIAGRAM.mmd` and `VIVA_QUESTIONS.md`.

## Be transparent in the viva
- [ ] State that payment is simulated, not a real payment gateway.
- [ ] State that the frontend uses a fixed demo user ID because login is not implemented.
- [ ] Distinguish the visual hero demo from the database-backed slot map/cards.
- [ ] Do not claim the system is production-ready or authenticated.
