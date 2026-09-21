/* ==========================================================
   ParkWise — Interactive Front-End Engine & Audio Synthesizer
   ========================================================== */

const API = {
    slots: '/api/slots',
    book: '/api/book',
    cancel: '/api/cancel'
};

const STORAGE_KEY = 'parkwise.bookings';
const SOUND_KEY = 'parkwise.sound_enabled';

const DEMO_SLOTS = [
    { id: 'A1', slot_id: 1, location: 'VIT Parking', type: 'car', rate: 30, zone: 'Zone A', status: 'available', isEv: true, covered: true },
    { id: 'A2', slot_id: 2, location: 'VIT Parking', type: 'car', rate: 30, zone: 'Zone A', status: 'available', isEv: false, covered: true },
    { id: 'A3', slot_id: 3, location: 'VIT Parking', type: 'car', rate: 30, zone: 'Zone A', status: 'occupied', isEv: false, covered: true },
    { id: 'A4', slot_id: 4, location: 'VIT Parking', type: 'car', rate: 35, zone: 'Zone A', status: 'available', isEv: true, covered: true },
    { id: 'B1', slot_id: 5, location: 'VIT Parking', type: 'bike', rate: 15, zone: 'Zone B', status: 'available', isEv: false, covered: false },
    { id: 'B2', slot_id: 6, location: 'VIT Parking', type: 'bike', rate: 15, zone: 'Zone B', status: 'available', isEv: false, covered: false },
    { id: 'B3', slot_id: 7, location: 'VIT Parking', type: 'bike', rate: 15, zone: 'Zone B', status: 'occupied', isEv: false, covered: false },
    { id: 'B4', slot_id: 8, location: 'VIT Parking', type: 'bike', rate: 15, zone: 'Zone B', status: 'available', isEv: false, covered: false },
    { id: 'C1', slot_id: 9, location: 'City Parking', type: 'car', rate: 50, zone: 'Zone C', status: 'available', isEv: true, covered: true },
    { id: 'C2', slot_id: 10, location: 'City Parking', type: 'car', rate: 50, zone: 'Zone C', status: 'available', isEv: false, covered: true },
    { id: 'C3', slot_id: 11, location: 'City Parking', type: 'car', rate: 50, zone: 'Zone C', status: 'occupied', isEv: false, covered: true },
    { id: 'C4', slot_id: 12, location: 'City Parking', type: 'bike', rate: 20, zone: 'Zone C', status: 'available', isEv: false, covered: false },
    { id: 'C5', slot_id: 13, location: 'City Parking', type: 'bike', rate: 20, zone: 'Zone C', status: 'available', isEv: false, covered: false }
];

const $ = (id) => document.getElementById(id);

const els = {
    location: $('location'),
    vehicle:  $('vehicleType'),
    date:     $('bookingDate'),
    time:     $('startTime'),
    slots:    $('slots'),
    count:    $('slotCount'),
    history:  $('bookingHistory'),
    visualBays: $('visualBaysGrid'),
    zoneSwitcher: $('zoneSwitcher'),
    configurator: $('bookingConfigurator'),
    durationSlider: $('durationSlider'),
    durationDisplay: $('durationDisplay'),
    vehiclePlate: $('vehiclePlateInput'),
    soundToggleBtn: $('soundToggleBtn'),
    soundIcon: $('soundIcon'),
    soundText: $('soundText'),
    statFree: $('statFreeSlots'),
    statOcc: $('statOccupancy'),
    navBadge: $('navBookingBadge')
};

/* Application State */
let bookings = loadBookings();
let allSlots = [...DEMO_SLOTS];
let activeZoneFilter = 'all';
let activeAmenityFilter = 'all';
let activeBookingTab = 'active';
let selectedSlot = null;
let currentDurationHours = 2;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
let activeExtendingBooking = null;


/* ==========================================================
   Web Audio API - Synthesized Micro-Sound Effects
   ========================================================== */

