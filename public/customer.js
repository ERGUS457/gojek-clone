// Customer Client Application Logic
let socket = null;
let map = null;
let driverMarkers = new Map();
let pickupMarker = null;
let dropoffMarker = null;
let activeDriverMarker = null;
let routePolyline = null;

let selectedService = 'goride';
let currentCustomer = null;
let activeOrder = null;
let assignedDriver = null;

let pollInterval = null;
const knownMessageIds = new Set();

// Initialize Map
function initMap() {
  const defaultCenter = [-0.0297, 109.3259]; // Pontianak real center
  map = L.map('customerMap', { zoomControl: false }).setView(defaultCenter, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  setTimeout(() => { if (map) map.invalidateSize(); }, 250);
  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });

  let clickToggle = false;
  map.on('click', async (e) => {
    if (activeOrder) return;
    const { lat, lng } = e.latlng;
    
    // Asynchronously resolve real street address from coordinates
    const realPlace = await fetchRealAddress(lat, lng);

    if (clickToggle) {
      const pEl = document.getElementById('pickupSelect');
      const opt = document.createElement('option');
      opt.value = `click_pickup_${Date.now()}`;
      opt.textContent = `📍 Jemput: ${realPlace.name}`;
      opt.dataset.loc = JSON.stringify(realPlace);
      opt.selected = true;
      pEl.appendChild(opt);

      // Recenter nearby fleet around clicked pickup
      try {
        await fetch('/api/fleet/recenter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: realPlace.lat, lng: realPlace.lng })
        });
        await loadDrivers();
      } catch (err) {}

      clickToggle = false;
    } else {
      const dEl = document.getElementById('dropoffSelect');
      const opt = document.createElement('option');
      opt.value = `click_dropoff_${Date.now()}`;
      opt.textContent = `🎯 Tujuan: ${realPlace.name}`;
      opt.dataset.loc = JSON.stringify(realPlace);
      opt.selected = true;
      dEl.appendChild(opt);
      clickToggle = true;
    }
    updateMapRoute();
  });
}

let searchDebounceTimer = null;

function toggleSearchInput(type) {
  const box = document.getElementById(`${type}SearchBox`);
  const select = document.getElementById(`${type}Select`);
  if (!box) return;
  if (box.classList.contains('hidden')) {
    box.classList.remove('hidden');
    select.classList.add('hidden');
    const input = document.getElementById(`${type}SearchInput`);
    if (input) {
      input.focus();
      if (input.value) debounceSearch(input.value, type);
    }
  } else {
    box.classList.add('hidden');
    select.classList.remove('hidden');
  }
}

function debounceSearch(value, type) {
  clearTimeout(searchDebounceTimer);
  const resultsEl = document.getElementById(`${type}SearchResults`);
  if (!resultsEl) return;

  if (!value || value.trim().length < 2) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = `<div class="p-2.5 text-gray-400 text-center font-medium">Mencari alamat asli via OpenStreetMap...</div>`;

  searchDebounceTimer = setTimeout(async () => {
    try {
      const places = await searchRealAddress(value);
      if (!places || places.length === 0) {
        resultsEl.innerHTML = `<div class="p-2.5 text-gray-400 text-center font-medium">Alamat tidak ditemukan</div>`;
        return;
      }
      resultsEl.innerHTML = places.map((p, idx) => `
        <div onclick='selectRealPlace(${JSON.stringify(p).replace(/'/g, "&#39;")}, "${type}")' class="p-2.5 hover:bg-green-50 cursor-pointer transition">
          <div class="font-bold text-gray-900">${p.name}</div>
          <div class="text-[10px] text-gray-500 truncate">${p.address}</div>
        </div>
      `).join('');
    } catch (e) {
      resultsEl.innerHTML = `<div class="p-2.5 text-red-500 text-center font-medium">Gagal mencari alamat</div>`;
    }
  }, 350);
}

