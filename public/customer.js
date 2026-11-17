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
  const defaultCenter = [-6.1954, 106.8218]; // Grand Indonesia
  map = L.map('customerMap', { zoomControl: false }).setView(defaultCenter, 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
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
  const pIdx = document.getElementById('pickupSelect').value;
  const dIdx = document.getElementById('dropoffSelect').value;
  return {
    pickup: JAKARTA_LOCATIONS[pIdx] || JAKARTA_LOCATIONS[0],
    dropoff: JAKARTA_LOCATIONS[dIdx] || JAKARTA_LOCATIONS[1]
  };
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

function selectTip(amount, btn) {
  document.querySelectorAll('.tip-btn').forEach(b => {
    b.classList.remove('border-[#00AA13]', 'text-[#00AA13]', 'bg-green-50');
  });
  btn.classList.add('border-[#00AA13]', 'text-[#00AA13]', 'bg-green-50');
  AudioFX.playCashRegister();
}

function closeCompletedModal() {
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

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  populateLocations();
  updateMapRoute();
  loadCustomer();
  loadDrivers();
  initSocket();
  setInterval(loadDrivers, 5000);
});