let audioCtx = null;

function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playCarBeep() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        
        // Double chirp 'beep-beep'
        [0, 0.12].forEach((offset) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1400, now + offset);
            osc.frequency.exponentialRampToValueAtTime(1800, now + offset + 0.06);
            gain.gain.setValueAtTime(0.15, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.09);
        });
    } catch (e) {}
}

function playSelectSound() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.07);
    } catch (e) {}
}

function playSuccessFanfare() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const t = ctx.currentTime + idx * 0.08;
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.18, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.38);
        });
    } catch (e) {}
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem(SOUND_KEY, soundEnabled);
    updateSoundUI();
    if (soundEnabled) playSelectSound();
}

function updateSoundUI() {
    if (soundEnabled) {
        els.soundIcon.className = 'fa-solid fa-volume-high';
        els.soundText.textContent = 'Sound On';
        els.soundToggleBtn.classList.remove('muted');
    } else {
        els.soundIcon.className = 'fa-solid fa-volume-xmark';
        els.soundText.textContent = 'Muted';
        els.soundToggleBtn.classList.add('muted');
    }
}


/* ==========================================================
   Helpers
   ========================================================== */

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

const pad = (n) => String(n).padStart(2, '0');

function localISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(date, time) {
    if (!date) return '';
    return new Date(`${date}T${time || '00:00'}`).toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short'
    });
}

function formatTime(date, time) {
    if (!date || !time) return '';
    return new Date(`${date}T${time}`).toLocaleTimeString('en-IN', {
        hour: 'numeric', minute: '2-digit'
    });
}

const vehicleLabel = (type) => (type === 'bike' ? '🏍️ Two Wheeler' : '🚗 Four Wheeler');

let toastTimer;
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-circle-check text-amber"></i> ${esc(message)}`;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}


/* ==========================================================
   Storage
   ========================================================== */

function loadBookings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (err) {
        return [];
    }
}

function saveBookings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
        updateNavBadge();
    } catch (err) {}
}

function updateNavBadge() {
    if (!els.navBadge) return;
    const activeCount = bookings.filter(b => !isBookingFinished(b)).length;
    if (activeCount > 0) {
        els.navBadge.textContent = activeCount;
        els.navBadge.style.display = 'grid';
    } else {
        els.navBadge.style.display = 'none';
    }
}


/* ==========================================================
   Slots & Visual Map Logic
   ========================================================== */

function isSlotBooked(slot, date, time) {
    return bookings.some((b) =>
        b.slotId === slot.id && b.location === slot.location &&
        b.date === date && !isBookingFinished(b)
    );
}

function isBookingFinished(booking) {
    const start = new Date(`${booking.date}T${booking.time}`);
    const durationMs = (booking.durationHours || 2) * 60 * 60 * 1000;
    const end = new Date(start.getTime() + durationMs);
    return new Date() > end;
}

function normalizeSlot(s) {
    const id = String(s.slot_number ?? s.id ?? s.slot_id ?? 'A1');
    const zone = s.zone ?? (`Zone ${id[0] || 'A'}`);
    return {
        id: id,
        slot_id: s.slot_id ?? id,
        location: s.lot_name ?? s.location ?? 'VIT Parking',
        type: String(s.slot_type ?? s.type ?? 'car').toLowerCase(),
        rate: Number(s.price_per_hour ?? s.rate ?? (s.slot_type === 'bike' ? 15 : 30)),
        zone: zone,
        status: s.status ?? 'available',
        isEv: s.isEv ?? (id.includes('1') || id.includes('4')),
        covered: s.covered ?? (id.startsWith('A') || id.startsWith('C'))
    };
}

