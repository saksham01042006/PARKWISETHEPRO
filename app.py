"""
ParkWise - Flask backend.

Routes
  GET  /                 the web page
  GET  /api/health       is the database reachable?
  GET  /api/slots        slots + live status (optionally for a time window)
  POST /api/book         create a booking (race-safe)
  POST /api/cancel       cancel a booking
  POST /api/extend       extend a running/upcoming booking
  GET  /api/bookings     demo user's bookings (?user_id=1&status=active|all)
  GET  /api/stats        occupancy per lot/zone + revenue for the dashboard

All database work lives in database.py. There is deliberately NO silent
fallback to fake data: if MySQL is down you get a clear 503 error.
"""
import logging
import os
import math
from datetime import datetime, timedelta

import mysql.connector
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

import database
from database import BookingError

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("parkwise")
DEMO_USER_ID = 1


# --------------------------------------------------------------------------
#  Helpers
# --------------------------------------------------------------------------
def fail(message, status=400):
    return jsonify({"success": False, "message": message}), status


def to_int(value, name):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise BookingError(f"{name} must be a whole number")


def to_minutes(hours_value):
    """Hours (e.g. 2 or 1.5) -> whole minutes."""
    try:
        hours = float(hours_value)
        if not math.isfinite(hours):
            raise ValueError
        minutes = round(hours * 60)
    except (TypeError, ValueError, OverflowError):
        raise BookingError("duration_hours must be a number")
    return minutes


def get_demo_user_id(data=None):
    requested_id = data.get("user_id") if data else request.args.get("user_id")
    if requested_id is not None and to_int(requested_id, "user_id") != DEMO_USER_ID:
        raise BookingError("Booking not found", 404)
    return DEMO_USER_ID


def parse_time(text):
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p"):
        try:
            return datetime.strptime(str(text).strip().upper(), fmt).time()
        except ValueError:
            continue
    raise BookingError("start_time must look like 14:30")


def parse_start(data):
    """
    Accepts either {"start": "2026-10-20T14:30"} or
    {"booking_date": "2026-10-20", "start_time": "14:30"}.
    Returns a naive datetime in IST.
    """
    if data.get("start"):
        try:
            dt = datetime.fromisoformat(str(data["start"]).replace("Z", "+00:00"))
        except ValueError:
            raise BookingError("start must be an ISO date-time like 2026-10-20T14:30")
        if dt.tzinfo is not None:
            dt = dt.astimezone(database.IST).replace(tzinfo=None)
        return dt

    date_text, time_text = data.get("booking_date"), data.get("start_time")
    if not date_text or not time_text:
        raise BookingError("booking_date and start_time are required")
    try:
        day = datetime.strptime(str(date_text).strip(), "%Y-%m-%d").date()
    except ValueError:
        raise BookingError("booking_date must look like 2026-10-20")
    return datetime.combine(day, parse_time(time_text))


# --------------------------------------------------------------------------
#  Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    database.ping()
    return jsonify({"success": True, "database": "connected"})


# --------------------------------------------------------------------------
#  Slots
# --------------------------------------------------------------------------
@app.route("/api/slots", methods=["GET"])
def get_slots():
    location = request.args.get("location", "all")
    vehicle_type = request.args.get("vehicle_type", "all")
    zone = request.args.get("zone")
    zone_id = request.args.get("zone_id")

    start = end = None
    if request.args.get("booking_date") and request.args.get("start_time"):
        start = parse_start(request.args)
        hours = request.args.get("duration_hours", 1)
        end = start + timedelta(minutes=to_minutes(hours))

    slots = database.list_slots(
        lot_name=None if location.lower() == "all" else location,
        vehicle_type=None if vehicle_type.lower() == "all" else vehicle_type.lower(),
        start=start,
        end=end,
        zone=zone,
        zone_id=zone_id,
    )
    return jsonify({"success": True, "slots": slots})


