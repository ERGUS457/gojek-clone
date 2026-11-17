// Driver App Logic (GoPartner)
let socket = null;
let map = null;
let currentDriver = null;
let driverList = [];
let myMarker = null;
let pickupMarker = null;
let dropoffMarker = null;
let activePolyline = null;

let currentOffer = null;
let offerTimer = null;
let offerSecondsLeft = 15;

let activeOrder = null;
let simInterval = null;
let simSteps = [];
let simCurrentStep = 0;
let simSpeedMultiplier = 2;

let driverPollInterval = null;
const knownDriverMsgIds = new Set();

function initMap() {
  const defaultCenter = [-6.1754, 106.8272];
  map = L.map('driverMap', { zoomControl: false }).setView(defaultCenter, 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
}

async function loadDriverAccounts() {
  try {
    const res = await fetch('/api/drivers');
    driverList = await res.json();
    
    const select = document.getElementById('driverSelect');
    select.innerHTML = '';
    driverList.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.vehicleType === 'goride' ? 'Motor' : 'Mobil'})`;
      if (idx === 0) opt.selected = true;
      select.appendChild(opt);
    });

    if (driverList.length > 0) {
      setDriverProfile(driverList[0]);
    }
  } catch (e) {
    console.error('Failed to load drivers:', e);
  }
}

function setDriverProfile(driver) {
  currentDriver = driver;
  document.getElementById('driverInitials').textContent = driver.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  document.getElementById('driverRating').textContent = driver.rating;
  document.getElementById('driverVehicleModel').textContent = driver.vehicleModel;
  document.getElementById('statEarnings').textContent = formatRupiah(driver.earningsToday);
  document.getElementById('statWallet').textContent = formatRupiah(driver.walletBalance);

  const toggle = document.getElementById('toggleOnline');
  toggle.checked = driver.isOnline;
  updateOnlineUI(driver.isOnline);

  updateDriverMapPosition(driver.currentLocation.lat, driver.currentLocation.lng);
}

function updateDriverMapPosition(lat, lng) {
  if (myMarker) {
    myMarker.setLatLng([lat, lng]);
  } else {
    myMarker = L.marker([lat, lng], {
      icon: createCustomMarkerIcon(currentDriver ? currentDriver.vehicleType : 'goride')
    }).addTo(map);
  }
  map.setView([lat, lng], 15);
}

function switchDriverAccount(driverId) {
  stopAutoDrive();
  const d = driverList.find(x => x.id === driverId);
  if (!d) return;

  if (socket && socket.connected) {
    socket.emit('client:register', { role: 'driver', id: d.id });
  }
  setDriverProfile(d);
}

async function toggleOnlineStatus(isOnline) {
  if (!currentDriver) return;
  currentDriver.isOnline = isOnline;
  updateOnlineUI(isOnline);

  if (socket && socket.connected) {
    socket.emit('driver:toggle_online', {
      driverId: currentDriver.id,
      isOnline
    });
  } else {
    await fetch(`/api/drivers/${currentDriver.id}/toggle_online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOnline })
    });
  }
}

function updateOnlineUI(isOnline) {
  const lbl = document.getElementById('onlineLabel');
  if (isOnline) {
    lbl.textContent = 'ONLINE';
    lbl.className = 'text-[10px] font-black text-[#00AA13] mt-1 tracking-wider uppercase';
  } else {
    lbl.textContent = 'OFFLINE';
    lbl.className = 'text-[10px] font-black text-gray-500 mt-1 tracking-wider uppercase';
  }
}

