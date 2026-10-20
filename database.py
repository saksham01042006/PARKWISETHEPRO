"""ParkWise MySQL data-access layer compatible with the existing six-table schema."""
import os
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, date, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import mysql.connector
from mysql.connector import errors as mysql_errors

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

IST = timezone(timedelta(hours=5, minutes=30))
GST_RATE = Decimal('0.05')
PAYMENT_METHODS = {'cash', 'card', 'upi'}
VEHICLE_TYPES = {'car', 'bike'}
MIN_MINUTES = 15
MAX_MINUTES = 24 * 60
MAX_DAYS_AHEAD = 90

ZONE_ID_MAP = {
    'Zone A': 1,
    'Zone B': 2,
    'Zone C': 3,
}
ID_TO_ZONE_MAP = {v: k for k, v in ZONE_ID_MAP.items()}
VALID_ZONES = {'all', 'zone a', 'zone b', 'zone c'}
VALID_ZONE_IDS = {'all', 1, 2, 3}


class BookingError(Exception):
    status_code = 400
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class NotFound(BookingError):
    status_code = 404


class SlotTaken(BookingError):
    status_code = 409


def now_ist():
    return datetime.now(IST).replace(tzinfo=None, microsecond=0)


def _db_config():
    return {
        'host': os.environ.get('DB_HOST', 'localhost'),
        'port': int(os.environ.get('DB_PORT', '3306')),
        'user': os.environ.get('DB_USER', 'root'),
        'password': os.environ.get('DB_PASSWORD', ''),
        'database': os.environ.get('DB_NAME', 'parkwise'),
        'charset': 'utf8mb4',
        'connection_timeout': int(os.environ.get('DB_TIMEOUT', '10')),
    }


@contextmanager
def read_cursor():
    conn = mysql.connector.connect(**_db_config())
    cur = None
    try:
        cur = conn.cursor(dictionary=True, buffered=True)
        yield cur
        conn.commit()
    finally:
        if cur is not None:
            cur.close()
        conn.close()


@contextmanager
def transaction():
    conn = mysql.connector.connect(**_db_config())
    cur = None
    try:
        conn.start_transaction(isolation_level='READ COMMITTED')
        cur = conn.cursor(dictionary=True, buffered=True)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if cur is not None:
            cur.close()
        conn.close()


def ping():
    with read_cursor() as cur:
        cur.execute('SELECT 1 AS ok')
        return cur.fetchone()['ok'] == 1