async function selectRealPlace(place, type) {
  const selectEl = document.getElementById(`${type}Select`);
  const box = document.getElementById(`${type}SearchBox`);
  const resultsEl = document.getElementById(`${type}SearchResults`);
  
  if (box) box.classList.add('hidden');
  if (resultsEl) resultsEl.classList.add('hidden');
  if (selectEl) selectEl.classList.remove('hidden');

  const opt = document.createElement('option');
  opt.value = `real_${type}_${Date.now()}`;
  opt.textContent = `${type === 'pickup' ? '📍' : '🎯'} ${place.name}`;
  opt.dataset.loc = JSON.stringify(place);
  opt.selected = true;
  selectEl.appendChild(opt);

  if (type === 'pickup') {
    try {
      await fetch('/api/fleet/recenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: place.lat, lng: place.lng })
      });
      await loadDrivers();
    } catch (e) {
      console.warn('Fleet recenter error:', e);
    }
  }

  updateMapRoute();
}

async function useCurrentDeviceLocation() {
  const btnText = document.getElementById('gpsBtnText');
  if (!navigator.geolocation) {
    alert('Browser Anda tidak mendukung geolokasi GPS.');
    return;
  }

  if (btnText) btnText.textContent = '⏳ Mengambil GPS Asli...';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        if (btnText) btnText.textContent = '🔍 Mencari Nama Jalan...';
        const realPlace = await fetchRealAddress(latitude, longitude);
        
        const pickupEl = document.getElementById('pickupSelect');
        const opt = document.createElement('option');
        opt.value = `gps_pickup_${Date.now()}`;
        opt.textContent = `📍 Lokasi Saya: ${realPlace.name}`;
        opt.dataset.loc = JSON.stringify(realPlace);
        opt.selected = true;
        pickupEl.appendChild(opt);

        // Recenter fleet around user's real device location
        await fetch('/api/fleet/recenter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: latitude, lng: longitude })
        });
        await loadDrivers();

        map.setView([latitude, longitude], 15);
        updateMapRoute();

        if (btnText) btnText.textContent = `✅ ${realPlace.name.slice(0, 18)}...`;
      } catch (err) {
        console.error('Error handling GPS location:', err);
        if (btnText) btnText.textContent = '⚠️ Gagal Mendapat Alamat';
      }
    },
    (err) => {
      console.warn('Geolocation denied or failed:', err.message);
      alert('Izin lokasi GPS belum diaktifkan di browser. Silakan aktifkan izin lokasi di browser Anda.');
      if (btnText) btnText.textContent = '📍 Gunakan Lokasi GPS Asli Saya';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function populateLocations() {
  const pickupEl = document.getElementById('pickupSelect');
  const dropoffEl = document.getElementById('dropoffSelect');

  pickupEl.innerHTML = '';
  dropoffEl.innerHTML = '';

  JAKARTA_LOCATIONS.forEach((loc, idx) => {
    const opt1 = document.createElement('option');
    opt1.value = idx;
    opt1.textContent = `${loc.name}`;
    if (idx === 0) opt1.selected = true;
    pickupEl.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = idx;
    opt2.textContent = `${loc.name}`;
    if (idx === 1) opt2.selected = true;
    dropoffEl.appendChild(opt2);
  });
}

function getSelectedLocations() {
  const pEl = document.getElementById('pickupSelect');
  const dEl = document.getElementById('dropoffSelect');

  let pickup = null;
  let dropoff = null;

  const pSelected = pEl.options[pEl.selectedIndex];
  if (pSelected && pSelected.dataset.loc) {
    pickup = JSON.parse(pSelected.dataset.loc);
  } else {
    pickup = JAKARTA_LOCATIONS[pEl.value] || JAKARTA_LOCATIONS[0];
  }

  const dSelected = dEl.options[dEl.selectedIndex];
  if (dSelected && dSelected.dataset.loc) {
    dropoff = JSON.parse(dSelected.dataset.loc);
  } else {
    dropoff = JAKARTA_LOCATIONS[dEl.value] || JAKARTA_LOCATIONS[1];
  }

  return { pickup, dropoff };
}

function updateMapRoute() {
  const { pickup, dropoff } = getSelectedLocations();

  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (routePolyline && !activeOrder) map.removeLayer(routePolyline);

  pickupMarker = L.marker([pickup.lat, pickup.lng], {
    icon: createCustomMarkerIcon('pickup')
  }).addTo(map);

  dropoffMarker = L.marker([dropoff.lat, dropoff.lng], {
    icon: createCustomMarkerIcon('dropoff')
  }).addTo(map);

  const distKm = calcDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const steps = generateRouteSteps(pickup, dropoff, 20);
  const latlngs = steps.map(s => [s.lat, s.lng]);

  if (!activeOrder) {
    routePolyline = L.polyline(latlngs, {
      color: '#00AA13',
      weight: 5,
      opacity: 0.8,
      dashArray: '1, 8',
      lineCap: 'round'
    }).addTo(map);

    map.fitBounds(L.latLngBounds([
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng]
    ]), { padding: [50, 50] });
  }

  updatePricingDisplay(distKm);
}