# --------------------------------------------------------------------------
#  Bookings
# --------------------------------------------------------------------------
@app.route("/api/book", methods=["POST"])
def book_slot():
    data = request.get_json(silent=True) or {}

    if not data.get("slot_id"):
        raise BookingError("slot_id is required")
    if not data.get("vehicle_number"):
        raise BookingError("vehicle_number is required")

    booking = database.create_booking(
        user_id=get_demo_user_id(data),
        vehicle_number=data["vehicle_number"],
        slot_id=to_int(data["slot_id"], "slot_id"),
        start_ts=parse_start(data),
        minutes=to_minutes(data.get("duration_hours", data.get("hours", 2))),
        payment_method=str(data.get("payment_method", "upi")).lower(),
    )
    payload = {
        "success": True,
        "message": "Booking confirmed successfully!",
        "amount": booking["total_amount"],  # includes 5% GST
        **booking,
    }
    return jsonify(payload), 201


@app.route("/api/cancel", methods=["POST"])
def cancel_booking():
    data = request.get_json(silent=True) or {}
    if not data.get("booking_id"):
        raise BookingError("booking_id is required")

    result = database.cancel_booking(
        booking_id=to_int(data["booking_id"], "booking_id"),
        user_id=get_demo_user_id(data),
    )
    return jsonify({"success": True, "message": "Booking cancelled successfully!", **result})


@app.route("/api/extend", methods=["POST"])
def extend_booking():
    data = request.get_json(silent=True) or {}
    if not data.get("booking_id"):
        raise BookingError("booking_id is required")

    if data.get("extra_minutes") is not None:
        extra_minutes = to_int(data["extra_minutes"], "extra_minutes")
    elif data.get("minutes") is not None:
        extra_minutes = to_int(data["minutes"], "minutes")
    elif data.get("extra_hours") is not None:
        extra_minutes = to_minutes(data["extra_hours"])
    else:
        raise BookingError("extra_minutes is required")

    booking = database.extend_booking(
        booking_id=to_int(data["booking_id"], "booking_id"),
        extra_minutes=extra_minutes,
        user_id=get_demo_user_id(data),
        payment_method=str(data["payment_method"]).lower() if data.get("payment_method") else None,
    )
    return jsonify({"success": True, "message": "Booking extended successfully!", **booking})


@app.route("/api/bookings", methods=["GET"])
def my_bookings():
    user_id = get_demo_user_id()
    status = request.args.get("status", "all").lower()
    if status not in {"all", "active"}:
        raise BookingError("status must be 'all' or 'active'")
    only_active = status == "active"
    bookings = database.list_bookings(user_id, only_active=only_active)
    return jsonify({"success": True, "bookings": bookings})


# --------------------------------------------------------------------------
#  Dashboard
# --------------------------------------------------------------------------
@app.route("/api/stats", methods=["GET"])
def stats():
    return jsonify({"success": True, **database.get_stats()})


# --------------------------------------------------------------------------
#  Error handling - always JSON for the API
# --------------------------------------------------------------------------
@app.errorhandler(BookingError)
def handle_booking_error(err):
    return fail(err.message, err.status_code)


@app.errorhandler(mysql.connector.Error)
def handle_db_error(err):
    log.exception("Database error: %s", err)
    connection_problem = isinstance(
        err,
        (
            mysql.connector.errors.InterfaceError,
            mysql.connector.errors.OperationalError,
            mysql.connector.errors.PoolError,
        ),
    ) or getattr(err, "errno", None) in {1045, 1049, 2002, 2003, 2006, 2013}
    if connection_problem:
        return fail(
            "Cannot reach the database. Check that MySQL is running and the "
            "DB_HOST / DB_USER / DB_PASSWORD / DB_NAME settings are correct.",
            503,
        )
    if app.config.get("DEBUG") or os.environ.get("FLASK_DEBUG") == "1":
        return fail(f"Database error: {getattr(err, 'msg', str(err))}", 500)
    return fail("A database error occurred.", 500)


@app.errorhandler(Exception)
def handle_unexpected(err):
    if isinstance(err, HTTPException):
        return err
    log.exception("Unhandled error")
    return fail("Something went wrong on the server.", 500)


# --------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"ParkWise Smart Parking Server running at http://{host}:{port}")
    app.run(debug=debug, host=host, port=port)
