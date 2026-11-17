// Admin & Dispatch Console Logic
let socket = null;
let map = null;
let driverMarkers = new Map();
let drivers = [];
let orders = [];

function initMap() {
  map = L.map('adminMap', {
    zoomControl: true
  }).setView([-6.2088, 106.8456], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19
  }).addTo(map);
}

function updateFleetMarkers() {
  drivers.forEach(d => {
    const lat = d.currentLocation.lat;
    const lng = d.currentLocation.lng;

    if (driverMarkers.has(d.id)) {
      const marker = driverMarkers.get(d.id);
      marker.setLatLng([lat, lng]);
      marker.setPopupContent(createDriverPopupContent(d));
    } else {
      const marker = L.marker([lat, lng], {
        icon: createCustomMarkerIcon(d.vehicleType || 'goride')
      }).addTo(map);

      marker.bindPopup(createDriverPopupContent(d));
      driverMarkers.set(d.id, marker);
    }
  });

  recalculateStats();
}

function createDriverPopupContent(d) {
  let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">Tersedia</span>';
  if (!d.isOnline) {
    statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-700">Offline</span>';
  } else if (d.status === 'BUSY') {
    statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Dalam Trip</span>';
  } else if (d.status === 'OFFERING') {
    statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-800">Menawarkan</span>';
  }

  return `
    <div class="text-xs p-1">
      <div class="flex items-center justify-between gap-2 mb-1">
        <strong class="font-bold text-sm">${d.name}</strong>
        ${statusBadge}
      </div>
      <p class="text-gray-600">${d.vehicleModel} (${d.plateNumber})</p>
      <div class="mt-2 pt-1 border-t border-gray-200 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span class="text-gray-400 block">Rating:</span>
          <strong>⭐ ${d.rating}</strong>
        </div>
        <div>
          <span class="text-gray-400 block">Trip Sukses:</span>
          <strong>${d.tripsCompleted || 0}</strong>
        </div>
      </div>
    </div>
  `;
}

function recalculateStats() {
  const onlineDrivers = drivers.filter(d => d.isOnline);
  document.getElementById('statOnlineDrivers').textContent = onlineDrivers.length;

  const gorideCount = onlineDrivers.filter(d => d.vehicleType === 'goride').length;
  const gocarCount = onlineDrivers.filter(d => d.vehicleType === 'gocar').length;
  document.getElementById('statFleetBreakdown').textContent = `${gorideCount} GoRide • ${gocarCount} GoCar`;

  const activeOrders = orders.filter(o => ['SEARCHING', 'OFFERED', 'ACCEPTED', 'ARRIVED', 'IN_TRIP'].includes(o.status));
  document.getElementById('statActiveOrders').textContent = activeOrders.length;

  const completedOrders = orders.filter(o => o.status === 'COMPLETED');
  document.getElementById('statCompletedTrips').textContent = completedOrders.length;

  const totalGmv = completedOrders.reduce((sum, o) => sum + (o.fare || 0), 0);
  document.getElementById('statGmv').textContent = formatRupiah(totalGmv);
}

function appendLog(iconClass, title, subtitle, colorClass = 'text-gray-700') {
  const container = document.getElementById('eventLogs');
  
  // Remove placeholder if present
  if (container.querySelector('.text-center')) {
    container.innerHTML = '';
  }

  const timeStr = new Date().toLocaleTimeString('id-ID');
  const card = document.createElement('div');
  card.className = 'p-3 bg-gray-50 border border-gray-200 rounded-xl shadow-xs';
  card.innerHTML = `
    <div class="flex items-start space-x-2.5">
      <div class="p-1.5 rounded-lg bg-white border border-gray-200 text-sm ${colorClass}">
        <i class="${iconClass}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-center">
          <strong class="font-bold text-gray-900 truncate">${title}</strong>
          <span class="text-[10px] text-gray-400">${timeStr}</span>
        </div>
        <p class="text-gray-600 text-[11px] mt-0.5 leading-relaxed">${subtitle}</p>
      </div>
    </div>
  `;

  container.insertBefore(card, container.firstChild);
}

async function resetDemoData() {
  if (confirm('Kembalikan semua driver dan pesanan ke kondisi awal?')) {
    try {
      const res = await fetch('/api/admin/reset', { method: 'POST' });
      const data = await res.json();
      appendLog('ph-bold ph-arrow-counter-clockwise', 'Sistem Direset', 'Semua data armada dan order telah dikembalikan ke kondisi default.', 'text-red-500');
    } catch (e) {
      alert('Gagal reset: ' + e.message);
    }
  }
}

async function fetchAdminData() {
  try {
    const [dRes, oRes] = await Promise.all([
      fetch('/api/drivers'),
      fetch('/api/orders')
    ]);
    drivers = await dRes.json();
    orders = await oRes.json();
    updateFleetMarkers();
  } catch (e) {}
}

