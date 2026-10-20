-- ParkWise Safe Backward-Compatible Migration
-- 1. Adds zone_name to parking_slots and populates based on documented slot naming convention.
-- 2. Expands payments.payment_status enum to include 'refunded' and 'cancelled'.
-- Preserves all existing records, foreign keys, and tables.

ALTER TABLE parking_slots ADD COLUMN IF NOT EXISTS zone_name VARCHAR(50) NULL;

UPDATE parking_slots SET zone_name = 'Zone A' WHERE lot_id = 1 AND slot_number LIKE 'A%';
UPDATE parking_slots SET zone_name = 'Zone B' WHERE slot_number LIKE 'B%';
UPDATE parking_slots SET zone_name = 'Zone C' WHERE (lot_id = 2 AND slot_number LIKE 'A%') OR slot_number LIKE 'C%';

ALTER TABLE payments MODIFY COLUMN payment_status ENUM('pending','completed','failed','refunded','cancelled') DEFAULT 'pending';
