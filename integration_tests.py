"""ParkWise End-to-End Acceptance and Integration Test Suite."""
import unittest
from datetime import datetime, timedelta
import app as parkwise_app
import database


class ParkWiseAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = parkwise_app.app.test_client()
        parkwise_app.app.config["TESTING"] = True

    def test_01_health_check(self):
        """Verify /api/health reports database connectivity."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("database"), "connected")

    def test_02_slots_zone_a(self):
        """Verify Zone A returns correctly assigned Zone A slots."""
        res = self.client.get("/api/slots?zone=Zone%20A")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        slots = data.get("slots", [])
        self.assertGreater(len(slots), 0)
        for s in slots:
            self.assertEqual(s["zone"], "Zone A")
            self.assertEqual(s["zone_id"], 1)

    def test_03_slots_zone_b(self):
        """Verify Zone B returns correctly assigned Zone B slots."""
        res = self.client.get("/api/slots?zone=Zone%20B")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        slots = data.get("slots", [])
        self.assertGreater(len(slots), 0)
        for s in slots:
            self.assertEqual(s["zone"], "Zone B")
            self.assertEqual(s["zone_id"], 2)

    def test_04_slots_zone_c(self):
        """Verify Zone C returns correctly assigned Zone C slots."""
        res = self.client.get("/api/slots?zone=Zone%20C")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        slots = data.get("slots", [])
        self.assertGreater(len(slots), 0)
        for s in slots:
            self.assertEqual(s["zone"], "Zone C")
            self.assertEqual(s["zone_id"], 3)

    def test_05_invalid_zone_rejected(self):
        """Verify invalid zone names and zone IDs return 400 Bad Request."""
        res1 = self.client.get("/api/slots?zone=Zone%20Invalid")
        self.assertEqual(res1.status_code, 400)
        self.assertIn("Invalid zone", res1.get_json().get("message", ""))

        res2 = self.client.get("/api/slots?zone_id=999")
        self.assertEqual(res2.status_code, 400)
        self.assertIn("Invalid zone_id", res2.get_json().get("message", ""))

    def test_06_my_bookings_loads_without_database_error(self):
        """Verify /api/bookings returns bookings with proper schema and no SQL errors."""
        res = self.client.get("/api/bookings?user_id=1&status=all")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertIsInstance(data.get("bookings"), list)
        if data["bookings"]:
            sample = data["bookings"][0]
            self.assertIn("booking_id", sample)
            self.assertIn("slot_number", sample)
            self.assertIn("lot_name", sample)
            self.assertIn("zone", sample)
            self.assertIn("status", sample)
            self.assertIn("payment_status", sample)
            self.assertIn("total_amount", sample)

    def test_07_dashboard_stats(self):
        """Verify /api/stats returns real lot, zone, and occupancy counts without SQL group-by error."""
        res = self.client.get("/api/stats")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertIn("total_slots", data)
        self.assertIn("occupied_slots", data)
        self.assertIn("available_slots", data)
        self.assertIn("occupancy_pct", data)
        self.assertIn("lots", data)
        self.assertIn("zones", data)
        # Zone A, Zone B, Zone C should all be present in zone breakdown
        zone_names = [z["zone_name"] for z in data["zones"]]
        self.assertIn("Zone A", zone_names)
        self.assertIn("Zone B", zone_names)
        self.assertIn("Zone C", zone_names)

    def test_08_booking_lifecycle_conflict_extend_and_cancellation(self):
        """Test full booking lifecycle: create, conflict rejection, extension, cancel, double-cancel guard."""
        # Find an available slot for test date 25 days ahead
        future_date = (database.now_ist() + timedelta(days=25)).strftime("%Y-%m-%d")
        
        created_booking_ids = []
        try:
            # 1. Book an available slot
            slot_id = 4 # B2 in Lot 1
            plate = "MH12TEST99"
            book_res = self.client.post("/api/book", json={
                "user_id": 1,
                "slot_id": slot_id,
                "vehicle_number": plate,
                "booking_date": future_date,
                "start_time": "10:00",
                "duration_hours": 2,
                "payment_method": "upi",
            })
            self.assertEqual(book_res.status_code, 201)
            booking_data = book_res.get_json()
            booking_id = booking_data["booking_id"]
            created_booking_ids.append(booking_id)
            self.assertIsNotNone(booking_id)
            self.assertEqual(booking_data["zone"], "Zone B")

            # 2. Try booking the SAME slot for overlapping time (11:00 - 13:00) -> 409 Conflict
            conflict_res = self.client.post("/api/book", json={
                "user_id": 1,
                "slot_id": slot_id,
                "vehicle_number": plate,
                "booking_date": future_date,
                "start_time": "11:00",
                "duration_hours": 2,
                "payment_method": "card",
            })
            self.assertEqual(conflict_res.status_code, 409)
            self.assertIn("already booked", conflict_res.get_json().get("message", "").lower())

            # 3. Book a DIFFERENT available slot (slot 8: B2 in Lot 2) -> 201 Created
            different_res = self.client.post("/api/book", json={
                "user_id": 1,
                "slot_id": 8,
                "vehicle_number": plate,
                "booking_date": future_date,
                "start_time": "10:00",
                "duration_hours": 2,
                "payment_method": "upi",
            })
            self.assertEqual(different_res.status_code, 201)
            diff_booking_id = different_res.get_json()["booking_id"]
            created_booking_ids.append(diff_booking_id)

            # 4. Extend the first booking by 60 minutes -> 200 OK
            extend_res = self.client.post("/api/extend", json={
                "booking_id": booking_id,
                "user_id": 1,
                "extra_minutes": 60,
            })
            self.assertEqual(extend_res.status_code, 200)
            ext_data = extend_res.get_json()
            self.assertEqual(ext_data["end_time"], "13:00")
            self.assertEqual(ext_data["duration_hours"], 3.0)

            # 5. Cancel the different slot booking
            cancel_diff = self.client.post("/api/cancel", json={
                "booking_id": diff_booking_id,
                "user_id": 1,
            })
            self.assertEqual(cancel_diff.status_code, 200)

            # 6. Cancel the first booking -> 200 OK
            cancel_res = self.client.post("/api/cancel", json={
                "booking_id": booking_id,
                "user_id": 1,
            })
            self.assertEqual(cancel_res.status_code, 200)
            cancel_data = cancel_res.get_json()
            self.assertEqual(cancel_data["status"], "cancelled")
            self.assertGreaterEqual(cancel_data.get("refund_amount", 0), 0)

            # 7. Repeated cancellation attempt -> 400 Bad Request
            repeat_cancel_res = self.client.post("/api/cancel", json={
                "booking_id": booking_id,
                "user_id": 1,
            })
            self.assertEqual(repeat_cancel_res.status_code, 400)
            self.assertIn("already cancelled", repeat_cancel_res.get_json().get("message", "").lower())

        finally:
            with database.transaction() as cur:
                for bid in created_booking_ids:
                    cur.execute("DELETE FROM payments WHERE booking_id=%s", (bid,))
                    cur.execute("DELETE FROM bookings WHERE booking_id=%s", (bid,))
                cur.execute("DELETE FROM vehicles WHERE vehicle_number LIKE '%TEST%'")
                database.sync_slot_statuses(cur)


if __name__ == "__main__":
    unittest.main(verbosity=2)