// Order Offer Handling
function handleIncomingOffer(order, timeoutSeconds = 15) {
  currentOffer = order;
  offerSecondsLeft = timeoutSeconds;

  AudioFX.playOrderPing();

  const modal = document.getElementById('incomingOrderModal');
  modal.classList.remove('hidden');

  document.getElementById('offerServiceBadge').textContent = order.serviceType.toUpperCase();
  document.getElementById('offerFare').textContent = formatRupiah(order.fare);
  document.getElementById('offerPickup').textContent = order.pickup.name;
  document.getElementById('offerDropoff').textContent = order.dropoff.name;
  document.getElementById('offerDistance').textContent = `${order.distanceKm} km`;

  const bar = document.getElementById('countdownBar');
  bar.style.width = '100%';

  if (offerTimer) clearInterval(offerTimer);
  offerTimer = setInterval(() => {
    offerSecondsLeft--;
    document.getElementById('offerCountdownSec').textContent = `${offerSecondsLeft}s`;
    const pct = Math.max(0, (offerSecondsLeft / timeoutSeconds) * 100);
    bar.style.width = `${pct}%`;

    if (offerSecondsLeft <= 0) {
      clearInterval(offerTimer);
      rejectOrderOffer();
    }
  }, 1000);
}

async function acceptOrderOffer() {
  if (!currentOffer || !currentDriver) return;
  if (offerTimer) clearInterval(offerTimer);
  document.getElementById('incomingOrderModal').classList.add('hidden');

  if (socket && socket.connected) {
    socket.emit('order:accept', {
      orderId: currentOffer.id,
      driverId: currentDriver.id
    });
  } else {
    try {
      const res = await fetch(`/api/orders/${currentOffer.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: currentDriver.id })
      });
      const data = await res.json();
      setupActiveTripUI(data.order);
    } catch (e) {
      alert('Gagal menerima pesanan: ' + e.message);
    }
  }
}

async function rejectOrderOffer() {
  if (offerTimer) clearInterval(offerTimer);
  document.getElementById('incomingOrderModal').classList.add('hidden');

  if (currentOffer && currentDriver) {
    if (socket && socket.connected) {
      socket.emit('order:reject', {
        orderId: currentOffer.id,
        driverId: currentDriver.id
      });
    } else {
      await fetch(`/api/orders/${currentOffer.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: currentDriver.id })
      });
    }
  }
  currentOffer = null;
}

// Active Trip Setup
function setupActiveTripUI(order) {
  activeOrder = order;

  AudioFX.playSuccess();

  document.getElementById('stateIdle').classList.add('hidden');
  document.getElementById('stateActiveOrder').classList.remove('hidden');
  document.getElementById('simControlPanel').classList.remove('hidden');

  document.getElementById('custName').textContent = order.customer.name;
  document.getElementById('chatCustName').textContent = order.customer.name;
  document.getElementById('custInitial').textContent = order.customer.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  document.getElementById('orderServiceType').textContent = `${order.serviceType.toUpperCase()} • ${order.paymentMethod}`;
  document.getElementById('custPhoneLink').href = `tel:${order.customer.phone}`;

  document.getElementById('tripPickupName').textContent = order.pickup.name;
  document.getElementById('tripDropoffName').textContent = order.dropoff.name;
  document.getElementById('tripFareText').textContent = formatRupiah(order.fare);

  document.getElementById('actionStep1').classList.remove('hidden');
  document.getElementById('actionStep2').classList.add('hidden');
  document.getElementById('actionStep3').classList.add('hidden');

  drawTripRoute(currentDriver.currentLocation, order.pickup);
}

function drawTripRoute(from, to) {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (activePolyline) map.removeLayer(activePolyline);

  pickupMarker = L.marker([from.lat, from.lng], {
    icon: createCustomMarkerIcon('pickup')
  }).addTo(map);

  dropoffMarker = L.marker([to.lat, to.lng], {
    icon: createCustomMarkerIcon('dropoff')
  }).addTo(map);

  simSteps = generateRouteSteps(from, to, 30);
  simCurrentStep = 0;

  const latlngs = simSteps.map(s => [s.lat, s.lng]);
  activePolyline = L.polyline(latlngs, {
    color: '#00AA13',
    weight: 5,
    opacity: 0.85
  }).addTo(map);

  map.fitBounds(L.latLngBounds([[from.lat, from.lng], [to.lat, to.lng]]), { padding: [50, 50] });
}