function updatePricingDisplay(distKm) {
  const rideFare = distKm <= 2 ? 9000 : 9000 + Math.round((distKm - 2) * 2800);
  const rideRounded = Math.ceil(rideFare / 500) * 500;
  const rideMin = Math.max(5, Math.round(distKm * 3));

  const carFare = distKm <= 2 ? 16000 : 16000 + Math.round((distKm - 2) * 5500);
  const carRounded = Math.ceil(carFare / 500) * 500;
  const carMin = Math.max(8, Math.round(distKm * 4));

  document.getElementById('ridePrice').textContent = formatRupiah(rideRounded);
  document.getElementById('rideTime').textContent = rideMin;

  document.getElementById('carPrice').textContent = formatRupiah(carRounded);
  document.getElementById('carTime').textContent = carMin;
}

function onLocationChanged() {
  updateMapRoute();
}

function selectService(type) {
  selectedService = type;
  const rideCard = document.getElementById('serviceGoRide');
  const carCard = document.getElementById('serviceGoCar');
  const btnName = document.getElementById('btnServiceName');

  if (type === 'goride') {
    rideCard.className = 'cursor-pointer border-2 border-[#00AA13] bg-green-50/60 p-3 rounded-2xl flex flex-col justify-between transition-all';
    carCard.className = 'cursor-pointer border-2 border-transparent bg-gray-50 p-3 rounded-2xl flex flex-col justify-between hover:bg-gray-100 transition-all';
    btnName.textContent = 'GoRide';
  } else {
    carCard.className = 'cursor-pointer border-2 border-blue-600 bg-blue-50/60 p-3 rounded-2xl flex flex-col justify-between transition-all';
    rideCard.className = 'cursor-pointer border-2 border-transparent bg-gray-50 p-3 rounded-2xl flex flex-col justify-between hover:bg-gray-100 transition-all';
    btnName.textContent = 'GoCar';
  }
}

function recenterMap() {
  const { pickup } = getSelectedLocations();
  if (pickup) {
    map.setView([pickup.lat, pickup.lng], 15, { animate: true });
  }
}

async function loadCustomer() {
  try {
    const res = await fetch('/api/customer');
    currentCustomer = await res.json();
    document.getElementById('headerGopay').textContent = formatRupiah(currentCustomer.gopayBalance);
  } catch (err) {
    console.error('Failed to load customer:', err);
  }
}

async function loadDrivers() {
  try {
    const res = await fetch('/api/drivers');
    const drivers = await res.json();
    renderNearbyDrivers(drivers);
  } catch (err) {
    console.error('Failed to load drivers:', err);
  }
}

