# 🚗 ParkWise — Smart & Interactive Parking Management System

ParkWise is a modern smart parking web application featuring real-time interactive 2D parking lot spatial maps, dynamic duration & fee calculations, synthesized audio effects, digital QR passes, and active session timers.

---

## 🌟 Key Features

- **Interactive 2D Parking Lot Map**: Spatial view with live bay occupancy, drive lanes, and EV fast-charging bay highlights.
- **Dynamic Duration & Fee Calculator**: Real-time slider (1h - 12h) with automatic GST calculation and estimated departure times.
- **Audio Feedback Engine**: Pure Web Audio API synthesized sounds for car lock chirps (`beep-beep`), slot selection clicks, and success chimes.
- **Instant Payment Gateway Simulator**: Tabbed checkout for UPI QR, 3D Credit Card preview, and Cash on Arrival.
- **Digital QR Parking Pass**: Printable digital pass ticket with QR code and active session live countdown timers.
- **RESTful Flask Backend**: Endpoints for checking slots, booking, and cancelling with graceful local session fallback.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, Vanilla CSS3 (Custom Design Tokens & Glassmorphism), JavaScript (ES6+), Web Audio API, Canvas Confetti.
- **Backend**: Python, Flask, Gunicorn.
- **Database**: MySQL (`database.sql` schema provided).

---

## 🚀 Quick Start

### 1. Clone & Setup
```bash
git clone https://github.com/saksham01042006/parkwise.git
cd parkwise
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Run Locally
```bash
python app.py
```
Open **`http://127.0.0.1:5000`** in your browser.

---

## 🐳 Docker Deployment
```bash
docker build -t parkwise .
docker run -p 8080:8080 parkwise
```