async function fetchSlots(q) {
    try {
        const params = new URLSearchParams({
            location: q.location,
            vehicle_type: q.type,
            date: q.date,
            start_time: q.time
        });
        const res = await fetch(`${API.slots}?${params}`);
        if (!res.ok) throw new Error('Endpoint unreachable');
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.slots;
        if (!Array.isArray(list)) throw new Error('Invalid structure');
        return list.map(normalizeSlot);
    } catch (err) {
        // Fallback filter on local DEMO_SLOTS
        return DEMO_SLOTS.filter((s) =>
            (q.location === 'all' || s.location.toLowerCase().includes(q.location.toLowerCase())) &&
            (q.type === 'all' || s.type === q.type)
        ).map(normalizeSlot);
    }
}

function renderVisualMap(slots) {
    if (!els.visualBays) return;

    let filtered = slots;
    if (activeZoneFilter !== 'all') {
        filtered = filtered.filter(s => s.zone.toLowerCase().includes(activeZoneFilter.toLowerCase()));
    }

    els.visualBays.innerHTML = filtered.map((s) => {
        const booked = isSlotBooked(s, els.date.value, els.time.value) || s.status === 'occupied';
        const isSelected = selectedSlot && selectedSlot.id === s.id && selectedSlot.location === s.location;
        const statusClass = isSelected ? 'selected' : (booked ? 'occupied' : 'available');
        const vehicleIcon = s.type === 'bike' ? 'fa-motorcycle' : 'fa-car-side';

        return `
            <div class="map-bay-slot ${statusClass}" 
                 data-id="${esc(s.id)}" 
                 data-location="${esc(s.location)}"
                 title="${booked ? 'Occupied slot' : 'Click to select ' + s.id}">
                <div class="map-bay-header">
                    <span class="map-bay-id">${esc(s.id)}</span>
                    ${s.isEv ? '<i class="fa-solid fa-bolt map-bay-ev-tag" title="EV Fast Charging"></i>' : ''}
                </div>
                <div class="map-bay-visual-vehicle">
                    <i class="fa-solid ${vehicleIcon}"></i>
                </div>
                <div class="map-bay-footer">
                    ${isSelected ? 'SELECTED' : (booked ? 'OCCUPIED' : '₹' + s.rate + '/h')}
                </div>
            </div>
        `;
    }).join('');

    // Update real-time stats
    const total = slots.length;
    const freeCount = slots.filter(s => !isSlotBooked(s, els.date.value, els.time.value) && s.status !== 'occupied').length;
    const occRate = total > 0 ? Math.round(((total - freeCount) / total) * 100) : 0;
    
    if (els.statFree) els.statFree.textContent = freeCount;
    if (els.statOcc) els.statOcc.textContent = `${occRate}%`;
}

function renderSlotCards(list) {
    let filtered = list;
    
    // Apply amenity filters
    if (activeAmenityFilter === 'ev') {
        filtered = filtered.filter(s => s.isEv);
    } else if (activeAmenityFilter === 'covered') {
        filtered = filtered.filter(s => s.covered);
    }

    const availableSlots = filtered.filter(s => !isSlotBooked(s, els.date.value, els.time.value) && s.status !== 'occupied');
    
    els.count.textContent = `${availableSlots.length} ${availableSlots.length === 1 ? 'slot' : 'slots'} available`;
    els.count.classList.toggle('has-slots', availableSlots.length > 0);

    if (!availableSlots.length) {
        els.slots.innerHTML = `
            <div class="empty-message">
                <i class="fa-solid fa-ban fa-2x mb-2 text-muted"></i><br>
                No available slots matching this filter. Try adjusting your location, vehicle, or time.
            </div>
        `;
        return;
    }

    const atTime = formatTime(els.date.value, els.time.value);

    els.slots.innerHTML = availableSlots.map((s) => {
        const isSelected = selectedSlot && selectedSlot.id === s.id && selectedSlot.location === s.location;
        return `
        <article class="slot ${isSelected ? 'slot-selected' : ''}" data-id="${esc(s.id)}" data-location="${esc(s.location)}">
            <div class="slot-top">
                <span class="plate">${esc(s.id)}</span>
                <span class="chip">${vehicleLabel(s.type)}</span>
            </div>

            <div>
                <div class="slot-place">${esc(s.location)}</div>
                <div class="slot-zone-tag">${esc(s.zone)}</div>
                <div class="slot-amenities-row">
                    ${s.isEv ? '<span class="amenity-pill text-amber"><i class="fa-solid fa-bolt"></i> EV Ready</span>' : ''}
                    ${s.covered ? '<span class="amenity-pill"><i class="fa-solid fa-umbrella"></i> Covered</span>' : ''}
                    <span class="amenity-pill"><i class="fa-solid fa-shield"></i> CCTV</span>
                </div>
                <div class="slot-free mt-2"><i class="fa-solid fa-circle-check"></i> Free from ${esc(atTime)}</div>
            </div>

            <div class="slot-foot">
                <span class="price">₹${esc(s.rate)}<small>/hr</small></span>
                <button class="book-btn" type="button"
                        data-id="${esc(s.id)}"
                        data-location="${esc(s.location)}">
                    ${isSelected ? 'Selected' : 'Reserve Slot'}
                </button>
            </div>
        </article>`;
    }).join('');
}