function renderNearbyDrivers(drivers) {
  let count = 0;
  drivers.forEach(d => {
    if (!d.isOnline || d.status === 'BUSY') {
      if (driverMarkers.has(d.id)) {
        map.removeLayer(driverMarkers.get(d.id));
        driverMarkers.delete(d.id);
      }
      return;
    }

    count++;
    if (driverMarkers.has(d.id)) {
      const marker = driverMarkers.get(d.id);
      marker.setLatLng([d.currentLocation.lat, d.currentLocation.lng]);
    } else {
      const marker = L.marker([d.currentLocation.lat, d.currentLocation.lng], {
        icon: createCustomMarkerIcon(d.vehicleType || 'goride', d.heading || 0)
      }).addTo(map);
      marker.bindPopup(`<b>${d.name}</b><br>${d.vehicleModel}<br>${d.plateNumber}`);
      driverMarkers.set(d.id, marker);
    }
  });

  document.getElementById('nearbyCount').textContent = count;
}

// Create Order (Book Ride)
async function createOrder() {
  const { pickup, dropoff } = getSelectedLocations();
  const distKm = calcDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  
  const fareStr = selectedService === 'goride' 
    ? document.getElementById('ridePrice').textContent 
    : document.getElementById('carPrice').textContent;
  const fare = parseInt(fareStr.replace(/[^0-9]/g, ''));

  if (currentCustomer && currentCustomer.gopayBalance < fare) {
    alert('Saldo GoPay Anda tidak mencukupi! Silakan klik "+ Isi" saldo terlebih dahulu.');
    return;
  }

  const payload = {
    customer: {
      id: currentCustomer ? currentCustomer.id : 'cust-demo',
      name: currentCustomer ? currentCustomer.name : 'Andi Pratama',
      phone: currentCustomer ? currentCustomer.phone : '0812-9900-1122'
    },
    serviceType: selectedService,
    pickup,
    dropoff,
    distanceKm: distKm,
    fare,
    paymentMethod: 'GOPAY'
  };

  document.getElementById('viewStepOrder').classList.add('hidden');
  document.getElementById('viewStepSearching').classList.remove('hidden');

  if (socket && socket.connected) {
    socket.emit('order:create', payload);
  } else {
    // HTTP Fallback (Vercel Serverless)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      activeOrder = await res.json();
      startPolling();
    } catch (e) {
      alert('Gagal memesan: ' + e.message);
      resetOrderUI();
    }
  }
}

async function cancelActiveOrder() {
  if (activeOrder) {
    if (socket && socket.connected) {
      socket.emit('order:cancel', { orderId: activeOrder.id, reason: 'Dibatalkan oleh pelanggan' });
    } else {
      await fetch(`/api/orders/${activeOrder.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Dibatalkan oleh pelanggan', cancelledBy: 'customer' })
      });
    }
  }
  resetOrderUI();
}

function resetOrderUI() {
  activeOrder = null;
  assignedDriver = null;
  stopPolling();

  document.getElementById('viewStepOrder').classList.remove('hidden');
  document.getElementById('viewStepSearching').classList.add('hidden');
  document.getElementById('viewStepMatched').classList.add('hidden');

  if (activeDriverMarker) {
    map.removeLayer(activeDriverMarker);
    activeDriverMarker = null;
  }
  updateMapRoute();
  loadDrivers();
}

// In-App Chat Functions
function openChatModal() {
  document.getElementById('chatModal').classList.remove('hidden');
  document.getElementById('chatBadge').classList.add('hidden');
  const chatBox = document.getElementById('chatMessages');
  chatBox.scrollTop = chatBox.scrollHeight;
}

function closeChatModal() {
  document.getElementById('chatModal').classList.add('hidden');
}

async function sendChat(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !activeOrder) return;

  if (socket && socket.connected) {
    socket.emit('chat:message', { orderId: activeOrder.id, sender: 'customer', text });
  } else {
    const res = await fetch(`/api/orders/${activeOrder.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'customer', text })
    });
    const msg = await res.json();
    appendChatMessage(msg);
  }
  input.value = '';
}

