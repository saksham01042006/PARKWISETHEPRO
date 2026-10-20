/* ==========================================================
   ParkWise — Interactive Front-End Engine & Audio Synthesizer
   ========================================================== */

const API = {
    slots: '/api/slots',
    book: '/api/book',
    cancel: '/api/cancel',
    extend: '/api/extend',
    bookings: '/api/bookings',
    stats: '/api/stats'
};

const SOUND_KEY = 'parkwise.sound_enabled';

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
    statEv: $('statEvBays'),
    navBadge: $('navBookingBadge')
};

/* Application State */
let bookings = []; // Loaded from MySQL through /api/bookings
let allSlots = [];
let activeZoneFilter = 'all';
let activeAmenityFilter = 'all';
let activeBookingTab = 'active';
let selectedSlot = null;
let currentDurationHours = 2;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
let activeExtendingBooking = null;
let activeTicketBooking = null;


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
        if (els.soundIcon) els.soundIcon.className = 'fa-solid fa-volume-high';
        if (els.soundText) els.soundText.textContent = 'Sound On';
        if (els.soundToggleBtn) els.soundToggleBtn.classList.remove('muted');
    } else {
        if (els.soundIcon) els.soundIcon.className = 'fa-solid fa-volume-xmark';
        if (els.soundText) els.soundText.textContent = 'Muted';
        if (els.soundToggleBtn) els.soundToggleBtn.classList.add('muted');
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
const formatRupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;

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
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}


/* ==========================================================
   Storage & Bookings Sync
   ========================================================== */

function loadBookings() {
    return [];
}

function saveBookings() {
    updateNavBadge();
}

function normalizeBooking(b) {
    const start = b.start || `${b.booking_date}T${b.start_time}`;
    const end = b.end || '';
    const date = b.booking_date || start.slice(0, 10);
    const time = b.start_time || start.slice(11, 16);
    const durationHours = Number(b.duration_hours || 2);
    return {
        id: b.booking_id,
        booking_id: b.booking_id,
        slotId: b.slot_number || String(b.slot_id),
        slot_id: b.slot_id,
        location: b.lot_name || 'Parking Lot',
        zone: b.zone || 'Zone A',
        zone_id: b.zone_id,
        type: b.slot_type || 'car',
        rate: Number(b.price_per_hour || 0),
        date,
        time,
        durationHours,
        plate: b.vehicle_number || '',
        totalAmount: Number(b.total_amount || 0),
        status: b.status || 'booked',
        paymentStatus: b.payment_status || 'pending',
        paymentMethod: b.payment_method || '',
        bookingReference: b.booking_reference || `PW-${b.booking_id}`,
        paymentReference: b.payment_reference || '',
        end,
        endTime: b.end_time || end.slice(11, 16),
        passCode: b.booking_reference || `PW-${b.booking_id}`
    };
}

async function refreshBookings() {
    const res = await fetch(`${API.bookings}?status=all`);
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.bookings)) {
        throw new Error(data.message || 'Could not load booking history from the database.');
    }
    bookings = data.bookings.map(normalizeBooking);
    updateNavBadge();
    renderBookings();
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

async function updateDashboardStats() {
    try {
        const res = await fetch(API.stats);
        const data = await res.json();
        if (res.ok && data.success) {
            if (els.statFree) els.statFree.textContent = data.available_slots;
            if (els.statOcc) els.statOcc.textContent = `${data.occupancy_pct}%`;
            if (els.statEv) els.statEv.textContent = `${data.ev_slots || 0} EV`;
        }
    } catch (e) {
        console.warn('Dashboard stats update failed:', e);
        if (els.statFree) els.statFree.textContent = '—';
        if (els.statOcc) els.statOcc.textContent = '—';
        if (els.statEv) els.statEv.textContent = '—';
    }
}


/* ==========================================================
   Slots & Visual Map Logic
   ========================================================== */

function isSlotBooked(slot, date, time, durationHours) {
    const requestedStart = new Date(`${date}T${time}`).getTime();
    const requestedEnd = requestedStart + durationHours * 60 * 60 * 1000;
    if (!Number.isFinite(requestedStart)) return false;

    return bookings.some((booking) => {
        if (Number(booking.slot_id) !== Number(slot.slot_id) || booking.status !== 'booked') {
            return false;
        }
        const bookingStart = new Date(`${booking.date}T${booking.time}`).getTime();
        const bookingEnd = booking.end
            ? new Date(booking.end.replace(' ', 'T')).getTime()
            : bookingStart + (booking.durationHours || 2) * 60 * 60 * 1000;
        return Number.isFinite(bookingStart) && Number.isFinite(bookingEnd) &&
            bookingStart < requestedEnd && bookingEnd > requestedStart;
    });
}