function selectSlot(slot) {
    selectedSlot = slot;
    playSelectSound();

    // Populate configurator
    $('cfgSlotPlate').textContent = slot.id;
    $('cfgSlotTitle').textContent = `Slot ${slot.id} - ${vehicleLabel(slot.type)}`;
    $('cfgSlotLocation').innerHTML = `<i class="fa-solid fa-location-pin"></i> ${esc(slot.location)} • ${esc(slot.zone)}`;
    $('cfgSlotBadge').innerHTML = slot.isEv 
        ? '<i class="fa-solid fa-bolt text-amber"></i> EV Fast Charge Bay' 
        : '<i class="fa-solid fa-check-circle text-free"></i> Premium Space';

    els.configurator.style.display = 'block';
    recalculateFee();

    // Re-render map and cards to reflect highlight
    renderVisualMap(allSlots);
    renderSlotCards(allSlots);

    // Smooth scroll to configurator
    els.configurator.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearSelectedSlot() {
    selectedSlot = null;
    els.configurator.style.display = 'none';
    renderVisualMap(allSlots);
    renderSlotCards(allSlots);
}

function recalculateFee() {
    if (!selectedSlot) return;

    const rate = selectedSlot.rate || 30;
    const baseTotal = rate * currentDurationHours;
    const tax = Math.round(baseTotal * 0.05);
    const grandTotal = baseTotal + tax;

    $('calcBaseRate').textContent = `₹${rate}`;
    $('calcHours').textContent = currentDurationHours;
    $('calcBaseTotal').textContent = `₹${baseTotal}`;
    $('calcTax').textContent = `₹${tax}`;
    $('calcGrandTotal').textContent = `₹${grandTotal}`;
    $('btnPayAmount').textContent = `₹${grandTotal}`;
    $('modalPayableAmount').textContent = `₹${grandTotal}.00`;

    // Estimate End Time
    const startTimeStr = els.time.value || '10:00';
    const [h, m] = startTimeStr.split(':').map(Number);
    const endH = (h + currentDurationHours) % 24;
    const ampm = endH >= 12 ? 'PM' : 'AM';
    const displayH = endH % 12 || 12;
    $('calcEstimatedEnd').textContent = `Valid until ${pad(displayH)}:${pad(m)} ${ampm}`;
}

async function findParking() {
    const q = {
        location: els.location.value,
        type:     els.vehicle.value,
        date:     els.date.value,
        time:     els.time.value
    };

    if (!q.date || !q.time) {
        showToast('Please select a date and start time first.');
        return;
    }

    playSelectSound();
    els.slots.innerHTML = `
        <div class="empty-message">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x mb-2 text-amber"></i><br>
            Checking real-time bay availability...
        </div>
    `;

    const list = await fetchSlots(q);
    allSlots = list;
    renderVisualMap(list);
    renderSlotCards(list);
}


/* ==========================================================
   Payment & Digital Pass Ticket Modal
   ========================================================== */

function openPaymentModal() {
    if (!selectedSlot) {
        showToast('Please select a parking slot first.');
        return;
    }

    const plateVal = (els.vehiclePlate.value || 'MH 12 AB 1234').trim().toUpperCase();
    if (!plateVal) {
        showToast('Enter your vehicle registration number.');
        els.vehiclePlate.focus();
        return;
    }

    playSelectSound();
    $('paymentModal').classList.add('show');
}

function closePaymentModal() {
    $('paymentModal').classList.remove('show');
}

function copyUpiId() {
    navigator.clipboard?.writeText('parkwise.pay@upi');
    showToast('UPI ID copied to clipboard!');
    playSelectSound();
}

async function processPayment() {
    const btn = $('confirmPayBtn');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authorizing...';
    btn.disabled = true;

    const plateVal = (els.vehiclePlate.value || 'MH 12 AB 1234').trim().toUpperCase();
    const activeMethod = document.querySelector('.pay-tab-btn.active')?.dataset.method || 'upi';

    try {
        const payload = {
            slot_id: selectedSlot.slot_id || selectedSlot.id,
            vehicle_number: plateVal,
            booking_date: els.date.value,
            start_time: els.time.value,
            duration_hours: currentDurationHours,
            payment_method: activeMethod
        };

        // Try API booking
        const res = await fetch(API.book, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        // Create local session booking record
        const bookingId = result.booking_id || Math.floor(100000 + Math.random() * 900000);
        const newBooking = {
            id: bookingId,
            slotId: selectedSlot.id,
            location: selectedSlot.location,
            zone: selectedSlot.zone,
            type: selectedSlot.type,
            rate: selectedSlot.rate,
            date: els.date.value,
            time: els.time.value,
            durationHours: currentDurationHours,
            plate: plateVal,
            amount: $('calcGrandTotal').textContent,
            passCode: `PW-${Math.floor(1000 + Math.random() * 9000)}-${selectedSlot.id}`
        };

        bookings.unshift(newBooking);
        saveBookings();

        // Trigger Confetti Celebration!
        if (typeof confetti === 'function') {
            confetti({
                particleCount: 80,
                spread: 70,
                origin: { y: 0.6 }
            });
        }

        playSuccessFanfare();
        closePaymentModal();

        // Show Digital Pass Ticket
        showDigitalTicket(newBooking);

        // Update state
        clearSelectedSlot();
        renderVisualMap(allSlots);
        renderSlotCards(allSlots);
        renderBookings();

        showToast(`Slot ${newBooking.slotId} booked successfully!`);
    } catch (e) {
        showToast('Booking completed.');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Authorize & Complete Booking';
        btn.disabled = false;
    }
}


/* ==========================================================
   Digital Pass / QR Ticket
   ========================================================== */

function showDigitalTicket(booking) {
    $('ticketSlotPlate').textContent = booking.slotId;
    $('ticketLotName').textContent = booking.location;
    $('ticketSlotZone').textContent = booking.zone || 'Zone A';
    $('ticketPlateNum').textContent = booking.plate || 'MH 12 AB 1234';
    $('ticketVehicleType').textContent = vehicleLabel(booking.type);
    $('ticketDate').textContent = formatDay(booking.date, booking.time);
    
    // Time range calculation
    const [h, m] = (booking.time || '10:00').split(':').map(Number);
    const endH = (h + (booking.durationHours || 2)) % 24;
    $('ticketTimeRange').textContent = `${booking.time} - ${pad(endH)}:${pad(m)}`;
    $('ticketPassCode').textContent = booking.passCode || `PW-9821-${booking.slotId}`;

    $('ticketModal').classList.add('show');
}

function closeTicketModal() {
    $('ticketModal').classList.remove('show');
}

function printOrDownloadTicket() {
    window.print();
}

function navigateToBookings() {
    const el = document.getElementById('bookings');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}


/* ==========================================================
   My Bookings & Live Timers
   ========================================================== */

function renderBookings() {
    if (!els.history) return;

    if (!bookings.length) {
        els.history.innerHTML = `
            <div class="empty-message">
                <i class="fa-solid fa-ticket fa-2x mb-2 text-muted"></i><br>
                No active reservations found. Tap any slot on the map to book.
            </div>
        `;
        return;
    }

    const filtered = bookings.filter(b => {
        if (activeBookingTab === 'active') return !isBookingFinished(b);
        return true;
    });

    if (!filtered.length) {
        els.history.innerHTML = `
            <div class="empty-message">
                <i class="fa-solid fa-calendar-check fa-2x mb-2 text-muted"></i><br>
                No ${activeBookingTab} bookings.
            </div>
        `;
        return;
    }

    els.history.innerHTML = filtered.map((b) => {
        const finished = isBookingFinished(b);
        return `
        <article class="booking ${finished ? 'booking--done' : 'booking--active'}">
            <div class="booking-when">
                <strong>${esc(formatDay(b.date, b.time))}</strong>
                <span><i class="fa-solid fa-clock"></i> ${esc(b.time)} (${b.durationHours || 2} hrs)</span>
            </div>

            <div class="booking-what">
                <span class="plate">${esc(b.slotId)}</span>
                <div>
                    <span class="booking-place">${esc(b.location)}</span>
                    <span class="booking-type">${vehicleLabel(b.type)} • ${esc(b.plate || 'MH 12 AB 1234')}</span>
                </div>
            </div>

            <!-- Real-time countdown timer -->
            ${finished ? `
                <div class="booking-live-timer" style="background:#F1F5F9; border-color:#CBD5E1;">
                    <div>
                        <span class="timer-lbl" style="color:#64748B;">SESSION STATUS</span>
                        <strong class="timer-ticking" style="color:#475569;">Completed</strong>
                    </div>
                </div>
            ` : `
                <div class="booking-live-timer">
                    <i class="fa-solid fa-hourglass-half fa-spin text-free"></i>
                    <div>
                        <span class="timer-lbl">SESSION TIME REMAINING</span>
                        <strong class="timer-ticking" data-timer-id="${esc(b.id)}" data-start="${esc(b.date)}T${esc(b.time)}" data-hours="${b.durationHours || 2}">
                            Calculating...
                        </strong>
                    </div>
                </div>
            `}

            <div class="booking-actions">
                <button class="btn-action btn-ticket" type="button" data-view-pass="${esc(b.id)}">
                    <i class="fa-solid fa-qrcode"></i> Digital Pass
                </button>
                ${finished ? '' : `
                    <button class="btn-action btn-extend" type="button" data-extend-id="${esc(b.id)}">
                        <i class="fa-solid fa-plus"></i> Extend
                    </button>
                    <button class="btn-action cancel-btn" type="button" data-cancel-id="${esc(b.id)}">
                        <i class="fa-solid fa-xmark"></i> Cancel
                    </button>
                `}
            </div>
        </article>`;
    }).join('');

    updateTimers();
}

function updateTimers() {
    const timerElements = document.querySelectorAll('[data-timer-id]');
    const now = new Date();

    timerElements.forEach((el) => {
        const start = new Date(el.dataset.start);
        const durationHours = parseFloat(el.dataset.hours || 2);
        const end = new Date(start.getTime() + durationHours * 3600 * 1000);
        const diffMs = end - now;

        if (diffMs <= 0) {
            el.textContent = 'Session Expired';
            el.style.color = '#EF4444';
        } else {
            const hrs = Math.floor(diffMs / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            el.textContent = `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
        }
    });
}

// Live timer tick every second
setInterval(updateTimers, 1000);


/* ==========================================================
   Extend Session Modal
   ========================================================== */

function openExtendModal(bookingId) {
    activeExtendingBooking = bookings.find(b => String(b.id) === String(bookingId));
    if (!activeExtendingBooking) return;

    playSelectSound();
    $('extendModalSubtitle').textContent = `Slot ${activeExtendingBooking.slotId} • ${activeExtendingBooking.location}`;
    updateExtendCalculation(30);
    $('extendModal').classList.add('show');
}

function closeExtendModal() {
    $('extendModal').classList.remove('show');
}

function updateExtendCalculation(extraMins) {
    if (!activeExtendingBooking) return;
    const rate = activeExtendingBooking.rate || 30;
    const extraAmount = Math.round((rate / 60) * extraMins);
    $('extendExtraAmount').textContent = `₹${extraAmount}`;

    const [h, m] = (activeExtendingBooking.time || '10:00').split(':').map(Number);
    const totalMins = (activeExtendingBooking.durationHours || 2) * 60 + extraMins;
    const endH = Math.floor((h * 60 + m + totalMins) / 60) % 24;
    const endM = (m + totalMins) % 60;
    $('extendNewEndTime').textContent = `${pad(endH)}:${pad(endM)}`;
}

function confirmExtendSession() {
    if (!activeExtendingBooking) return;
    const selectedBtn = document.querySelector('.extend-opt-btn.active');
    const extraMins = parseInt(selectedBtn?.dataset.extra || 30);
    
    activeExtendingBooking.durationHours = (activeExtendingBooking.durationHours || 2) + (extraMins / 60);
    saveBookings();
    renderBookings();
    closeExtendModal();
    playSuccessFanfare();
    showToast(`Parking session extended by +${extraMins} mins!`);
}


/* ==========================================================
   Event Listeners
   ========================================================== */

function initEventListeners() {
    // Sound Toggle
    if (els.soundToggleBtn) {
        els.soundToggleBtn.addEventListener('click', toggleSound);
    }

    // Hero interactive lot click
    const heroLot = $('heroInteractiveLot');
    if (heroLot) {
        heroLot.addEventListener('click', (e) => {
            const bay = e.target.closest('.bay');
            if (!bay) return;
            if (bay.classList.contains('empty')) {
                bay.classList.remove('empty');
                bay.classList.add('occupied');
                const randomColors = ['green', 'amber', 'sky', 'white'];
                const color = randomColors[Math.floor(Math.random() * randomColors.length)];
                bay.innerHTML = `<span class="car car--${color}"></span><span class="bay-num">${bay.dataset.bay ? 'P' + bay.dataset.bay : 'P'}</span>`;
                playCarBeep();
                showToast(`Vehicle parked in demo bay!`);
            }
        });
    }

    // 2D Visual Map Bay Clicks
    if (els.visualBays) {
        els.visualBays.addEventListener('click', (e) => {
            const bay = e.target.closest('.map-bay-slot');
            if (!bay) return;
            if (bay.classList.contains('occupied')) {
                showToast('This bay is currently occupied. Please pick an open bay.');
                return;
            }
            const slot = allSlots.find(s => s.id === bay.dataset.id && s.location === bay.dataset.location);
            if (slot) selectSlot(slot);
        });
    }

    // Zone Switcher Tabs
    if (els.zoneSwitcher) {
        els.zoneSwitcher.addEventListener('click', (e) => {
            const btn = e.target.closest('.zone-btn');
            if (!btn) return;
            document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeZoneFilter = btn.dataset.zone;
            playSelectSound();
            renderVisualMap(allSlots);
        });
    }

    // Quick Amenity Filter Chips
    document.querySelectorAll('.chip-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chip-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeAmenityFilter = btn.dataset.filter;
            playSelectSound();
            renderSlotCards(allSlots);
        });
    });

    // Duration Slider
    if (els.durationSlider) {
        els.durationSlider.addEventListener('input', (e) => {
            currentDurationHours = parseInt(e.target.value);
            els.durationDisplay.textContent = `${currentDurationHours} ${currentDurationHours === 1 ? 'Hour' : 'Hours'}`;
            
            // Sync pill buttons
            document.querySelectorAll('.pill-btn').forEach(p => {
                p.classList.toggle('active', parseInt(p.dataset.hours) === currentDurationHours);
            });
            recalculateFee();
        });
    }

    // Duration Pills
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDurationHours = parseInt(btn.dataset.hours);
            if (els.durationSlider) els.durationSlider.value = currentDurationHours;
            els.durationDisplay.textContent = `${currentDurationHours} ${currentDurationHours === 1 ? 'Hour' : 'Hours'}`;
            playSelectSound();
            recalculateFee();
        });
    });

    // Vehicle Plate Input Auto-formatting
    if (els.vehiclePlate) {
        els.vehiclePlate.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }

    // Slot Cards Click (Book or Select)
    if (els.slots) {
        els.slots.addEventListener('click', (e) => {
            const btn = e.target.closest('.book-btn');
            const card = e.target.closest('.slot');
            const target = btn || card;
            if (!target) return;

            const slot = allSlots.find(s => s.id === target.dataset.id && s.location === target.dataset.location);
            if (slot) selectSlot(slot);
        });
    }

    // Payment method tabs
    document.querySelectorAll('.pay-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pay-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const method = btn.dataset.method;
            $('payContentUpi').style.display = method === 'upi' ? 'block' : 'none';
            $('payContentCard').style.display = method === 'card' ? 'block' : 'none';
            $('payContentCash').style.display = method === 'cash' ? 'block' : 'none';
            playSelectSound();
        });
    });

    // Extend Option Buttons
    document.querySelectorAll('.extend-opt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.extend-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateExtendCalculation(parseInt(btn.dataset.extra));
            playSelectSound();
        });
    });

    // Booking Tab Filters
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeBookingTab = btn.dataset.tab;
            playSelectSound();
            renderBookings();
        });
    });

    // Booking List Actions (View Pass, Extend, Cancel)
    if (els.history) {
        els.history.addEventListener('click', async (e) => {
            // View Pass
            const passBtn = e.target.closest('[data-view-pass]');
            if (passBtn) {
                const b = bookings.find(item => String(item.id) === passBtn.dataset.viewPass);
                if (b) showDigitalTicket(b);
                return;
            }

            // Extend
            const extendBtn = e.target.closest('[data-extend-id]');
            if (extendBtn) {
                openExtendModal(extendBtn.dataset.extendId);
                return;
            }

            // Cancel
            const cancelBtn = e.target.closest('[data-cancel-id]');
            if (cancelBtn) {
                const bookingId = cancelBtn.dataset.cancelId;
                if (confirm('Are you sure you want to cancel this booking?')) {
                    try {
                        await fetch(API.cancel, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ booking_id: bookingId })
                        });
                    } catch (err) {}
                    
                    bookings = bookings.filter(b => String(b.id) !== String(bookingId));
                    saveBookings();
                    renderVisualMap(allSlots);
                    renderSlotCards(allSlots);
                    renderBookings();
                    showToast('Booking cancelled. Slot has been freed.');
                    playSelectSound();
                }
            }
        });
    }
}


/* ==========================================================
   Initialization
   ========================================================== */

(function init() {
    updateSoundUI();

    const start = new Date();
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);

    els.date.min = localISO(new Date());
    els.date.value = localISO(start);
    els.time.value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;

    initEventListeners();
    updateNavBadge();

    // Initial load
    findParking();
    renderBookings();
})();