function startAdminPolling() {
  setInterval(fetchAdminData, 3000);
}

function initSocket() {
  try {
    socket = io({ timeout: 4000, reconnectionAttempts: 3 });

    socket.on('connect', () => {
      console.log('[Admin Socket] Connected:', socket.id);
      socket.emit('client:register', { role: 'admin', id: 'admin-panel' });
    });

    socket.on('connect_error', () => {
      console.log('[Admin] Using polling fallback');
      fetchAdminData();
    });

    socket.on('admin:init_state', (data) => {
      drivers = data.drivers || [];
      orders = data.orders || [];
      updateFleetMarkers();
      appendLog('ph-bold ph-check', 'Admin Terhubung', `Memantau ${drivers.length} mitra driver aktif di Jakarta.`);
    });

    socket.on('fleet:driver_updated', (updatedDriver) => {
      const idx = drivers.findIndex(d => d.id === updatedDriver.id);
      if (idx !== -1) {
        drivers[idx] = updatedDriver;
      } else {
        drivers.push(updatedDriver);
      }
      updateFleetMarkers();
    });

    socket.on('fleet:driver_location', (loc) => {
      const d = drivers.find(x => x.id === loc.driverId);
      if (d) {
        d.currentLocation = loc.location;
        d.isOnline = loc.isOnline;
        d.status = loc.status;
        if (driverMarkers.has(d.id)) {
          driverMarkers.get(d.id).setLatLng([loc.location.lat, loc.location.lng]);
        }
      }
    });

    socket.on('fleet:reset', (data) => {
      drivers = data.drivers;
      orders = data.orders;
      updateFleetMarkers();
    });

    socket.on('order:new', (order) => {
      orders.unshift(order);
      recalculateStats();
      appendLog(
        'ph-bold ph-plus-circle',
        `Pesanan Baru (${order.serviceType.toUpperCase()})`,
        `${order.customer.name} memesan dari ${order.pickup.name} menuju ${order.dropoff.name} • ${formatRupiah(order.fare)}`,
        'text-[#00AA13]'
      );
    });

    socket.on('order:updated', (updatedOrder) => {
      const idx = orders.findIndex(o => o.id === updatedOrder.id);
      if (idx !== -1) {
        orders[idx] = updatedOrder;
      } else {
        orders.unshift(updatedOrder);
      }
      recalculateStats();

      let title = 'Order Update';
      let sub = `Status order #${updatedOrder.id} berubah ke ${updatedOrder.status}`;
      let icon = 'ph-bold ph-info';
      let color = 'text-blue-500';

      if (updatedOrder.status === 'OFFERED') {
        title = 'Penawaran Dispatch Terkirim';
        sub = `Algoritma menawarkan pesanan #${updatedOrder.id} ke driver terdekat.`;
        icon = 'ph-bold ph-paper-plane-tilt';
        color = 'text-yellow-600';
      } else if (updatedOrder.status === 'ACCEPTED') {
        title = 'Pesanan Diterima Driver';
        sub = `Driver telah menerima pesanan #${updatedOrder.id} dan bersiap menjemput.`;
        icon = 'ph-bold ph-check-fat';
        color = 'text-[#00AA13]';
      } else if (updatedOrder.status === 'ARRIVED') {
        title = 'Driver Tiba di Titik Jemput';
        sub = `Driver telah sampai di ${updatedOrder.pickup.name}.`;
        icon = 'ph-bold ph-map-pin';
        color = 'text-blue-600';
      } else if (updatedOrder.status === 'IN_TRIP') {
        title = 'Perjalanan Sedang Berlangsung';
        sub = `Penumpang dijemput, menuju ${updatedOrder.dropoff.name}.`;
        icon = 'ph-bold ph-navigation-arrow';
        color = 'text-indigo-600';
      } else if (updatedOrder.status === 'COMPLETED') {
        title = 'Trip Selesai & Pembayaran Sukses';
        sub = `Pesanan #${updatedOrder.id} selesai. Nilai: ${formatRupiah(updatedOrder.fare)}.`;
        icon = 'ph-bold ph-currency-circle-dollar';
        color = 'text-emerald-600';
      } else if (updatedOrder.status === 'CANCELLED') {
        title = 'Pesanan Dibatalkan';
        sub = `Pesanan #${updatedOrder.id} dibatalkan: ${updatedOrder.cancelReason || '-'}`;
        icon = 'ph-bold ph-x-circle';
        color = 'text-red-500';
      }

      appendLog(icon, title, sub, color);
    });
  } catch (e) {
    console.log('[Socket init err]:', e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchAdminData();
  initSocket();
  startAdminPolling();
});
