-- =====================================================================
--  ParkWise - Smart Parking Management System
--  MySQL 8.0+ schema, seed data, views and triggers
--
--  Run with:   mysql -u root -p < database.sql
--  WARNING:    this script DROPS and recreates the `parkwise` database.
--
--  Design notes
--  * Slot availability is NOT stored. A slot is "occupied" for a time window
--    only if an active booking overlaps that window (computed with SQL).
--  * Bookings use DATETIME start_ts / end_ts, so bookings can cross midnight.
--  * Zones, amenities (many-to-many) and prices are real tables/columns.
--  * Prices are snapshotted on each booking (base / GST / total) so old
--    bookings never change when rates change.
--  * All times are stored as IST (Asia/Kolkata) "naive" DATETIME values.
--  * Triggers at the bottom are a second line of defence against
--    double-booking and vehicle/slot type mismatch.
-- =====================================================================

DROP DATABASE IF EXISTS parkwise;
CREATE DATABASE parkwise CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE parkwise;

-- ---------------------------------------------------------------------
--  TABLES
-- ---------------------------------------------------------------------

CREATE TABLE users (
    user_id        INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    email          VARCHAR(100) NOT NULL UNIQUE,
    phone          VARCHAR(15)  NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,          -- werkzeug hash, never plain text
    role           ENUM('admin','user') NOT NULL DEFAULT 'user'
) ENGINE=InnoDB;