def _q(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _money(value):
    return float(_q(value))


def _iso(dt):
    return dt.isoformat(timespec='seconds') if dt else None


def normalize_plate(raw):
    plate = re.sub(r'[\s-]+', '', str(raw or '')).upper()
    if not re.fullmatch(r'[A-Z0-9]{4,15}', plate):
        raise BookingError('Enter a valid vehicle number (letters and digits only)')
    return plate


def parse_time(text):
    text = str(text).strip().upper()
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M%p"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            pass
    raise BookingError(f"Invalid time format: {text}")


def _dt(day, tm):
    """Safely combine date and time handling timedelta, time, datetime, and string representations."""
    if isinstance(day, datetime):
        day = day.date()
    elif isinstance(day, str):
        day = datetime.strptime(str(day).strip()[:10], "%Y-%m-%d").date()

    if isinstance(tm, timedelta):
        total_seconds = int(tm.total_seconds()) % 86400
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        tm = time(hours, minutes, seconds)
    elif isinstance(tm, datetime):
        tm = tm.time()
    elif isinstance(tm, str):
        tm = parse_time(tm)

    return datetime.combine(day, tm)


def _slot_price(slot_type):
    return Decimal('30.00') if slot_type == 'car' else Decimal('10.00')


def _stored_price(slot_type, value=None):
    try:
        price = _q(value)
    except (TypeError, ValueError, ArithmeticError):
        price = Decimal('0.00')
    return price if price > 0 else _slot_price(slot_type)


def _has_column(cur, table, column):
    cur.execute(f"SHOW COLUMNS FROM `{table}` LIKE %s", (column,))
    return cur.fetchone() is not None


def _has_table(cur, table):
    cur.execute("SHOW TABLES LIKE %s", (table,))
    return cur.fetchone() is not None


def _booking_datetimes(row):
    start = _dt(row['booking_date'], row['start_time'])
    end = _dt(row['booking_date'], row['end_time'])
    # Support bookings that cross midnight
    if end <= start:
        end += timedelta(days=1)
    return start, end


def _slot_zone_name(slot_number, stored_zone=None, lot_id=None):
    if stored_zone and str(stored_zone).strip():
        match = re.search(r'\bzone\s*([abc])\b', str(stored_zone), re.IGNORECASE)
        if match:
            return f"Zone {match.group(1).upper()}"
        if str(stored_zone).strip().upper() in {'A', 'B', 'C'}:
            return f"Zone {str(stored_zone).strip().upper()}"
    if lot_id == 2 and str(slot_number or '').startswith('A'):
        return "Zone C"
    prefix = str(slot_number or '')[:1].upper()
    if prefix in ('A', 'B', 'C'):
        return f"Zone {prefix}"
    return "General"


def sync_slot_statuses(cur):
    """Ensure parking_slots.status matches active running bookings in real time."""
    now = now_ist()
    cur.execute("SELECT slot_id, booking_date, start_time, end_time FROM bookings WHERE status='booked'")
    active_slot_ids = set()
    for b in cur.fetchall():
        s, e = _booking_datetimes(b)
        if s <= now < e:
            active_slot_ids.add(b['slot_id'])

    cur.execute("SELECT slot_id, status FROM parking_slots")
    for s in cur.fetchall():
        expected = 'occupied' if s['slot_id'] in active_slot_ids else 'available'
        if s['status'] != expected:
            cur.execute("UPDATE parking_slots SET status=%s WHERE slot_id=%s", (expected, s['slot_id']))


def list_slots(lot_name=None, vehicle_type=None, start=None, end=None, zone=None, zone_id=None):
    if vehicle_type is not None and vehicle_type not in VEHICLE_TYPES:
        raise BookingError("vehicle_type must be 'car' or 'bike'")

    # Validate zone parameter if supplied
    normalized_zone = None
    if zone is not None:
        z_str = str(zone).strip()
        if z_str.lower() != 'all':
            if z_str.lower() not in VALID_ZONES:
                raise BookingError(f"Invalid zone '{zone}'. Supported zones: Zone A, Zone B, Zone C.", 400)
            normalized_zone = next(k for k in ZONE_ID_MAP if k.lower() == z_str.lower())

    # Validate zone_id parameter if supplied
    if zone_id is not None:
        if str(zone_id).lower() != 'all':
            try:
                z_id_int = int(zone_id)
                if z_id_int not in ID_TO_ZONE_MAP:
                    raise BookingError(f"Invalid zone_id '{zone_id}'. Supported zone IDs: 1, 2, 3.", 400)
                normalized_zone = ID_TO_ZONE_MAP[z_id_int]
            except ValueError:
                raise BookingError("zone_id must be a number", 400)

    start = start or now_ist()
    end = end or (start + timedelta(minutes=1))
    if end <= start:
        raise BookingError('End time must be after start time')

    # A per-slot rate was added by the safe migration; retain legacy defaults
    # until that optional column has been migrated.
    sql = '''SELECT s.slot_id, s.slot_number, s.slot_type, s.status AS stored_status,
                    s.zone_name, l.lot_id, l.lot_name, l.location AS address,
                    l.opening_time, l.closing_time, {price_column}
             FROM parking_slots s JOIN parking_lots l ON l.lot_id=s.lot_id
             WHERE 1=1'''
    params = []
    if lot_name:
        sql += ' AND l.lot_name=%s'
        params.append(lot_name)
    if vehicle_type:
        sql += ' AND s.slot_type=%s'
        params.append(vehicle_type)
    sql += ' ORDER BY l.lot_id, s.slot_number'

    with read_cursor() as cur:
        price_column = (
            's.price_per_hour'
            if _has_column(cur, 'parking_slots', 'price_per_hour')
            else 'NULL AS price_per_hour'
        )
        sql = sql.format(price_column=price_column)
        # Keep slots status in sync with active bookings
        sync_slot_statuses(cur)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        cur.execute("SELECT booking_id, slot_id, booking_date, start_time, end_time FROM bookings WHERE status='booked'")
        bookings = cur.fetchall()

    booked_windows = {}
    for b in bookings:
        bs, be = _booking_datetimes(b)
        booked_windows.setdefault(b['slot_id'], []).append((bs, be))

    result = []
    for r in rows:
        zone_label = _slot_zone_name(r['slot_number'], r.get('zone_name'), r.get('lot_id'))
        zid = ZONE_ID_MAP.get(zone_label)

        # Apply zone filter if requested
        if normalized_zone and zone_label != normalized_zone:
            continue

        taken = any(bs < end and be > start for bs, be in booked_windows.get(r['slot_id'], []))
        price = _stored_price(r['slot_type'], r.get('price_per_hour'))
        open_at = r['opening_time']
        close_at = r['closing_time']
        window_open = _within_operating_hours(start, end, open_at, close_at)
        available = not taken and window_open

        result.append({
            'slot_id': r['slot_id'],
            'slot_number': r['slot_number'],
            'slot_type': r['slot_type'],
            'status': 'occupied' if taken else ('available' if window_open else 'closed'),
            'available': available,
            'unavailable_reason': None if available else (
                'This lot is closed during the selected time' if not window_open else 'This slot is booked'
            ),
            'price_per_hour': _money(price),
            'zone': zone_label,
            'zone_id': zid,
            'lot_id': r['lot_id'],
            'lot_name': r['lot_name'],
            'address': r['address'],
            'amenities': [],
            'is_ev': False,
        })
    return result


def _within_operating_hours(start, end, opening_time, closing_time):
    if isinstance(opening_time, timedelta):
        opening_time = _dt(start.date(), opening_time).time()
    if isinstance(closing_time, timedelta):
        closing_time = _dt(start.date(), closing_time).time()
    if isinstance(opening_time, str):
        opening_time = parse_time(opening_time)
    if isinstance(closing_time, str):
        closing_time = parse_time(closing_time)

    opening = datetime.combine(start.date(), opening_time)
    if closing_time > opening_time:
        closing = datetime.combine(start.date(), closing_time)
    else:
        closing = datetime.combine(start.date() + timedelta(days=1), closing_time)
        if start < opening:
            opening = datetime.combine(start.date() - timedelta(days=1), opening_time)
            closing = datetime.combine(start.date(), closing_time)
    return start >= opening and end <= closing


def _vehicle_for_booking(cur, user_id, plate, slot_type):
    cur.execute('SELECT vehicle_id, user_id, vehicle_type FROM vehicles WHERE vehicle_number=%s', (plate,))
    row = cur.fetchone()
    if row:
        if row['user_id'] != user_id:
            raise BookingError('This vehicle number is registered to another account', 403)
        if row['vehicle_type'] != slot_type:
            raise BookingError(f"{plate} is a {row['vehicle_type']} and cannot use a {slot_type} bay")
        return row['vehicle_id']
    cur.execute('INSERT INTO vehicles (user_id, vehicle_number, vehicle_type, vehicle_model) VALUES (%s,%s,%s,%s)',
                (user_id, plate, slot_type, 'Standard Vehicle'))
    return cur.lastrowid


def _booking_select(cur, booking_id):
    price_column = (
        's.price_per_hour'
        if _has_column(cur, 'parking_slots', 'price_per_hour')
        else 'NULL AS price_per_hour'
    )
    cur.execute('''SELECT b.booking_id, b.user_id, b.vehicle_id, b.slot_id, b.booking_date, b.start_time, b.end_time, b.status,
                          s.slot_number, s.slot_type, s.zone_name, s.lot_id, l.lot_name, l.location AS address,
                          {price_column},
                          COALESCE(v.vehicle_number, 'N/A') AS vehicle_number
                   FROM bookings b
                   JOIN parking_slots s ON s.slot_id=b.slot_id
                   JOIN parking_lots l ON l.lot_id=s.lot_id
                   LEFT JOIN vehicles v ON v.vehicle_id=b.vehicle_id
                   WHERE b.booking_id=%s'''.format(price_column=price_column), (booking_id,))
    r = cur.fetchone()
    if not r:
        raise NotFound('Booking not found')
    start, end = _booking_datetimes(r)

    # Aggregate all completed or pending payments for this booking
    payment_reference_column = (
        'payment_reference'
        if _has_column(cur, 'payments', 'payment_reference')
        else 'NULL AS payment_reference'
    )
    cur.execute('''SELECT payment_method, payment_status, amount, {payment_reference_column}
                   FROM payments WHERE booking_id=%s ORDER BY payment_id ASC'''.format(
                       payment_reference_column=payment_reference_column
                   ), (booking_id,))
    payments = cur.fetchall()

    total = sum(_q(p.get('amount') or 0) for p in payments if p.get('payment_status') != 'failed')
    last_p = payments[-1] if payments else {}
    base = _q(total / (Decimal('1') + GST_RATE)) if total else Decimal('0.00')
    gst = total - base

    zone_label = _slot_zone_name(r['slot_number'], r.get('zone_name'), r.get('lot_id'))
    zid = ZONE_ID_MAP.get(zone_label)
    now = now_ist()

    return {
        'booking_id': r['booking_id'],
        'user_id': r['user_id'],
        'slot_id': r['slot_id'],
        'slot_number': r['slot_number'],
        'slot_type': r['slot_type'],
        'lot_name': r['lot_name'],
        'address': r['address'],
        'zone': zone_label,
        'zone_id': zid,
        'vehicle_number': r['vehicle_number'],
        'start': _iso(start),
        'end': _iso(end),
        'booking_date': start.date().isoformat(),
        'start_time': start.strftime('%H:%M'),
        'end_time': end.strftime('%H:%M'),
        'duration_hours': round((end - start).total_seconds() / 3600, 2),
        'price_per_hour': _money(_stored_price(r['slot_type'], r.get('price_per_hour'))),
        'base_amount': _money(base),
        'gst_amount': _money(gst),
        'total_amount': _money(total),
        'status': r['status'],
        'is_active': r['status'] == 'booked' and end > now,
        'payment_method': last_p.get('payment_method', 'upi'),
        'payment_status': last_p.get('payment_status', 'pending'),
        'payment_reference': last_p.get('payment_reference'),
        'booking_reference': f"PW-{r['booking_id']}",
        'created_at': None,
    }


def _insert_payment(cur, booking_id, amount, payment_method, now):
    payment_reference = f"DEMO-{uuid.uuid4().hex}"
    if _has_column(cur, 'payments', 'payment_reference'):
        cur.execute(
            '''INSERT INTO payments
               (booking_id, amount, payment_method, payment_status, payment_date, payment_reference)
               VALUES (%s,%s,%s,'pending',%s,%s)''',
            (booking_id, amount, payment_method, now, payment_reference),
        )
    else:
        cur.execute(
            '''INSERT INTO payments
               (booking_id, amount, payment_method, payment_status, payment_date)
               VALUES (%s,%s,%s,'pending',%s)''',
            (booking_id, amount, payment_method, now),
        )
    return payment_reference


def create_booking(user_id, vehicle_number, slot_id, start_ts, minutes, payment_method):
    if payment_method not in PAYMENT_METHODS:
        raise BookingError('payment_method must be cash, card or upi')
    if not MIN_MINUTES <= minutes <= MAX_MINUTES:
        raise BookingError('Duration must be between 15 minutes and 24 hours')

    plate = normalize_plate(vehicle_number)
    end_ts = start_ts + timedelta(minutes=minutes)
    now = now_ist()

    if start_ts < now:
        raise BookingError('That time has already passed - choose a future start time')
    if start_ts > now + timedelta(days=MAX_DAYS_AHEAD):
        raise BookingError(f'Bookings can be made up to {MAX_DAYS_AHEAD} days ahead')

    try:
        with transaction() as cur:
            cur.execute(
                'SELECT slot_id, slot_type, lot_id FROM parking_slots WHERE slot_id=%s FOR UPDATE',
                (slot_id,),
            )
            slot = cur.fetchone()
            if not slot:
                raise NotFound('Slot not found')

            cur.execute(
                'SELECT opening_time, closing_time FROM parking_lots WHERE lot_id=%s',
                (slot['lot_id'],),
            )
            lot = cur.fetchone()
            if not lot:
                raise NotFound('Parking lot not found')
            if not _within_operating_hours(
                start_ts, end_ts, lot['opening_time'], lot['closing_time']
            ):
                raise BookingError('The booking must fit within the parking lot operating hours')

            cur.execute('SELECT user_id FROM users WHERE user_id=%s', (user_id,))
            if not cur.fetchone():
                raise NotFound('User not found')

            vehicle_id = _vehicle_for_booking(cur, user_id, plate, slot['slot_type'])

            # Concurrency and overlap check
            cur.execute("SELECT booking_id, booking_date, start_time, end_time FROM bookings WHERE slot_id=%s AND status='booked'", (slot_id,))
            for b in cur.fetchall():
                bs, be = _booking_datetimes(b)
                if bs < end_ts and be > start_ts:
                    raise SlotTaken('Slot is already booked for the selected time')

            if _has_column(cur, 'parking_slots', 'price_per_hour'):
                cur.execute(
                    'SELECT price_per_hour FROM parking_slots WHERE slot_id=%s',
                    (slot_id,),
                )
                price = _stored_price(slot['slot_type'], cur.fetchone()['price_per_hour'])
            else:
                price = _slot_price(slot['slot_type'])
            base = _q(price * Decimal(minutes) / Decimal(60))
            gst = _q(base * GST_RATE)
            total = base + gst

            cur.execute('INSERT INTO bookings (user_id, vehicle_id, slot_id, booking_date, start_time, end_time, status) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                        (user_id, vehicle_id, slot_id, start_ts.date(), start_ts.time(), end_ts.time(), 'booked'))
            booking_id = cur.lastrowid
            _insert_payment(cur, booking_id, total, payment_method, now)

            # Sync real-time slot occupancy
            sync_slot_statuses(cur)
            return _booking_select(cur, booking_id)
    except mysql_errors.Error as err:
        if getattr(err, 'errno', None) == 1644:
            raise SlotTaken(err.msg or 'Booking rejected')
        raise


def _locked_booking(cur, booking_id):
    cur.execute('SELECT slot_id FROM bookings WHERE booking_id=%s', (booking_id,))
    row = cur.fetchone()
    if not row:
        raise NotFound('Booking not found')
    cur.execute('SELECT slot_id FROM parking_slots WHERE slot_id=%s FOR UPDATE', (row['slot_id'],))
    cur.fetchone()
    cur.execute('SELECT * FROM bookings WHERE booking_id=%s FOR UPDATE', (booking_id,))
    b = cur.fetchone()
    if not b:
        raise NotFound('Booking not found')
    return b


def cancel_booking(booking_id, user_id=None):
    if user_id is None:
        raise BookingError('Login is required to cancel a booking', 401)
    with transaction() as cur:
        b = _locked_booking(cur, booking_id)
        if b['user_id'] != user_id:
            raise NotFound('Booking not found')
        if b['status'] == 'cancelled':
            raise BookingError('This booking is already cancelled')
        if b['status'] == 'completed':
            raise BookingError('Completed bookings cannot be cancelled')
        if b['status'] != 'booked':
            raise BookingError(f"This booking cannot be cancelled (status: {b['status']})")

        _, end = _booking_datetimes(b)
        if end <= now_ist():
            raise BookingError('This session has already ended and cannot be cancelled')

        cur.execute("UPDATE bookings SET status='cancelled' WHERE booking_id=%s", (booking_id,))
        cur.execute(
            """UPDATE payments
               SET payment_status=CASE
                   WHEN payment_status='failed' THEN 'failed'
                   ELSE 'cancelled'
               END
               WHERE booking_id=%s""",
            (booking_id,),
        )

        # Release the slot immediately
        sync_slot_statuses(cur)
        return {
            'booking_id': booking_id,
            'status': 'cancelled',
            'payment_status': 'cancelled',
            'refund_amount': 0,
            'message': (
                f"Booking #{booking_id} cancelled. No refund was processed; "
                "ParkWise is using demo payments."
            ),
        }


def extend_booking(booking_id, extra_minutes, user_id=None, payment_method=None):
    if user_id is None:
        raise BookingError('Login is required to extend a booking', 401)
    if not MIN_MINUTES <= extra_minutes <= 12 * 60:
        raise BookingError('Extension must be between 15 minutes and 12 hours')
    if payment_method is not None and payment_method not in PAYMENT_METHODS:
        raise BookingError('payment_method must be cash, card or upi')
    with transaction() as cur:
        b = _locked_booking(cur, booking_id)
        if b['user_id'] != user_id:
            raise NotFound('Booking not found')
        if b['status'] != 'booked':
            raise BookingError(f"This booking is {b['status']} and cannot be extended")

        start, old_end = _booking_datetimes(b)
        now = now_ist()
        if old_end <= now:
            raise BookingError('This session has already ended - please make a new booking')

        new_end = old_end + timedelta(minutes=extra_minutes)
        if new_end - start > timedelta(hours=24):
            raise BookingError('Total booking duration cannot exceed 24 hours')

        cur.execute(
            '''SELECT l.opening_time, l.closing_time
               FROM parking_slots s
               JOIN parking_lots l ON l.lot_id=s.lot_id
               WHERE s.slot_id=%s''',
            (b['slot_id'],),
        )
        lot = cur.fetchone()
        if not lot or not _within_operating_hours(
            start, new_end, lot['opening_time'], lot['closing_time']
        ):
            raise BookingError('The extension must end within the parking lot operating hours')

        # Check conflict with other bookings on the same slot
        cur.execute("SELECT booking_id, booking_date, start_time, end_time FROM bookings WHERE slot_id=%s AND status='booked' AND booking_id<>%s", (b['slot_id'], booking_id))
        for other in cur.fetchall():
            os_, oe = _booking_datetimes(other)
            if os_ < new_end and oe > old_end:
                raise SlotTaken('Cannot extend - the slot is booked by someone else right after this session')

        cur.execute(
            'SELECT slot_type, price_per_hour FROM parking_slots WHERE slot_id=%s'
            if _has_column(cur, 'parking_slots', 'price_per_hour')
            else 'SELECT slot_type, NULL AS price_per_hour FROM parking_slots WHERE slot_id=%s',
            (b['slot_id'],),
        )
        slot = cur.fetchone()
        price = _stored_price(slot['slot_type'], slot.get('price_per_hour'))

        base = _q(price * Decimal(extra_minutes) / Decimal(60))
        gst = _q(base * GST_RATE)
        extra_total = base + gst

        cur.execute('UPDATE bookings SET end_time=%s WHERE booking_id=%s', (new_end.time(), booking_id))
        if payment_method is None:
            cur.execute('SELECT payment_method FROM payments WHERE booking_id=%s ORDER BY payment_id LIMIT 1', (booking_id,))
            p = cur.fetchone()
            payment_method = p['payment_method'] if p else 'upi'

        _insert_payment(cur, booking_id, extra_total, payment_method, now)
        if _has_table(cur, 'booking_extensions'):
            cur.execute(
                '''INSERT INTO booking_extensions
                   (booking_id, extra_minutes, old_end_ts, new_end_ts, extra_amount)
                   VALUES (%s,%s,%s,%s,%s)''',
                (booking_id, extra_minutes, old_end, new_end, extra_total),
            )
        sync_slot_statuses(cur)
        return _booking_select(cur, booking_id)


def complete_expired_bookings():
    """Transition completed bookings based on date and end time."""
    now = now_ist()
    with transaction() as cur:
        cur.execute(
            '''UPDATE bookings
               SET status='completed'
               WHERE status='booked'
                 AND (CASE
                      WHEN end_time < start_time
                      THEN TIMESTAMP(DATE_ADD(booking_date, INTERVAL 1 DAY), end_time)
                      ELSE TIMESTAMP(booking_date, end_time)
                 END) <= %s''',
            (now,),
        )
        sync_slot_statuses(cur)


def list_bookings(user_id, only_active=False):
    complete_expired_bookings()
    sql = 'SELECT booking_id FROM bookings WHERE user_id=%s'
    params = [user_id]
    if only_active:
        sql += " AND status='booked'"
    sql += ' ORDER BY booking_date DESC, start_time DESC'
    with read_cursor() as cur:
        cur.execute(sql, tuple(params))
        ids = [r['booking_id'] for r in cur.fetchall()]
        res = [_booking_select(cur, bid) for bid in ids]
        if only_active:
            res = [b for b in res if b['is_active']]
        return res


def get_stats():
    now = now_ist()
    complete_expired_bookings()
    with read_cursor() as cur:
        sync_slot_statuses(cur)
        # Lot stats
        cur.execute('''SELECT l.lot_id, l.lot_name, COUNT(s.slot_id) AS total_slots,
                              SUM(CASE WHEN s.status='occupied' THEN 1 ELSE 0 END) AS occupied_slots
                       FROM parking_lots l
                       LEFT JOIN parking_slots s ON s.lot_id=l.lot_id
                       GROUP BY l.lot_id, l.lot_name ORDER BY l.lot_id''')
        lots = []
        for r in cur.fetchall():
            total = int(r['total_slots'] or 0)
            occ = int(r['occupied_slots'] or 0)
            lots.append({
                'lot_id': r['lot_id'],
                'lot_name': r['lot_name'],
                'total_slots': total,
                'occupied_slots': occ,
                'available_slots': total - occ,
                'occupancy_pct': round(100.0 * occ / total, 1) if total > 0 else 0.0
            })

        # Zone stats aggregated cleanly in Python (immune to only_full_group_by)
        cur.execute("SELECT slot_id, lot_id, slot_number, zone_name, status FROM parking_slots")
        all_slots_list = cur.fetchall()
        zone_map_data = {
            'Zone A': {'zone_name': 'Zone A', 'total_slots': 0, 'occupied_slots': 0},
            'Zone B': {'zone_name': 'Zone B', 'total_slots': 0, 'occupied_slots': 0},
            'Zone C': {'zone_name': 'Zone C', 'total_slots': 0, 'occupied_slots': 0},
        }
        for sl in all_slots_list:
            zname = _slot_zone_name(sl['slot_number'], sl.get('zone_name'), sl.get('lot_id'))
            if zname not in zone_map_data:
                zone_map_data[zname] = {'zone_name': zname, 'total_slots': 0, 'occupied_slots': 0}
            zone_map_data[zname]['total_slots'] += 1
            if sl['status'] == 'occupied':
                zone_map_data[zname]['occupied_slots'] += 1

        zones = []
        for zname, zd in sorted(zone_map_data.items()):
            ztotal = zd['total_slots']
            zocc = zd['occupied_slots']
            zones.append({
                'zone_name': zname,
                'total_slots': ztotal,
                'occupied_slots': zocc,
                'available_slots': ztotal - zocc,
                'occupancy_pct': round(100.0 * zocc / ztotal, 1) if ztotal > 0 else 0.0
            })

        # The six-table database has no amenity relationship to verify EV
        # charging, so do not infer EV equipment from a zone or slot number.
        ev_slots = 0

        # Revenue for last 7 days
        cur.execute("""
            SELECT DATE(payment_date) AS day, COUNT(*) AS payments, SUM(amount) AS revenue 
            FROM payments 
            WHERE payment_status='completed' AND payment_date >= %s 
            GROUP BY DATE(payment_date) 
            ORDER BY day DESC
        """, (now - timedelta(days=7),))
        revenue = [
            {'day': r['day'].isoformat(), 'payments': int(r['payments']), 'revenue': _money(r['revenue'])}
            for r in cur.fetchall()
        ]

    total = sum(l['total_slots'] for l in lots)
    occupied = sum(l['occupied_slots'] for l in lots)
    avail = total - occupied
    occ_pct = round(100.0 * occupied / total, 1) if total > 0 else 0.0

    return {
        'total_slots': total,
        'occupied_slots': occupied,
        'available_slots': avail,
        'occupancy_pct': occ_pct,
        'ev_slots': ev_slots,
        'lots': lots,
        'zones': zones,
        'revenue_last_7_days': revenue,
        'as_of': _iso(now),
    }


if __name__ == '__main__':
    print('Connected:', ping())
    print('Slots:', len(list_slots()))
    print('Stats:', get_stats()['occupancy_pct'], '% occupied')
