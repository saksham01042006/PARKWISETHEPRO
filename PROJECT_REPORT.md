# ParkWise — Smart Parking Management System

## 1. Abstract
ParkWise is a database-driven parking reservation application built with Flask, MySQL, HTML, CSS and JavaScript. It lets a user filter parking spaces by lot and vehicle type, check availability for a selected time window, create a booking, view booking history, cancel a booking and request an extension. The backend uses MySQL transactions and row locking to reduce the risk of two concurrent users reserving the same slot for overlapping periods.

## 2. Problem statement
Manual parking allocation can cause unnecessary searching, uncertain availability, duplicate allocation and poor booking records. ParkWise models parking lots, zones, spaces, users, vehicles, reservations, payments and amenities in a relational database so availability and reservation history can be queried consistently.

## 3. Objectives
- Store parking lots, zones, slots, vehicles, bookings and payment records in MySQL.
- Calculate availability from booking time ranges instead of a manually maintained occupied flag.
- Prevent overlapping reservations for the same slot.
- Validate that the vehicle type matches the selected slot type.
- Calculate base price, GST and total consistently and preserve the amount charged at booking time.
- Provide booking history and summary queries for reporting.

## 4. Technology stack
| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML5, CSS3, JavaScript | Interactive map, filters, booking forms and ticket UI |
| Backend | Python, Flask | HTTP routes and input validation |
| Database | MySQL 8 / InnoDB | Relational persistence, constraints, indexes, views and triggers |
| Connector | mysql-connector-python | Parameterized SQL and transactions |
| Configuration | python-dotenv | Local environment variables |

## 5. Main modules
1. **Slot search:** filters by lot and vehicle type and checks a requested time interval.
2. **Booking:** validates the user, vehicle and slot; locks the slot row; checks overlapping bookings; calculates price and inserts booking/payment records in one transaction.
3. **Cancellation:** locks the slot and booking, checks status and updates the booking and associated payment statuses.
4. **Extension:** locks the slot before the booking, checks the extension interval for conflicts, updates the booking end time and records the extension and additional payment.
5. **History:** retrieves a user's bookings from MySQL.
6. **Dashboard:** returns occupancy summaries for lots/zones and payment/revenue data.
7. **Amenities:** represents slot features through a many-to-many relationship.

## 6. Database design
The schema contains these core entities:
- `users`: customer/admin identity data and password hashes.
- `vehicles`: registered vehicle number and type, owned by a user.
- `parking_lots`: parking locations and operating hours.
- `zones`: sections within a parking lot.
- `parking_slots`: physical space, vehicle type and hourly rate.
- `amenities`: reusable features such as CCTV, covered parking or EV charging.
- `slot_amenities`: bridge table connecting slots and amenities.
- `bookings`: reservation interval, status and price snapshot.
- `booking_extensions`: audit trail for extension requests.
- `payments`: initial and extension payment records.

### Relationship summary
- One user can register many vehicles and make many bookings.
- One parking lot contains many zones; each zone contains many slots.
- A slot can have many amenities, and an amenity can belong to many slots.
- A booking belongs to one user, one vehicle and one slot.
- A booking can have multiple payment rows because extensions can create additional charges.
- A booking can have multiple extension audit rows over time.

## 7. Normalization notes
The design separates independent entities to reduce duplication. `parking_lots` stores lot attributes, `zones` stores zone attributes, and `parking_slots` stores slot attributes. Reusable amenities are separated from slots using `slot_amenities`, resolving the many-to-many relationship without storing comma-separated values. Payments and extensions are separate child tables because one booking may have several payment events and extension events. Primary keys identify rows; foreign keys preserve referential integrity; unique constraints prevent duplicate emails, vehicle registrations, lot names and slot labels within a zone.

The booking's `base_amount`, `gst_amount` and `total_amount` are a deliberate historical price snapshot. If a lot's hourly rate changes later, an old booking still shows the amount agreed when it was created. These amounts should be written together by the booking transaction and checked for consistency.

## 8. Availability and concurrency
For a requested interval `[requested_start, requested_end)`, a booking overlaps when:

`existing.start_ts < requested_end AND existing.end_ts > requested_start`

The half-open interval means a booking ending at 12:00 does not conflict with another starting at 12:00. The backend locks the parking-slot row with `SELECT ... FOR UPDATE` before checking overlaps and inserting. Operations that lock a booking first perform an initial non-locking lookup to discover its slot, then lock the slot row and finally lock the booking row. This consistent order reduces deadlock risk. The SQL trigger adds a database-level validation layer for vehicle/slot compatibility and overlap checks.

## 9. Pricing rule
The demo pricing rule is:
- `base_amount = hourly_rate × duration_in_hours`
- `gst_amount = base_amount × 5%`, rounded to two decimal places
- `total_amount = base_amount + gst_amount`

Payment UI is a simulator. It does not connect to a bank, card processor or UPI provider. The displayed demo UPI ID must not be used to send real money.

## 10. API summary
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Serve the frontend |
| GET | `/api/health` | Verify MySQL connectivity |
| GET | `/api/slots` | List slots with availability for a time window |
| POST | `/api/book` | Create booking and payment row |
| POST | `/api/cancel` | Cancel a booking |
| POST | `/api/extend` | Extend a booking and record extension/payment |
| GET | `/api/bookings?user_id=1` | Booking history |
| GET | `/api/stats` | Lot/zone occupancy summary |

## 11. Test plan
1. Import `database.sql` into a disposable MySQL database.
2. Open `/api/health`; it should report `database: connected`.
3. Check slots for a future time and verify the JSON fields include `slot_id`, `slot_number`, `status`, `price_per_hour` and `zone`.
4. Book an available slot with a valid vehicle plate and verify one booking and one payment row are inserted.
5. Submit a second booking for the same slot and overlapping interval; it should be rejected with HTTP 409.
6. Book the same slot at a non-overlapping time; it should be accepted if the lot's opening hours permit it.
7. Cancel an active booking and try cancelling it again; the second attempt should be rejected.
8. Extend a booking into a time range already reserved by another booking; the extension should be rejected.
9. Verify booking amount = base amount + GST and that extension charges are separately recorded.
10. Stop MySQL and verify the frontend displays a database error instead of pretending that fake slots are live.

## 12. Limitations and future scope
- The UI uses a fixed demo user ID because full registration/login and session-based authorization are not included. Do not expose this configuration as a public production service.
- Payment methods are simulated and no real transaction occurs.
- The hero parking strip is a visual demonstration; the main map and slot cards are backed by the API.
- Future work could add authentication, role-based admin pages, real payment-provider integration, notifications, QR verification, a reservation waitlist and deployment to a hosted MySQL service.

## 13. Conclusion
ParkWise demonstrates relational modelling, foreign keys, constraints, joins, subqueries, transactions, indexes, triggers, views and a web application that consumes database-backed APIs. It provides a practical basis for a DBMS course demonstration and can be extended after authentication and real payment integration are implemented.
