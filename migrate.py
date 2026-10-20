"""Idempotent, non-destructive migration for the existing six-table schema."""
import os
import re
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).with_name(".env"))


def _db_config():
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "parkwise"),
        "charset": "utf8mb4",
        "connection_timeout": int(os.getenv("DB_TIMEOUT", "10")),
    }


def _columns(cursor, table):
    cursor.execute(f"SHOW COLUMNS FROM `{table}`")
    return {row["Field"]: row for row in cursor.fetchall()}


def _ensure_column(cursor, table, column, definition):
    if column in _columns(cursor, table):
        print(f"{table}.{column} already exists; leaving it unchanged.")
        return False
    cursor.execute(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")
    print(f"Added {table}.{column}.")
    return True


def _extend_payment_status_enum(cursor):
    column = _columns(cursor, "payments").get("payment_status")
    if not column or not str(column["Type"]).lower().startswith("enum("):
        raise RuntimeError("payments.payment_status must be an ENUM column")
    existing = re.findall(r"'((?:[^'\\]|\\.)*)'", column["Type"])
    required = ("pending", "completed", "failed", "cancelled", "refunded")
    values = list(existing)
    for status in required:
        if status not in values:
            values.append(status)
    if values == existing:
        print("payments.payment_status already supports the required states.")
        return

    enum_values = ", ".join("'" + value.replace("'", "''") + "'" for value in values)
    nullable = "NULL" if column["Null"] == "YES" else "NOT NULL"
    default = column.get("Default")
    default_clause = f" DEFAULT '{default}'" if default is not None else ""
    cursor.execute(
        f"ALTER TABLE payments MODIFY COLUMN payment_status "
        f"ENUM({enum_values}) {nullable}{default_clause}"
    )
    print("Extended payments.payment_status without removing existing states.")


def migrate():
    connection = mysql.connector.connect(**_db_config())
    cursor = None
    try:
        cursor = connection.cursor(dictionary=True)
        connection.start_transaction()

        for table in ("users", "vehicles", "parking_lots", "parking_slots", "bookings", "payments"):
            cursor.execute("SHOW TABLES LIKE %s", (table,))
            if cursor.fetchone() is None:
                raise RuntimeError(
                    f"Required table {table!r} is missing; migration stopped without creating tables."
                )

        _ensure_column(cursor, "parking_slots", "zone_name", "VARCHAR(50) NULL")
        _ensure_column(
            cursor,
            "parking_slots",
            "price_per_hour",
            "DECIMAL(8,2) NULL",
        )
        _ensure_column(cursor, "payments", "payment_reference", "VARCHAR(100) NULL")

        # Only fill missing zone labels; never overwrite a user's existing assignment.
        cursor.execute(
            """UPDATE parking_slots s
               JOIN parking_lots l ON l.lot_id=s.lot_id
               SET s.zone_name=CASE
                   WHEN l.lot_name='City Parking'
                        AND UPPER(s.slot_number) LIKE 'A%' THEN 'Zone C'
                   WHEN UPPER(s.slot_number) LIKE 'A%' THEN 'Zone A'
                   WHEN UPPER(s.slot_number) LIKE 'B%' THEN 'Zone B'
                   WHEN UPPER(s.slot_number) LIKE 'C%' THEN 'Zone C'
                   ELSE NULL
               END
               WHERE s.zone_name IS NULL OR TRIM(s.zone_name)=''"""
        )
        cursor.execute(
            """UPDATE parking_slots
               SET price_per_hour=CASE WHEN slot_type='bike' THEN 10.00 ELSE 30.00 END
               WHERE price_per_hour IS NULL OR price_per_hour<=0"""
        )
        cursor.execute(
            "ALTER TABLE parking_slots MODIFY COLUMN price_per_hour DECIMAL(8,2) NOT NULL"
        )
        _extend_payment_status_enum(cursor)

        cursor.execute(
            """CREATE TABLE IF NOT EXISTS booking_extensions (
                   extension_id INT AUTO_INCREMENT PRIMARY KEY,
                   booking_id INT NOT NULL,
                   extra_minutes INT NOT NULL,
                   old_end_ts DATETIME NOT NULL,
                   new_end_ts DATETIME NOT NULL,
                   extra_amount DECIMAL(10,2) NOT NULL,
                   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   CONSTRAINT fk_booking_extensions_booking
                       FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
                   CONSTRAINT ck_booking_extensions_minutes CHECK (extra_minutes > 0)
               ) ENGINE=InnoDB"""
        )
        connection.commit()
        print("Migration complete. Existing user, lot, slot, booking, and payment rows were preserved.")
    except Exception:
        connection.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


if __name__ == "__main__":
    migrate()