function sendQuickChat(text) {
  if (!activeOrder) return;
  if (socket && socket.connected) {
    socket.emit('chat:message', { orderId: activeOrder.id, sender: 'customer', text });
  } else {
    fetch(`/api/orders/${activeOrder.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'customer', text })
    }).then(res => res.json()).then(msg => appendChatMessage(msg));
  }
}

function appendChatMessage(msg) {
  if (knownMessageIds.has(msg.id)) return;
  knownMessageIds.add(msg.id);

  const container = document.getElementById('chatMessages');
  const isMe = msg.sender === 'customer';

  const row = document.createElement('div');
  row.className = `flex ${isMe ? 'justify-end' : 'justify-start'}`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[75%] px-3.5 py-2 rounded-2xl text-xs font-medium shadow-sm ${
    isMe
      ? 'bg-[#00AA13] text-white rounded-br-none'
      : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'
  }`;
  bubble.textContent = msg.text;

  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  if (!isMe && document.getElementById('chatModal').classList.contains('hidden')) {
    document.getElementById('chatBadge').classList.remove('hidden');
  }
}

async function topUpPrompt() {
  const amount = prompt('Masukkan nominal Top Up Saldo GoPay (Rp):', '100000');
  if (amount && Number(amount) > 0) {
    try {
      const res = await fetch('/api/customer/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount) })
      });
      const data = await res.json();
      currentCustomer = data;
      document.getElementById('headerGopay').textContent = formatRupiah(data.gopayBalance);
      AudioFX.playCashRegister();
      alert(`Top Up berhasil! Saldo GoPay Anda saat ini: ${formatRupiah(data.gopayBalance)}`);
    } catch (e) {
      alert('Gagal top up: ' + e.message);
    }
  }
}

let selectedTipAmount = 0;
let completedOrderId = null;

function selectTip(amount, btn) {
  selectedTipAmount = amount;
  document.querySelectorAll('.tip-btn').forEach(b => {
    b.classList.remove('border-[#00AA13]', 'text-[#00AA13]', 'bg-green-50');
  });
  btn.classList.add('border-[#00AA13]', 'text-[#00AA13]', 'bg-green-50');
  AudioFX.playCashRegister();
}

async function closeCompletedModal() {
  if (completedOrderId && selectedTipAmount > 0) {
    try {
      await fetch(`/api/orders/${completedOrderId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5, tip: selectedTipAmount })
      });
    } catch (e) {}
  }
  selectedTipAmount = 0;
  completedOrderId = null;
  document.getElementById('completedModal').classList.add('hidden');
  resetOrderUI();
  loadCustomer();
}

// Lifecycle Handlers
function onDriverMatched(order, driver) {
  activeOrder = order;
  assignedDriver = driver;

  AudioFX.playSuccess();

  document.getElementById('viewStepSearching').classList.add('hidden');
  document.getElementById('viewStepMatched').classList.remove('hidden');

  document.getElementById('driverName').textContent = driver.name;
  document.getElementById('chatDriverName').textContent = driver.name;
  document.getElementById('driverInitials').textContent = driver.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  document.getElementById('driverRating').textContent = driver.rating;
  document.getElementById('driverVehicle').textContent = driver.vehicleModel;
  document.getElementById('driverPlate').textContent = driver.plateNumber;
  document.getElementById('driverCallLink').href = `tel:${driver.phone}`;

  document.getElementById('summaryPickup').textContent = order.pickup.name;
  document.getElementById('summaryDropoff').textContent = order.dropoff.name;
  document.getElementById('summaryFare').textContent = `${formatRupiah(order.fare)} (${order.paymentMethod})`;
  document.getElementById('tripStatusText').textContent = 'Driver Menuju ke Lokasi Anda';

  if (driverMarkers.has(driver.id)) {
    map.removeLayer(driverMarkers.get(driver.id));
    driverMarkers.delete(driver.id);
  }

  if (activeDriverMarker) map.removeLayer(activeDriverMarker);
  activeDriverMarker = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], {
    icon: createCustomMarkerIcon(driver.vehicleType, driver.heading || 0)
  }).addTo(map);

  map.fitBounds(L.latLngBounds([
    [driver.currentLocation.lat, driver.currentLocation.lng],
    [order.pickup.lat, order.pickup.lng]
  ]), { padding: [40, 40] });
}

function onDriverArrived() {
  AudioFX.playDriverArrived();
  document.getElementById('tripStatusText').textContent = 'Driver Telah Tiba di Titik Jemput!';
  document.getElementById('tripEtaBadge').textContent = 'Sudah Tiba';
  document.getElementById('tripEtaBadge').className = 'text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full';
}

function onTripStarted() {
  document.getElementById('tripStatusText').textContent = 'Dalam Perjalanan Menuju Tujuan';
  document.getElementById('tripEtaBadge').textContent = 'Perjalanan';
}

function onTripCompleted() {
  completedOrderId = activeOrder ? activeOrder.id : null;
  const receiptBtn = document.getElementById('downloadReceiptBtn');
  if (receiptBtn && completedOrderId) {
    receiptBtn.href = `/api/orders/${completedOrderId}/receipt`;
  }
  AudioFX.playCashRegister();
  document.getElementById('completedModal').classList.remove('hidden');
}

// HTTP Polling Fallback (for Vercel Serverless)
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    if (!activeOrder) {
      loadDrivers();
      return;
    }

    try {
      const res = await fetch(`/api/orders/${activeOrder.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const o = data.order;
      const d = data.driver;
      if (!o) return;

      if (['ACCEPTED', 'ARRIVED', 'IN_TRIP', 'COMPLETED'].includes(o.status) && (!assignedDriver || activeOrder.status === 'SEARCHING' || activeOrder.status === 'OFFERED')) {
        onDriverMatched(o, d);
      }

      if (o.status === 'ARRIVED' && activeOrder.status !== 'ARRIVED') {
        onDriverArrived();
      } else if (o.status === 'IN_TRIP' && activeOrder.status !== 'IN_TRIP') {
        onTripStarted();
      } else if (o.status === 'COMPLETED' && activeOrder.status !== 'COMPLETED') {
        onTripCompleted();
      } else if (o.status === 'CANCELLED') {
        alert(`Pesanan dibatalkan: ${o.cancelReason || 'Pembatalan'}`);
        resetOrderUI();
      }

      activeOrder = o;
      if (d && activeDriverMarker) {
        activeDriverMarker.setLatLng([d.currentLocation.lat, d.currentLocation.lng]);
      }

      if (o.messages) {
        o.messages.forEach(m => appendChatMessage(m));
      }
    } catch (e) {}
  }, 1500);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Socket IO Setup
function initSocket() {
  try {
    socket = io({ timeout: 4000, reconnectionAttempts: 3 });

    socket.on('connect', () => {
      console.log('[Customer Socket] Connected:', socket.id);
      socket.emit('client:register', { role: 'customer', id: 'cust-demo' });
      stopPolling();
    });

    socket.on('connect_error', () => {
      console.log('[Socket] Fallback to HTTP polling mode');
      startPolling();
    });

    socket.on('order:created', (order) => { activeOrder = order; });
    socket.on('order:matched', ({ order, driver }) => onDriverMatched(order, driver));
    socket.on('order:driver_location', ({ location, heading }) => {
      if (activeDriverMarker) activeDriverMarker.setLatLng([location.lat, location.lng]);
    });
    socket.on('fleet:driver_location', (data) => {
      if (assignedDriver && data.driverId === assignedDriver.id) return;
      if (driverMarkers.has(data.driverId)) {
        const marker = driverMarkers.get(data.driverId);
        if (data.isOnline && data.status !== 'BUSY') {
          marker.setLatLng([data.location.lat, data.location.lng]);
        } else {
          map.removeLayer(marker);
          driverMarkers.delete(data.driverId);
        }
      } else if (data.isOnline && data.status !== 'BUSY') {
        const marker = L.marker([data.location.lat, data.location.lng], {
          icon: createCustomMarkerIcon(data.vehicleType)
        }).addTo(map);
        driverMarkers.set(data.driverId, marker);
      }
    });

    socket.on('order:driver_arrived', onDriverArrived);
    socket.on('order:trip_started', onTripStarted);
    socket.on('order:completed', onTripCompleted);
    socket.on('order:cancelled', ({ reason }) => {
      alert(`Pesanan dibatalkan: ${reason || 'Pembatalan'}`);
      resetOrderUI();
    });
    socket.on('order:no_driver', ({ message }) => {
      alert(message);
      resetOrderUI();
    });
    socket.on('chat:incoming', ({ message }) => appendChatMessage(message));
    socket.on('system:reset', () => {
      resetOrderUI();
      loadCustomer();
      loadDrivers();
    });
  } catch (err) {
    console.log('[Socket init failed, using HTTP polling]:', err.message);
    startPolling();
  }
}

async function initRealLocation() {
  try {
    const res = await fetch('/api/locations/detect-ip');
    let realLat = -0.0297;
    let realLng = 109.3259;
    let cityName = 'Pontianak';

    if (res.ok) {
      const data = await res.json();
      if (data.lat && data.lng) {
        realLat = data.lat;
        realLng = data.lng;
        cityName = data.city || 'Pontianak';
      }
    }

    map.setView([realLat, realLng], 14);
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);

    // Relocate fleet near user's real coordinate
    try {
      await fetch('/api/fleet/recenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: realLat, lng: realLng })
      });
      await loadDrivers();
    } catch (e) {}

    const pickupPlace = await fetchRealAddress(realLat, realLng);
    const localPlaces = await searchRealAddress(cityName);

    const validDests = (localPlaces && localPlaces.length > 1)
      ? localPlaces.filter(p => calcDistance(realLat, realLng, p.lat, p.lng) > 0.4)
      : [];

    let dropoffPlace = validDests.length > 0 ? validDests[0] : await fetchRealAddress(realLat - 0.022, realLng + 0.018);

    const pEl = document.getElementById('pickupSelect');
    const dEl = document.getElementById('dropoffSelect');

    pEl.innerHTML = '';
    dEl.innerHTML = '';

    const pOpt = document.createElement('option');
    pOpt.value = 'real_init_pickup';
    pOpt.textContent = `📍 ${pickupPlace.name}`;
    pOpt.dataset.loc = JSON.stringify(pickupPlace);
    pOpt.selected = true;
    pEl.appendChild(pOpt);

    const dOpt = document.createElement('option');
    dOpt.value = 'real_init_dropoff';
    dOpt.textContent = `🎯 ${dropoffPlace.name}`;
    dOpt.dataset.loc = JSON.stringify(dropoffPlace);
    dOpt.selected = true;
    dEl.appendChild(dOpt);

    if (localPlaces && localPlaces.length > 0) {
      localPlaces.forEach((lp, idx) => {
        const opt = document.createElement('option');
        opt.value = `loc_${idx}`;
        opt.textContent = `🎯 ${lp.name}`;
        opt.dataset.loc = JSON.stringify(lp);
        dEl.appendChild(opt);
      });
    }

    updateMapRoute();

    // Check high precision device GPS in background
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const gpsPlace = await fetchRealAddress(latitude, longitude);
        pOpt.textContent = `📍 Lokasi GPS Saya: ${gpsPlace.name}`;
        pOpt.dataset.loc = JSON.stringify(gpsPlace);
        pOpt.selected = true;
        map.setView([latitude, longitude], 15);
        await fetch('/api/fleet/recenter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: latitude, lng: longitude })
        });
        await loadDrivers();
        updateMapRoute();
        const gpsBtn = document.getElementById('gpsBtnText');
        if (gpsBtn) gpsBtn.textContent = `✅ GPS: ${gpsPlace.name.slice(0, 18)}...`;
      }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
    }
  } catch (err) {
    console.warn('Real location init error:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  populateLocations();
  updateMapRoute();
  loadCustomer();
  loadDrivers();
  initSocket();
  initRealLocation();
  setInterval(loadDrivers, 5000);
});