// Order Lifecycle Actions
async function markDriverArrived() {
  stopAutoDrive();
  AudioFX.playDriverArrived();

  if (socket && socket.connected) {
    socket.emit('order:update_status', { orderId: activeOrder.id, status: 'ARRIVED' });
  } else {
    await fetch(`/api/orders/${activeOrder.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ARRIVED' })
    });
  }

  document.getElementById('actionStep1').classList.add('hidden');
  document.getElementById('actionStep2').classList.remove('hidden');

  drawTripRoute(activeOrder.pickup, activeOrder.dropoff);
}

async function startTripWithCustomer() {
  if (socket && socket.connected) {
    socket.emit('order:update_status', { orderId: activeOrder.id, status: 'IN_TRIP' });
  } else {
    await fetch(`/api/orders/${activeOrder.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'IN_TRIP' })
    });
  }

  document.getElementById('actionStep2').classList.add('hidden');
  document.getElementById('actionStep3').classList.remove('hidden');

  toggleAutoDrive();
}

async function completeActiveTrip() {
  stopAutoDrive();
  AudioFX.playCashRegister();

  if (socket && socket.connected) {
    socket.emit('order:update_status', { orderId: activeOrder.id, status: 'COMPLETED' });
  } else {
    await fetch(`/api/orders/${activeOrder.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' })
    });
  }

  alert(`Pesanan selesai! Saldo ${formatRupiah(activeOrder.fare)} telah ditambahkan ke dompet Anda.`);

  resetDriverTripUI();
  refreshDriverDetails();
}

function resetDriverTripUI() {
  activeOrder = null;
  stopAutoDrive();

  document.getElementById('stateIdle').classList.remove('hidden');
  document.getElementById('stateActiveOrder').classList.add('hidden');
  document.getElementById('simControlPanel').classList.add('hidden');

  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (activePolyline) map.removeLayer(activePolyline);
}

async function refreshDriverDetails() {
  if (!currentDriver) return;
  try {
    const res = await fetch(`/api/drivers/${currentDriver.id}`);
    const updated = await res.json();
    setDriverProfile(updated);
  } catch (e) {
    console.error('Refresh driver error:', e);
  }
}

// GPS Simulation Auto-Drive Engine
function setSimSpeed(speed) {
  simSpeedMultiplier = speed;
  ['1', '2', '5'].forEach(s => {
    const btn = document.getElementById(`speedBtn${s}`);
    if (s == speed) {
      btn.className = 'sim-speed-btn px-2 py-0.5 rounded text-[10px] font-bold bg-green-600 text-white';
    } else {
      btn.className = 'sim-speed-btn px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-300';
    }
  });

  if (simInterval) {
    stopAutoDrive();
    startAutoDrive();
  }
}

function toggleAutoDrive() {
  if (simInterval) {
    stopAutoDrive();
  } else {
    startAutoDrive();
  }
}

function startAutoDrive() {
  if (simSteps.length === 0) return;
  document.getElementById('autoDriveLabel').textContent = 'Jeda Simulasi Kendaraan';

  const intervalMs = Math.max(100, Math.round(800 / simSpeedMultiplier));

  simInterval = setInterval(async () => {
    if (simCurrentStep >= simSteps.length) {
      stopAutoDrive();
      return;
    }

    const pos = simSteps[simCurrentStep];
    currentDriver.currentLocation = pos;
    updateDriverMapPosition(pos.lat, pos.lng);

    if (socket && socket.connected) {
      socket.emit('driver:update_location', {
        driverId: currentDriver.id,
        lat: pos.lat,
        lng: pos.lng
      });
    } else {
      fetch(`/api/drivers/${currentDriver.id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng })
      }).catch(() => {});
    }

    simCurrentStep++;
  }, intervalMs);
}

function stopAutoDrive() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  document.getElementById('autoDriveLabel').textContent = 'Mulai Jalankan Kendaraan Otomatis';
}

// In-App Chat Functions
function openChatModal() {
  document.getElementById('driverChatModal').classList.remove('hidden');
  document.getElementById('driverChatBadge').classList.add('hidden');
  const chatBox = document.getElementById('driverChatMessages');
  chatBox.scrollTop = chatBox.scrollHeight;
}

function closeChatModal() {
  document.getElementById('driverChatModal').classList.add('hidden');
}

