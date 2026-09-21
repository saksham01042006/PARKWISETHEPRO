import mysql.connector


def get_connection():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="renu2006",
        database="parkwise"
    )


def get_available_slots():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            parking_lots.lot_name,
            parking_slots.slot_number,
            parking_slots.slot_type
        FROM parking_slots
        JOIN parking_lots
        ON parking_slots.lot_id = parking_lots.lot_id
        WHERE parking_slots.status = 'available'
    """)

    slots = cursor.fetchall()

    print("Available Parking Slots:")

    for slot in slots:
        print(
            f"Lot: {slot[0]} | "
            f"Slot: {slot[1]} | "
            f"Type: {slot[2]}"
        )

    cursor.close()
    conn.close()


def create_booking(user_id, vehicle_id, slot_id, booking_date, start_time, end_time):
    conn = get_connection()
    cursor = conn.cursor()

    # Check slot availability
    cursor.execute("""
        SELECT status
        FROM parking_slots
        WHERE slot_id = %s
    """, (slot_id,))

    slot = cursor.fetchone()

    if slot is None:
        print("Parking slot not found!")

    elif slot[0] == "occupied":
        print("Sorry! This parking slot is already occupied.")

    else:
        cursor.execute("""
            INSERT INTO bookings
            (user_id, vehicle_id, slot_id, booking_date, start_time, end_time, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            user_id,
            vehicle_id,
            slot_id,
            booking_date,
            start_time,
            end_time,
            "booked"
        ))

        booking_id = cursor.lastrowid

        cursor.execute("""
            UPDATE parking_slots
            SET status = 'occupied'
            WHERE slot_id = %s
        """, (slot_id,))

        conn.commit()

        print("Booking created successfully!")
        print("Booking ID:", booking_id)

    cursor.close()
    conn.close()


def cancel_booking(booking_id):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT slot_id, status
        FROM bookings
        WHERE booking_id = %s
    """, (booking_id,))

    booking = cursor.fetchone()

    if booking is None:
        print("Booking not found!")

    elif booking[1] != "booked":
        print("This booking cannot be cancelled.")

    else:
        slot_id = booking[0]

        cursor.execute("""
            UPDATE bookings
            SET status = 'cancelled'
            WHERE booking_id = %s
        """, (booking_id,))

        cursor.execute("""
            UPDATE parking_slots
            SET status = 'available'
            WHERE slot_id = %s
        """, (slot_id,))

        conn.commit()

        print("Booking cancelled successfully!")
        print("Parking slot is now available.")

    cursor.close()
    conn.close()


def get_booking_history(user_id):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            bookings.booking_id,
            parking_lots.lot_name,
            parking_slots.slot_number,
            bookings.booking_date,
            bookings.start_time,
            bookings.end_time,
            bookings.status
        FROM bookings
        JOIN parking_slots
        ON bookings.slot_id = parking_slots.slot_id
        JOIN parking_lots
        ON parking_slots.lot_id = parking_lots.lot_id
        WHERE bookings.user_id = %s
        ORDER BY bookings.booking_date DESC
    """, (user_id,))

    bookings = cursor.fetchall()

    print("Booking History:")

    for booking in bookings:
        print(
            f"Booking ID: {booking[0]} | "
            f"Lot: {booking[1]} | "
            f"Slot: {booking[2]} | "
            f"Date: {booking[3]} | "
            f"Time: {booking[4]} - {booking[5]} | "
            f"Status: {booking[6]}"
        )

    cursor.close()
    conn.close()


def make_payment(booking_id, amount, payment_method):
    conn = get_connection()
    cursor = conn.cursor()

    # Check booking
    cursor.execute("""
        SELECT status
        FROM bookings
        WHERE booking_id = %s
    """, (booking_id,))

    booking = cursor.fetchone()

    if booking is None:
        print("Booking not found!")

    elif booking[0] == "cancelled":
        print("Cannot make payment for a cancelled booking.")

    else:
        # Check existing payment
        cursor.execute("""
            SELECT payment_id
            FROM payments
            WHERE booking_id = %s
        """, (booking_id,))

        payment = cursor.fetchone()

        if payment:
            print("Payment already exists for this booking.")
            print("Payment ID:", payment[0])

        else:
            cursor.execute("""
                INSERT INTO payments
                (booking_id, amount, payment_method, payment_status)
                VALUES (%s, %s, %s, %s)
            """, (
                booking_id,
                amount,
                payment_method,
                "completed"
            ))

            conn.commit()

            print("Payment completed successfully!")
            print("Payment ID:", cursor.lastrowid)

    cursor.close()
    conn.close()


# Testing
if __name__ == "__main__":

    get_available_slots()

    print()

    get_booking_history(1)

    print()

    make_payment(3, 120.00, "upi")