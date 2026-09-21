CREATE DATABASE IF NOT EXISTS parkwise;

USE parkwise;

CREATE TABLE users(
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15) NOT NULL,
    password VARCHAR(225) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user'
);

CREATE TABLE vehicles(
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type ENUM('car', 'bike') NOT NULL,
    vehicle_model VARCHAR(50) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE parking_lots(
    lot_id INT AUTO_INCREMENT PRIMARY KEY,
    lot_name VARCHAR(100) NOT NULL,
    location VARCHAR(255) NOT NULL,
    total_slots INT NOT NULL,
    opening_time TIME,
    closing_time TIME
);

CREATE TABLE parking_slots(
    slot_id INT AUTO_INCREMENT PRIMARY KEY,
    lot_id INT NOT NULL,
    slot_number VARCHAR(20) NOT NULL,
    slot_type ENUM('car', 'bike') NOT NULL,
    status ENUM('available', 'occupied') DEFAULT 'available',
    FOREIGN KEY (lot_id) REFERENCES parking_lots(lot_id),
    UNIQUE(lot_id, slot_number)
);

CREATE TABLE bookings(
    booking_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    slot_id INT NOT NULL,
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status ENUM('booked', 'completed', 'cancelled') DEFAULT 'booked',
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
    FOREIGN KEY (slot_id) REFERENCES parking_slots(slot_id)
);

CREATE TABLE payments(
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method ENUM('cash', 'card', 'upi') NOT NULL,
    payment_status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
);

-- Sample Users
INSERT INTO users(name, email, phone, password, role)
VALUES
('Saksham', 'saksham@gmail.com', '9876543210', '12345', 'user'),
('Rahul', 'rahul@gmail.com', '9876543211', '12345', 'user'),
('Admin', 'admin@parkwise.com', '9876543212', 'admin123', 'admin');

-- Sample Vehicles
INSERT INTO vehicles(user_id, vehicle_number, vehicle_type, vehicle_model)
VALUES
(1, 'MH12AB1234', 'car', 'Honda City'),
(2, 'MH12CD5678', 'bike', 'Royal Enfield'),
(2, 'MH12EF9012', 'car', 'Hyundai i20');

-- Sample Parking Lots
INSERT INTO parking_lots(lot_name, location, total_slots, opening_time, closing_time)
VALUES
('VIT Parking', 'Bibwewadi, Pune', 50, '06:00:00', '23:00:00'),
('City Parking', 'Swargate, Pune', 30, '07:00:00', '22:00:00');

-- Sample Parking Slots
INSERT INTO parking_slots(lot_id, slot_number, slot_type, status)
VALUES
(1, 'A1', 'car', 'occupied'),
(1, 'A2', 'car', 'occupied'),
(1, 'B1', 'bike', 'available'),
(1, 'B2', 'bike', 'available'),
(2, 'A1', 'car', 'available'),
(2, 'A2', 'car', 'available'),
(2, 'B1', 'bike', 'occupied'),
(2, 'B2', 'bike', 'available');

-- Sample Bookings
INSERT INTO bookings(user_id, vehicle_id, slot_id, booking_date, start_time, end_time, status)
VALUES
(1, 1, 1, '2026-09-22', '10:00:00', '12:00:00', 'completed'),
(2, 2, 3, '2026-09-22', '14:00:00', '16:00:00', 'booked'),
(2, 3, 5, '2026-09-23', '09:00:00', '11:00:00', 'completed');

-- Sample Payments
INSERT INTO payments(booking_id, amount, payment_method, payment_status)
VALUES
(1, 100.00, 'upi', 'completed'),
(2, 80.00, 'card', 'completed'),
(3, 120.00, 'upi', 'completed');