CREATE TABLE vehicles (
    vehicle_id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    vehicle_number  VARCHAR(20) NOT NULL UNIQUE,
    vehicle_type    ENUM('car','bike') NOT NULL,
    vehicle_model   VARCHAR(50) NULL,
    CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE parking_lots (
    lot_id        INT AUTO_INCREMENT PRIMARY KEY,
    lot_name      VARCHAR(100) NOT NULL UNIQUE,
    location      VARCHAR(255) NOT NULL,
    opening_time  TIME NOT NULL,
    closing_time  TIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE zones (
    zone_id    INT AUTO_INCREMENT PRIMARY KEY,
    lot_id     INT NOT NULL,
    zone_name  VARCHAR(60) NOT NULL,
    CONSTRAINT fk_zones_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(lot_id),
    CONSTRAINT uq_zone_per_lot UNIQUE (lot_id, zone_name)
) ENGINE=InnoDB;

CREATE TABLE parking_slots (
    slot_id         INT AUTO_INCREMENT PRIMARY KEY,
    zone_id         INT NOT NULL,
    slot_number     VARCHAR(20) NOT NULL,
    slot_type       ENUM('car','bike') NOT NULL,
    price_per_hour  DECIMAL(6,2) NOT NULL,
    CONSTRAINT fk_slots_zone FOREIGN KEY (zone_id) REFERENCES zones(zone_id),
    CONSTRAINT uq_slot_per_zone UNIQUE (zone_id, slot_number),
    CONSTRAINT ck_slot_price CHECK (price_per_hour > 0)
) ENGINE=InnoDB;

-- Many-to-many: a slot has many amenities, an amenity belongs to many slots
CREATE TABLE amenities (
    amenity_id  INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE slot_amenities (
    slot_id     INT NOT NULL,
    amenity_id  INT NOT NULL,
    PRIMARY KEY (slot_id, amenity_id),
    CONSTRAINT fk_sa_slot    FOREIGN KEY (slot_id)    REFERENCES parking_slots(slot_id) ON DELETE CASCADE,
    CONSTRAINT fk_sa_amenity FOREIGN KEY (amenity_id) REFERENCES amenities(amenity_id)  ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE bookings (
    booking_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    vehicle_id    INT NOT NULL,
    slot_id       INT NOT NULL,
    start_ts      DATETIME NOT NULL,
    end_ts        DATETIME NOT NULL,
    base_amount   DECIMAL(10,2) NOT NULL,
    gst_amount    DECIMAL(10,2) NOT NULL,
    total_amount  DECIMAL(10,2) NOT NULL,
    status        ENUM('booked','completed','cancelled') NOT NULL DEFAULT 'booked',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bookings_user    FOREIGN KEY (user_id)    REFERENCES users(user_id),
    CONSTRAINT fk_bookings_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
    CONSTRAINT fk_bookings_slot    FOREIGN KEY (slot_id)    REFERENCES parking_slots(slot_id),
    CONSTRAINT ck_booking_time     CHECK (end_ts > start_ts),
    CONSTRAINT ck_booking_total    CHECK (total_amount = base_amount + gst_amount),
    INDEX idx_booking_slot_time (slot_id, status, start_ts, end_ts),
    INDEX idx_booking_user (user_id, start_ts)
) ENGINE=InnoDB;

-- Every time a session is extended we keep an audit row
CREATE TABLE booking_extensions (
    extension_id   INT AUTO_INCREMENT PRIMARY KEY,
    booking_id     INT NOT NULL,
    extra_minutes  INT NOT NULL,
    old_end_ts     DATETIME NOT NULL,
    new_end_ts     DATETIME NOT NULL,
    extra_amount   DECIMAL(10,2) NOT NULL,         -- including GST
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ext_booking FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    CONSTRAINT ck_ext_minutes CHECK (extra_minutes > 0)
) ENGINE=InnoDB;

-- A booking can have several payments (initial payment + one per extension)
CREATE TABLE payments (
    payment_id      INT AUTO_INCREMENT PRIMARY KEY,
    booking_id      INT NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    payment_method  ENUM('cash','card','upi') NOT NULL,
    payment_status  ENUM('pending','completed','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
    payment_date    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
    CONSTRAINT ck_payment_amount   CHECK (amount > 0),
    INDEX idx_payment_booking (booking_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  SEED DATA
-- ---------------------------------------------------------------------

-- Current time in IST, so demo bookings always look "live" whatever the
-- timezone of the MySQL server is.
SET @ist_now   = UTC_TIMESTAMP() + INTERVAL 330 MINUTE;
SET @ist_today = DATE(@ist_now);

-- Demo logins (password for the two users is 12345, for admin it is admin123)
INSERT INTO users (name, email, phone, password_hash, role) VALUES
('Saksham', 'saksham@gmail.com',   '9876543210', 'pbkdf2:sha256:1000000$1DE0IpMHQ1A8cUY5$583c99f0a1797c29db2710b47b22e6d32b6c4abbb9bcb6a96b05b8c73bb26964', 'user'),
('Rahul',   'rahul@gmail.com',     '9876543211', 'pbkdf2:sha256:1000000$1DE0IpMHQ1A8cUY5$583c99f0a1797c29db2710b47b22e6d32b6c4abbb9bcb6a96b05b8c73bb26964', 'user'),
('Admin',   'admin@parkwise.com',  '9876543212', 'pbkdf2:sha256:1000000$mWgdjdtORZzVjX1h$9508af123222fa7731850eb6ab621ab7022805a71b0e8fe5d8f21eb828ee6580', 'admin');

INSERT INTO vehicles (user_id, vehicle_number, vehicle_type, vehicle_model) VALUES
(1, 'MH12AB1234', 'car',  'Honda City'),
(2, 'MH12CD5678', 'bike', 'Royal Enfield'),
(2, 'MH12EF9012', 'car',  'Hyundai i20');

INSERT INTO parking_lots (lot_name, location, opening_time, closing_time) VALUES
('VIT Parking',  'Bibwewadi, Pune', '06:00:00', '23:00:00'),   -- lot_id 1
('City Parking', 'Swargate, Pune',  '07:00:00', '22:00:00');   -- lot_id 2

INSERT INTO zones (lot_id, zone_name) VALUES
(1, 'Zone A (Ground Floor)'),   -- zone_id 1
(1, 'Zone B (Bike Deck)'),      -- zone_id 2
(2, 'Zone C (Express P1)'),     -- zone_id 3
(2, 'Zone D (Bike Bay)');       -- zone_id 4

-- slot_id is assigned 1..13 in this order
INSERT INTO parking_slots (zone_id, slot_number, slot_type, price_per_hour) VALUES
(1, 'A1', 'car',  30.00),   --  1
(1, 'A2', 'car',  30.00),   --  2
(1, 'A3', 'car',  30.00),   --  3
(1, 'A4', 'car',  35.00),   --  4
(2, 'B1', 'bike', 15.00),   --  5
(2, 'B2', 'bike', 15.00),   --  6
(2, 'B3', 'bike', 15.00),   --  7
(2, 'B4', 'bike', 15.00),   --  8
(3, 'C1', 'car',  50.00),   --  9
(3, 'C2', 'car',  50.00),   -- 10
(3, 'C3', 'car',  50.00),   -- 11
(4, 'C4', 'bike', 20.00),   -- 12
(4, 'C5', 'bike', 20.00);   -- 13

INSERT INTO amenities (name) VALUES
('EV Fast Charger'),   -- 1
('EV Charger'),        -- 2
('CCTV'),              -- 3
('Covered'),           -- 4
('Near Elevator'),     -- 5
('Wide Bay'),          -- 6
('Helmet Locker'),     -- 7
('Valet Available'),   -- 8
('Near Exit');         -- 9

INSERT INTO slot_amenities (slot_id, amenity_id) VALUES
(1, 1), (1, 3), (1, 4),
(2, 5), (2, 4),
(3, 6), (3, 4),
(4, 1), (4, 4),
(5, 7), (5, 3),
(6, 3),
(7, 3),
(8, 3),
(9, 8), (9, 2),
(10, 9), (10, 3),
(11, 6),
(12, 3),
(13, 3);

-- Amount rule: base = price_per_hour x hours, GST = 5% of base, total = base + GST
INSERT INTO bookings
    (user_id, vehicle_id, slot_id, start_ts, end_ts, base_amount, gst_amount, total_amount, status, created_at)
VALUES
-- completed, yesterday
(1, 1,  1, @ist_today - INTERVAL 1 DAY + INTERVAL 10 HOUR, @ist_today - INTERVAL 1 DAY + INTERVAL 12 HOUR,  60.00, 3.00,  63.00, 'completed', @ist_today - INTERVAL 2 DAY + INTERVAL 9 HOUR),
-- upcoming, tomorrow
(2, 2,  5, @ist_today + INTERVAL 1 DAY + INTERVAL 14 HOUR, @ist_today + INTERVAL 1 DAY + INTERVAL 16 HOUR,  30.00, 1.50,  31.50, 'booked',    @ist_now),
-- completed, yesterday
(2, 3,  9, @ist_today - INTERVAL 1 DAY + INTERVAL 9 HOUR,  @ist_today - INTERVAL 1 DAY + INTERVAL 11 HOUR, 100.00, 5.00, 105.00, 'completed', @ist_today - INTERVAL 2 DAY + INTERVAL 20 HOUR),
-- active right now (3 hour sessions)
(2, 3,  3, @ist_now - INTERVAL 1 HOUR, @ist_now + INTERVAL 2 HOUR,  90.00, 4.50,  94.50, 'booked', @ist_now - INTERVAL 1 HOUR),
(2, 2,  7, @ist_now - INTERVAL 1 HOUR, @ist_now + INTERVAL 2 HOUR,  45.00, 2.25,  47.25, 'booked', @ist_now - INTERVAL 1 HOUR),
(1, 1, 11, @ist_now - INTERVAL 1 HOUR, @ist_now + INTERVAL 2 HOUR, 150.00, 7.50, 157.50, 'booked', @ist_now - INTERVAL 1 HOUR);

INSERT INTO payments (booking_id, amount, payment_method, payment_status, payment_date) VALUES
(1,  63.00, 'upi',  'completed', @ist_today - INTERVAL 2 DAY + INTERVAL 9 HOUR),
(2,  31.50, 'card', 'completed', @ist_now),
(3, 105.00, 'upi',  'completed', @ist_today - INTERVAL 2 DAY + INTERVAL 20 HOUR),
(4,  94.50, 'upi',  'completed', @ist_now - INTERVAL 1 HOUR),
(5,  47.25, 'cash', 'pending',   @ist_now - INTERVAL 1 HOUR),   -- pay at gate
(6, 157.50, 'card', 'completed', @ist_now - INTERVAL 1 HOUR);

-- ---------------------------------------------------------------------
--  VIEWS
-- ---------------------------------------------------------------------

-- Bookings that are running or upcoming right now (IST)
CREATE VIEW v_active_bookings AS
SELECT b.booking_id, u.name AS user_name, v.vehicle_number, l.lot_name,
       z.zone_name, s.slot_number, b.start_ts, b.end_ts, b.total_amount
FROM bookings b
JOIN users u          ON u.user_id    = b.user_id
JOIN vehicles v       ON v.vehicle_id = b.vehicle_id
JOIN parking_slots s  ON s.slot_id    = b.slot_id
JOIN zones z          ON z.zone_id    = s.zone_id
JOIN parking_lots l   ON l.lot_id     = z.lot_id
WHERE b.status = 'booked'
  AND b.end_ts > (UTC_TIMESTAMP() + INTERVAL 330 MINUTE);

-- Live occupancy per lot (a slot is occupied if a booking covers "now")
CREATE VIEW v_lot_occupancy_now AS
SELECT l.lot_id, l.lot_name,
       COUNT(DISTINCT s.slot_id) AS total_slots,
       COUNT(DISTINCT b.slot_id) AS occupied_slots,
       ROUND(100 * COUNT(DISTINCT b.slot_id) / COUNT(DISTINCT s.slot_id), 1) AS occupancy_pct
FROM parking_lots l
JOIN zones z          ON z.lot_id  = l.lot_id
JOIN parking_slots s  ON s.zone_id = z.zone_id
LEFT JOIN bookings b  ON b.slot_id = s.slot_id
                     AND b.status  = 'booked'
                     AND b.start_ts <= (UTC_TIMESTAMP() + INTERVAL 330 MINUTE)
                     AND b.end_ts   >  (UTC_TIMESTAMP() + INTERVAL 330 MINUTE)
GROUP BY l.lot_id, l.lot_name;

-- ---------------------------------------------------------------------
--  TRIGGERS  (defence in depth - the Flask app also checks inside a
--  transaction with SELECT ... FOR UPDATE)
--  If you import this file from a GUI tool that does not understand
--  DELIMITER, run the two CREATE TRIGGER blocks separately.
-- ---------------------------------------------------------------------

DELIMITER $$

CREATE TRIGGER trg_bookings_before_insert
BEFORE INSERT ON bookings
FOR EACH ROW
BEGIN
    DECLARE v_type VARCHAR(10);
    DECLARE s_type VARCHAR(10);
    DECLARE clashes INT DEFAULT 0;

    SELECT vehicle_type INTO v_type FROM vehicles      WHERE vehicle_id = NEW.vehicle_id;
    SELECT slot_type    INTO s_type FROM parking_slots WHERE slot_id    = NEW.slot_id;

    IF v_type <> s_type THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vehicle type does not match the slot type';
    END IF;

    IF NEW.status = 'booked' THEN
        SELECT COUNT(*) INTO clashes
        FROM bookings
        WHERE slot_id  = NEW.slot_id
          AND status   = 'booked'
          AND start_ts < NEW.end_ts
          AND end_ts   > NEW.start_ts;

        IF clashes > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Slot is already booked for the selected time';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_bookings_before_update
BEFORE UPDATE ON bookings
FOR EACH ROW
BEGIN
    DECLARE clashes INT DEFAULT 0;

    IF NEW.status = 'booked'
       AND (NEW.start_ts <> OLD.start_ts OR NEW.end_ts <> OLD.end_ts OR NEW.slot_id <> OLD.slot_id) THEN

        SELECT COUNT(*) INTO clashes
        FROM bookings
        WHERE slot_id    = NEW.slot_id
          AND status     = 'booked'
          AND booking_id <> NEW.booking_id
          AND start_ts   < NEW.end_ts
          AND end_ts     > NEW.start_ts;

        IF clashes > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Slot is already booked for the selected time';
        END IF;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------
--  REPORT QUERIES (for your project report / viva) - run manually
-- ---------------------------------------------------------------------

-- 1) Slots free for a given window (the "Check Slots" button)
--    SET @from = '2026-10-20 10:00:00'; SET @to = '2026-10-20 12:00:00';
--    SELECT l.lot_name, z.zone_name, s.slot_number, s.slot_type, s.price_per_hour
--    FROM parking_slots s
--    JOIN zones z ON z.zone_id = s.zone_id
--    JOIN parking_lots l ON l.lot_id = z.lot_id
--    WHERE NOT EXISTS (
--        SELECT 1 FROM bookings b
--        WHERE b.slot_id = s.slot_id AND b.status = 'booked'
--          AND b.start_ts < @to AND b.end_ts > @from);

-- 2) Live occupancy per lot
--    SELECT * FROM v_lot_occupancy_now;

-- 3) Revenue per day (completed payments only)
--    SELECT DATE(payment_date) AS day, COUNT(*) AS payments, SUM(amount) AS revenue
--    FROM payments WHERE payment_status = 'completed'
--    GROUP BY DATE(payment_date) ORDER BY day DESC;

-- 4) A user's booking history
--    SELECT b.booking_id, l.lot_name, s.slot_number, b.start_ts, b.end_ts, b.total_amount, b.status
--    FROM bookings b
--    JOIN parking_slots s ON s.slot_id = b.slot_id
--    JOIN zones z ON z.zone_id = s.zone_id
--    JOIN parking_lots l ON l.lot_id = z.lot_id
--    WHERE b.user_id = 1 ORDER BY b.start_ts DESC;

-- 5) Peak hours (bookings started per hour of day)
--    SELECT HOUR(start_ts) AS hour_of_day, COUNT(*) AS bookings
--    FROM bookings WHERE status <> 'cancelled'
--    GROUP BY HOUR(start_ts) ORDER BY bookings DESC;

-- 6) Most used slots
--    SELECT l.lot_name, s.slot_number, COUNT(*) AS times_booked, SUM(b.total_amount) AS revenue
--    FROM bookings b
--    JOIN parking_slots s ON s.slot_id = b.slot_id
--    JOIN zones z ON z.zone_id = s.zone_id
--    JOIN parking_lots l ON l.lot_id = z.lot_id
--    WHERE b.status <> 'cancelled'
--    GROUP BY l.lot_name, s.slot_number ORDER BY times_booked DESC;

-- 7) Users who spent more than the average booking value (subquery)
--    SELECT u.name, SUM(b.total_amount) AS spent
--    FROM users u JOIN bookings b ON b.user_id = u.user_id
--    WHERE b.status <> 'cancelled'
--    GROUP BY u.user_id, u.name
--    HAVING SUM(b.total_amount) > (SELECT AVG(total_amount) FROM bookings);