function isBookingFinished(booking) {
    if (booking.status && booking.status !== 'booked') return true;
    const start = new Date(`${booking.date}T${booking.time}`);
    const durationMs = (booking.durationHours || 2) * 60 * 60 * 1000;
    const end = booking.end ? new Date(booking.end.replace(' ', 'T')) : new Date(start.getTime() + durationMs);
    return new Date() > end;
}

function normalizeSlot(s) {
    const id = String(s.slot_number ?? s.id ?? s.slot_id ?? '');
    const amenities = Array.isArray(s.amenities) ? s.amenities : [];
    const zoneName = s.zone || (id.startsWith('A') ? 'Zone A' : (id.startsWith('B') ? 'Zone B' : (id.startsWith('C') ? 'Zone C' : 'General')));
    const status = s.status ?? (s.available === false ? 'occupied' : 'available');
    return {
        id,
        slot_id: Number(s.slot_id),
        location: s.lot_name ?? s.location ?? 'Parking Lot',
        type: String(s.slot_type ?? s.type ?? 'car').toLowerCase(),
        rate: Number(s.price_per_hour ?? s.rate ?? 0),
        zone: zoneName,
        zone_id: s.zone_id,
        status,
        available: s.available === true || (s.available === undefined && status === 'available'),
        unavailableReason: s.unavailable_reason || '',
        isEv: Boolean(s.is_ev ?? s.isEv ?? amenities.some(a => String(a).toLowerCase().includes('ev'))),
        covered: Boolean(s.is_covered ?? s.covered ?? amenities.some(a => String(a).toLowerCase() === 'covered'))
    };
}