async function sendDriverChat(e) {
  e.preventDefault();
  const input = document.getElementById('driverChatInput');
  const text = input.value.trim();
  if (!text || !activeOrder) return;

  if (socket && socket.connected) {
    socket.emit('chat:message', { orderId: activeOrder.id, sender: 'driver', text });
  } else {
    const res = await fetch(`/api/orders/${activeOrder.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'driver', text })
    });
    const msg = await res.json();
    appendDriverChatMessage(msg);
  }
  input.value = '';
}

function sendDriverQuickChat(text) {
  if (!activeOrder) return;
  if (socket && socket.connected) {
    socket.emit('chat:message', { orderId: activeOrder.id, sender: 'driver', text });
  } else {
    fetch(`/api/orders/${activeOrder.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'driver', text })
    }).then(res => res.json()).then(msg => appendDriverChatMessage(msg));
  }
}

function appendDriverChatMessage(msg) {
  if (knownDriverMsgIds.has(msg.id)) return;
  knownDriverMsgIds.add(msg.id);

  const container = document.getElementById('driverChatMessages');
  const isMe = msg.sender === 'driver';

  const row = document.createElement('div');
  row.className = `flex ${isMe ? 'justify-end' : 'justify-start'}`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[75%] px-3.5 py-2 rounded-2xl text-xs font-medium shadow-sm ${
    isMe
      ? 'bg-[#00AA13] text-white rounded-br-none'
      : 'bg-gray-800 text-gray-100 rounded-bl-none border border-gray-700'
  }`;
  bubble.textContent = msg.text;

  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;

  if (!isMe && document.getElementById('driverChatModal').classList.contains('hidden')) {
    document.getElementById('driverChatBadge').classList.remove('hidden');
  }
}

// HTTP Polling Fallback (for Vercel Serverless)
function startDriverPolling() {
  if (driverPollInterval) return;
  driverPollInterval = setInterval(async () => {
    if (!currentDriver) return;
    try {
      if (!activeOrder && !currentOffer) {
        const res = await fetch('/api/orders');
        const orders = await res.json();
        const offer = orders.find(o =>
          o.status === 'OFFERED' &&
          o.offeredDriverIds &&
          o.offeredDriverIds.includes(currentDriver.id)
        );
        if (offer) {
          handleIncomingOffer(offer, 15);
        }
      } else if (activeOrder) {
        const res = await fetch(`/api/orders/${activeOrder.id}`);
        const data = await res.json();
        if (data.order && data.order.status === 'CANCELLED') {
          alert('Pelanggan telah membatalkan pesanan.');
          resetDriverTripUI();
        }
        if (data.order && data.order.messages) {
          data.order.messages.forEach(m => appendDriverChatMessage(m));
        }
      }
    } catch (e) {}
  }, 1500);
}

// Socket IO Handler
function initSocket() {
  try {
    socket = io({ timeout: 4000, reconnectionAttempts: 3 });

    socket.on('connect', () => {
      console.log('[Driver Socket] Connected:', socket.id);
      if (currentDriver) {
        socket.emit('client:register', { role: 'driver', id: currentDriver.id });
      }
    });

    socket.on('connect_error', () => {
      console.log('[Driver Socket] Fallback to HTTP polling mode');
      startDriverPolling();
    });

    socket.on('order:incoming_offer', ({ order, timeoutSeconds }) => {
      handleIncomingOffer(order, timeoutSeconds);
    });

    socket.on('order:assigned', ({ order, driver }) => {
      setupActiveTripUI(order);
    });

    socket.on('order:cancelled_by_customer', () => {
      alert('Pelanggan telah membatalkan pesanan.');
      resetDriverTripUI();
    });

    socket.on('chat:incoming', ({ message }) => {
      appendDriverChatMessage(message);
    });

    socket.on('system:reset', () => {
      resetDriverTripUI();
      loadDriverAccounts();
    });
  } catch (err) {
    console.log('[Socket init failed, using polling]:', err.message);
    startDriverPolling();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadDriverAccounts().then(() => {
    initSocket();
    startDriverPolling();
  });
});
