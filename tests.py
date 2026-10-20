"""Lightweight Flask route tests; run with `python -m unittest tests.py`.
These tests mock the data layer and do not require a running MySQL server.
"""
import unittest
from unittest.mock import patch

import app as parkwise_app
from database import SlotTaken


class ParkWiseRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = parkwise_app.app.test_client()
        parkwise_app.app.config["TESTING"] = True

    @patch("app.database.create_booking", return_value={
        "booking_id": 101,
        "total_amount": 63.0,
        "status": "booked",
        "start": "2026-10-20T10:00:00",
        "zone": "Zone A"
    })
    def test_booking_does_not_require_authentication(self, create):
        response = self.client.post("/api/book", json={
            "slot_id": 1,
            "vehicle_number": "MH12AB1234",
            "booking_date": "2026-10-20",
            "start_time": "10:00",
            "duration_hours": 2,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(create.call_args.kwargs["user_id"], parkwise_app.DEMO_USER_ID)

    def test_authentication_routes_are_removed(self):
        for method, path in (
            (self.client.get, "/api/auth/me"),
            (self.client.post, "/api/auth/login"),
            (self.client.post, "/api/auth/logout"),
        ):
            with self.subTest(path=path):
                self.assertEqual(method(path).status_code, 404)

    def test_home_page_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"ParkWise", response.data)
        self.assertNotIn(b"Sign in", response.data)

    @patch("app.database.ping", return_value=True)
    def test_health(self, _ping):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])

    @patch("app.database.list_slots", return_value=[])
    def test_slots_endpoint(self, list_slots):
        response = self.client.get(
            "/api/slots?location=VIT%20Parking&vehicle_type=car&booking_date=2026-10-20&start_time=10:00&duration_hours=2&zone=Zone%20A"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["slots"], [])
        list_slots.assert_called_once()

    def test_booking_requires_slot_id(self):
        response = self.client.post("/api/book", json={"vehicle_number": "MH12AB1234"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["success"])

    @patch("app.database.create_booking", side_effect=SlotTaken("Slot is already booked"))
    def test_booking_conflict_returns_409(self, _create):
        response = self.client.post("/api/book", json={
            "user_id": 1,
            "slot_id": 1,
            "vehicle_number": "MH12AB1234",
            "booking_date": "2026-10-20",
            "start_time": "10:00",
            "duration_hours": 2,
            "payment_method": "upi",
        })
        self.assertEqual(response.status_code, 409)
        self.assertIn("already booked", response.get_json()["message"])

    @patch("app.database.create_booking", return_value={
        "booking_id": 101,
        "total_amount": 63.0,
        "status": "booked",
        "start": "2026-10-20T10:00:00",
        "zone": "Zone A"
    })
    def test_booking_success(self, create):
        response = self.client.post("/api/book", json={
            "user_id": 1,
            "slot_id": 1,
            "vehicle_number": "MH12AB1234",
            "booking_date": "2026-10-20",
            "start_time": "10:00",
            "duration_hours": 2,
            "payment_method": "upi",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["booking_id"], 101)
        create.assert_called_once()

    def test_invalid_date_returns_400(self):
        response = self.client.post("/api/book", json={
            "user_id": 1,
            "slot_id": 1,
            "vehicle_number": "MH12AB1234",
            "booking_date": "not-a-date",
            "start_time": "10:00",
            "duration_hours": 2,
            "payment_method": "upi",
        })
        self.assertEqual(response.status_code, 400)

    def test_booking_duration_below_minimum_returns_400(self):
        response = self.client.post("/api/book", json={
            "user_id": 1,
            "slot_id": 1,
            "vehicle_number": "MH12AB1234",
            "booking_date": "2026-10-20",
            "start_time": "10:00",
            "duration_hours": 0.1,
            "payment_method": "upi",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("15 minutes", response.get_json()["message"])

    @patch("app.database.cancel_booking", return_value={"booking_id": 101, "status": "cancelled", "refund_amount": 63.0})
    def test_cancel_endpoint(self, cancel):
        response = self.client.post("/api/cancel", json={"booking_id": 101, "user_id": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "cancelled")

    @patch("app.database.extend_booking", return_value={"booking_id": 101, "status": "booked", "end_time": "13:00"})
    def test_extend_endpoint(self, extend):
        response = self.client.post("/api/extend", json={"booking_id": 101, "user_id": 1, "extra_minutes": 60})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["end_time"], "13:00")

    @patch("app.database.list_bookings", return_value=[{"booking_id": 101, "status": "booked"}])
    def test_my_bookings_endpoint(self, list_b):
        response = self.client.get("/api/bookings?user_id=1&status=all")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["bookings"]), 1)

    @patch("app.database.get_stats", return_value={"total_slots": 8, "occupied_slots": 2, "available_slots": 6, "occupancy_pct": 25.0})
    def test_stats_endpoint(self, get_st):
        response = self.client.get("/api/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["occupancy_pct"], 25.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