async function fetchSlots(q) {
    const params = new URLSearchParams({
        location: q.location,
        vehicle_type: q.type,
        booking_date: q.date,
        start_time: q.time,
        duration_hours: String(currentDurationHours),
        zone: activeZoneFilter
    });
    const res = await fetch(`${API.slots}?${params}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.slots)) {
        throw new Error(data.message || 'Could not retrieve slots from MySQL.');
    }
    return data.slots.map(normalizeSlot).map((slot) => {
        if (!isSlotBooked(slot, q.date, q.time, currentDurationHours)) return slot;
        return {
            ...slot,
            status: 'occupied',
            available: false,
            unavailableReason: 'This slot is booked'
        };
    });
}

function renderVisualMap(slots) {
    if (!els.visualBays) return;

    let filtered = slots;
    if (activeZoneFilter !== 'all') {
        filtered = filtered.filter(s =>
            s.zone.toLowerCase() === activeZoneFilter.toLowerCase() ||
            s.zone.toLowerCase().includes(activeZoneFilter.toLowerCase())
        );
    }

    if (!filtered.length) {
        els.visualBays.innerHTML = `
            <div class="empty-message" style="grid-column: 1 / -1; padding: 2.5rem; text-align: center;">
                <i class="fa-solid fa-circle-info fa-2x mb-2 text-amber"></i><br>
                No parking bays found in <strong>${esc(activeZoneFilter)}</strong> for the current selection.<br>
                <small class="text-muted">Select "All Zones" to view all available parking bays.</small>
            </div>
        `;
        return;
    }

    els.visualBays.innerHTML = filtered.map((s) => {
        const unavailable = !s.available;
        const isSelected = selectedSlot && selectedSlot.id === s.id && selectedSlot.location === s.location;
        const statusClass = isSelected ? 'selected' : (unavailable ? s.status : 'available');
        const vehicleIcon = s.type === 'bike' ? 'fa-motorcycle' : 'fa-car-side';

        return `
            <div class="map-bay-slot ${statusClass}" 
                 data-id="${esc(s.id)}" 
                 data-location="${esc(s.location)}"
                 title="${unavailable ? esc(s.unavailableReason || (s.status === 'closed' ? 'Lot is closed' : 'Slot is booked')) : 'Click to select ' + s.id}">
                <div class="map-bay-header">
                    <span class="map-bay-id">${esc(s.id)}</span>
                    ${s.isEv ? '<i class="fa-solid fa-bolt map-bay-ev-tag" title="EV Fast Charging"></i>' : ''}
                </div>
                <div class="map-bay-visual-vehicle">
                    <i class="fa-solid ${vehicleIcon}"></i>
                </div>
                <div class="map-bay-footer">
                    ${isSelected ? 'SELECTED' : (unavailable ? (s.status === 'closed' ? 'CLOSED' : 'BOOKED') : `${formatRupees(s.rate)}/h`)}
                </div>
            </div>
        `;
    }).join('');
}

function renderSlotCards(list) {
    let filtered = list;

    // Apply active zone filter to slot cards too
    if (activeZoneFilter !== 'all') {
        filtered = filtered.filter(s =>
            s.zone.toLowerCase() === activeZoneFilter.toLowerCase() ||
            s.zone.toLowerCase().includes(activeZoneFilter.toLowerCase())
        );
    }

    // Apply amenity filters
    if (activeAmenityFilter === 'ev') {
        filtered = filtered.filter(s => s.isEv);
    } else if (activeAmenityFilter === 'covered') {
        filtered = filtered.filter(s => s.covered);
    }

    const availableSlots = filtered.filter(s => s.available);

    els.count.textContent = `${availableSlots.length} ${availableSlots.length === 1 ? 'slot' : 'slots'} available`;
    els.count.classList.toggle('has-slots', availableSlots.length > 0);

    if (!availableSlots.length) {
        const zoneMsg = activeZoneFilter !== 'all' ? ` in ${esc(activeZoneFilter)}` : '';
        const emptyReason = filtered.length
            ? 'No slots are available for this time. Some spaces may be booked or their lot may be closed.'
            : 'No parking slots exist for this selection.';
        els.slots.innerHTML = `
            <div class="empty-message">
                <i class="fa-solid fa-ban fa-2x mb-2 text-muted"></i><br>
                ${emptyReason}${zoneMsg} Try switching zones, vehicle type, or time.
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
    const baseTotal = Math.round(rate * currentDurationHours * 100) / 100;
    const tax = Math.round(baseTotal * 0.05 * 100) / 100;
    const grandTotal = baseTotal + tax;

    $('calcBaseRate').textContent = formatRupees(rate);
    $('calcHours').textContent = currentDurationHours;
    $('calcBaseTotal').textContent = formatRupees(baseTotal);
    $('calcTax').textContent = formatRupees(tax);
    $('calcGrandTotal').textContent = formatRupees(grandTotal);
    $('btnPayAmount').textContent = formatRupees(grandTotal);
    $('modalPayableAmount').textContent = formatRupees(grandTotal);

    // Estimate End Time
    const startTimeStr = els.time.value || '10:00';
    const [h, m] = startTimeStr.split(':').map(Number);
    const endH = (h + currentDurationHours) % 24;
    const ampm = endH >= 12 ? 'PM' : 'AM';
    const displayH = endH % 12 || 12;
    $('calcEstimatedEnd').textContent = `Valid until ${pad(displayH)}:${pad(m)} ${ampm}`;
}

async function updateDatabaseStatus() {
    const badge = document.querySelector('.live-pulse-badge');
    if (!badge) return;
    badge.innerHTML = '<span class="pulse-dot"></span> CHECKING DATABASE';
    try {
        const response = await fetch('/api/health');
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error('Database unavailable');
        badge.innerHTML = '<span class="pulse-dot"></span> MYSQL CONNECTED';
        badge.style.color = '#34D399';
    } catch (_) {
        badge.innerHTML = '<span class="pulse-dot"></span> DATABASE OFFLINE';
        badge.style.color = '#FCA5A5';
    }
}

async function findParking() {
    const q = {
        location: els.location.value,
        type: els.vehicle.value,
        date: els.date.value,
        time: els.time.value
    };

    if (!q.date || !q.time) {
        showToast('Please select a date and start time first.');
        return;
    }

    playSelectSound();
    els.slots.innerHTML = `<div class="empty-message"><i class="fa-solid fa-circle-notch fa-spin fa-2x mb-2 text-amber"></i><br>Checking database availability...</div>`;
    try {
        allSlots = await fetchSlots(q);
        renderVisualMap(allSlots);
        renderSlotCards(allSlots);
        updateDashboardStats();
    } catch (err) {
        allSlots = [];
        renderVisualMap(allSlots);
        els.count.textContent = 'Availability unavailable';
        els.slots.innerHTML = `<div class="empty-message"><i class="fa-solid fa-triangle-exclamation fa-2x mb-2"></i><br>${esc(err.message || 'Database unavailable. Start MySQL and check DB settings.')}</div>`;
        showToast('Could not load live slots. Check the database connection.');
    }
}


/* ==========================================================
   Payment & Digital Pass Ticket Modal
   ========================================================== */

function openPaymentModal() {
    if (!selectedSlot) {
        showToast('Please select a parking slot first.');
        return;
    }

    const plateVal = (els.vehiclePlate.value || '').trim().toUpperCase();
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
    showToast('Demo UPI ID copied. No real payment is processed.');
    playSelectSound();
}

async function processPayment() {
    const btn = $('confirmPayBtn');
    if (btn.disabled) return;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authorizing...';
    btn.disabled = true;

    const plateVal = (els.vehiclePlate.value || '').trim().toUpperCase();
    const activeMethod = document.querySelector('.pay-tab-btn.active')?.dataset.method || 'upi';

    try {
        if (!selectedSlot || !selectedSlot.slot_id) throw new Error('Select a valid database slot first.');
        const payload = {
            slot_id: selectedSlot.slot_id,
            vehicle_number: plateVal,
            booking_date: els.date.value,
            start_time: els.time.value,
            duration_hours: currentDurationHours,
            payment_method: activeMethod
        };
        const res = await fetch(API.book, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!res.ok || !result.success) {
            throw new Error(result.message || 'Booking failed.');
        }

        const newBooking = normalizeBooking(result);
        bookings = bookings.filter((booking) => booking.id !== newBooking.id);
        bookings.push(newBooking);
        updateNavBadge();
        renderBookings();
        closePaymentModal();
        showDigitalTicket(newBooking);
        selectedSlot = null;
        els.configurator.style.display = 'none';

        if (typeof confetti === 'function') {
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        }
        playSuccessFanfare();
        showToast(`Booking #${newBooking.id} confirmed. Demo payment is pending.`);
        try {
            await refreshBookings();
        } catch (refreshError) {
            showToast(`Booking saved, but reservation history could not refresh: ${refreshError.message}`);
        }
        await updateDashboardStats();
        await findParking();
        renderBookings();
    } catch (e) {
        showToast(e.message || 'Booking failed. No booking was confirmed.');
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Confirm Demo Booking';
        btn.disabled = false;
    }
}


/* ==========================================================
   Digital Pass / QR Ticket
   ========================================================== */

function showDigitalTicket(booking) {
    activeTicketBooking = booking;
    $('ticketSlotPlate').textContent = booking.slotId;
    $('ticketLotName').textContent = booking.location;
    $('ticketSlotZone').textContent = booking.zone || 'Zone A';
    $('ticketPlateNum').textContent = booking.plate || 'Vehicle plate unavailable';
    $('ticketVehicleType').textContent = vehicleLabel(booking.type);
    $('ticketDate').textContent = formatDay(booking.date, booking.time);
    $('ticketTimeRange').textContent = `${booking.time} - ${booking.endTime || booking.end.slice(11, 16)}`;
    $('ticketBookingReference').textContent = booking.bookingReference || `PW-${booking.id}`;
    $('ticketAmount').textContent = formatRupees(booking.totalAmount);
    $('ticketPaymentStatus').textContent = `${booking.paymentStatus} (${booking.paymentMethod || 'demo'})`;
    $('ticketPassCode').textContent = booking.bookingReference || `PW-${booking.id}`;

    // Update status badge & cancel button based on booking state
    const tag = $('ticketStatusTag');
    const cancelBtn = $('ticketCancelBtn');
    if (booking.status === 'cancelled') {
        if (tag) {
            tag.textContent = 'CANCELLED';
            tag.style.background = '#EF4444';
            tag.style.color = '#FFFFFF';
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else if (isBookingFinished(booking)) {
        if (tag) {
            tag.textContent = 'COMPLETED';
            tag.style.background = '#64748B';
            tag.style.color = '#FFFFFF';
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
        if (tag) {
            tag.textContent = 'CONFIRMED';
            tag.style.background = '#10B981';
            tag.style.color = '#FFFFFF';
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }

    $('ticketModal').classList.add('show');
}

function closeTicketModal() {
    $('ticketModal').classList.remove('show');
}

function printOrDownloadTicket() {
    window.print();
}

function navigateToBookings() {
    if (activeTicketBooking && (activeTicketBooking.status === 'cancelled' || isBookingFinished(activeTicketBooking))) {
        activeBookingTab = 'all';
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'all');
        });
        renderBookings();
    }
    const el = document.getElementById('bookings');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}


/* ==========================================================
   Cancellation Logic
   ========================================================== */

async function cancelBooking(bookingId) {
    if (!confirm(`Are you sure you want to cancel booking #${bookingId}?`)) return;
    try {
        const res = await fetch(API.cancel, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: Number(bookingId) })
        });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || 'Cancellation failed.');

        showToast(result.message || 'Booking cancelled. No refund was processed.');
        try {
            await refreshBookings();
            await findParking();
            await updateDashboardStats();
        } catch (refreshError) {
            showToast(`Booking cancelled, but the dashboard could not refresh: ${refreshError.message}`);
        }

        // If digital pass is currently open for this booking, update it
        if (activeTicketBooking && String(activeTicketBooking.id) === String(bookingId)) {
            const updated = bookings.find(b => String(b.id) === String(bookingId));
            if (updated) {
                showDigitalTicket(updated);
            } else {
                closeTicketModal();
            }
        }

        playSelectSound();
    } catch (err) {
        showToast(err.message || 'Cancellation failed.');
    }
}

