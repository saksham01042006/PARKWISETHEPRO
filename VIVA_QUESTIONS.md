# ParkWise — Viva Preparation

## Project overview
**Q1. What is ParkWise?**  
A smart parking reservation application. It checks availability for a time window, books slots, records payments, supports cancellation/extensions, and displays booking history.

**Q2. What is your technology stack?**  
HTML, CSS and JavaScript for the frontend; Python Flask for the REST API; MySQL with InnoDB for persistent storage; `mysql-connector-python` for database access.

**Q3. What is the main DBMS concept demonstrated?**  
Relational schema design with primary/foreign keys, normalization, joins, subqueries, indexes, constraints, transactions, triggers and views.

## Schema and normalization
**Q4. Why do you have a `zones` table?**  
A lot can contain multiple zones. Storing zone information separately avoids repeating zone attributes in every slot row.

**Q5. Why use `slot_amenities`?**  
The relationship between slots and amenities is many-to-many. The bridge table represents it without comma-separated values or repeated columns.

**Q6. What is a primary key?**  
A column or set of columns that uniquely identifies a row and cannot be NULL.

**Q7. What is a foreign key?**  
A constraint that requires a referenced row to exist, maintaining referential integrity.

**Q8. How does the design reduce redundancy?**  
Users, vehicles, lots, zones, slots, amenities, bookings and payments are stored in separate related tables. Repeating values are referenced through keys.

**Q9. Why store booking amounts?**  
They preserve the price snapshot at booking time. A later rate change should not rewrite historical charges.

## Availability and transactions
**Q10. How is availability calculated?**  
The query finds slots for which no active booking overlaps the requested interval. Overlap is `existing.start_ts < requested_end AND existing.end_ts > requested_start`.

**Q11. Why use a transaction for booking?**  
The slot lock, overlap check, booking insert and payment insert must succeed or fail together. A rollback prevents partial writes.

**Q12. What does `SELECT ... FOR UPDATE` do?**  
It locks selected rows for the transaction so competing transactions attempting to lock the same slot must wait.

**Q13. What is a race condition in booking?**  
Two requests can both observe a slot as free before either inserts a booking. Locking the slot row serializes the critical section.

**Q14. How do you avoid overlapping bookings?**  
Use the overlap predicate inside the transaction and a trigger as a second validation layer.

**Q15. Why use `[start, end)` intervals?**  
The start is included and the end is excluded, so a booking ending at 12:00 can be followed by one starting at 12:00.

**Q16. Why keep a `booking_extensions` table?**  
It preserves an audit history of each extension, including the old end time, new end time and extra charge.

## SQL and backend
**Q17. Why use parameterized queries?**  
They separate SQL structure from user-supplied values and help prevent SQL injection.

**Q18. What is an index?**  
An auxiliary structure that can speed up lookups and joins. It consumes storage and can add write overhead.

**Q19. What is a view?**  
A saved query exposed like a virtual table. ParkWise uses views for active bookings and current lot occupancy.

**Q20. What is a trigger?**  
A database routine automatically executed for an event such as INSERT or UPDATE. The project uses triggers to reject incompatible vehicle/slot types and overlapping reservations.

**Q21. What does HTTP 409 mean in this project?**  
Conflict. The requested slot/time conflicts with an existing booking.

**Q22. Does the project process real payments?**  
No. Payment methods and payment records are simulated for the course demonstration.

**Q23. Does the app have production authentication?**  
Not yet. The current UI uses a fixed demo user ID, so it is intended for a local classroom demonstration and should not be deployed publicly as-is.

## Demo flow to rehearse
1. Open `/api/health` and show the database is connected.
2. Open the homepage and filter by lot and vehicle type.
3. Select a future time, reserve a slot and show the digital pass.
4. Open booking history and show the booking from MySQL.
5. Try an overlapping booking for the same slot and show the conflict response.
6. Cancel a booking, then show the changed status in history.
7. Run the report queries in `database.sql` and explain the view/trigger definitions.