function cancelFromTicketModal() {
    if (activeTicketBooking) {
        cancelBooking(activeTicketBooking.id);
    }
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
        const isCancelled = b.status === 'cancelled';
        return `
        <article class="booking ${finished ? 'booking--done' : 'booking--active'}">
            <div class="booking-when">
                <strong>${esc(formatDay(b.date, b.time))}</strong>
                <span><i class="fa-solid fa-clock"></i> ${esc(formatTime(b.date, b.time))} – ${esc(formatTime(b.date, b.endTime))}</span>
            </div>

            <div class="booking-what">
                <span class="plate">${esc(b.slotId)}</span>
                <div>
                    <span class="booking-place">${esc(b.location)} • ${esc(b.zone)}</span>
                    <span class="booking-type">${vehicleLabel(b.type)} • ${esc(b.plate || 'Vehicle unavailable')}</span>
                </div>
            </div>
            <div class="booking-details">
                <span>Booking #${esc(b.id)}</span>
                <span>Amount: ${esc(formatRupees(b.totalAmount))}</span>
                <span>Payment: ${esc(b.paymentStatus)}</span>
                <span>Status: ${esc(b.status)}</span>
            </div>

            <!-- Real-time countdown / Status banner -->
            ${isCancelled ? `
                <div class="booking-live-timer" style="background:#FEF2F2; border-color:#FECACA;">
                    <div>
                        <span class="timer-lbl" style="color:#DC2626;">SESSION STATUS</span>
                        <strong class="timer-ticking" style="color:#B91C1C;">Cancelled (no refund processed)</strong>
                    </div>
                </div>
            ` : (finished ? `
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
                        <strong class="timer-ticking" data-timer-id="${esc(b.id)}" data-start="${esc(b.date)}T${esc(b.time)}" data-end="${esc(b.end)}" data-hours="${b.durationHours || 2}">
                            Calculating...
                        </strong>
                    </div>
                </div>
            `)}

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
        let end;
        if (el.dataset.end) {
            end = new Date(el.dataset.end.replace(' ', 'T'));
        } else {
            const start = new Date(el.dataset.start);
            const durationHours = parseFloat(el.dataset.hours || 2);
            end = new Date(start.getTime() + durationHours * 3600 * 1000);
        }
        const diffMs = end - now;

        if (diffMs <= 0) {
            el.textContent = 'Session Expired';
            el.style.color = '#EF4444';
        } else {
            const hrs = Math.floor(diffMs / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            el.textContent = `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
            el.style.color = '';
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
    const base = Math.round((rate / 60) * extraMins * 100) / 100;
    const extraAmount = base + Math.round(base * 0.05 * 100) / 100;
    $('extendExtraAmount').textContent = formatRupees(extraAmount);

    const [h, m] = (activeExtendingBooking.time || '10:00').split(':').map(Number);
    const totalMins = (activeExtendingBooking.durationHours || 2) * 60 + extraMins;
    const endH = Math.floor((h * 60 + m + totalMins) / 60) % 24;
    const endM = (m + totalMins) % 60;
    $('extendNewEndTime').textContent = `${pad(endH)}:${pad(endM)}`;
}

async function confirmExtendSession() {
    if (!activeExtendingBooking) return;
    const selectedBtn = document.querySelector('.extend-opt-btn.active');
    const extraMins = parseInt(selectedBtn?.dataset.extra || 30, 10);
    try {
        const res = await fetch(API.extend, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                booking_id: activeExtendingBooking.id,
                extra_minutes: extraMins
            })
        });
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.message || 'Extension failed.');
        await refreshBookings();
        closeExtendModal();
        playSuccessFanfare();
        showToast(`Parking session extended by ${extraMins} minutes.`);
        await findParking();
        await updateDashboardStats();
    } catch (err) {
        showToast(err.message || 'Extension failed.');
    }
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
            findParking();
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
                cancelBooking(cancelBtn.dataset.cancelId);
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
    updateDatabaseStatus();
    updateDashboardStats();

    // Initial load: all booking/availability data comes from the Flask/MySQL API.
    findParking();
    refreshBookings().catch(err => {
        showToast(err.message || 'Could not load booking history.');
    });
})();