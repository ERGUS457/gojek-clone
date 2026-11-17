const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const store = require('../store');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize DB schema asynchronously
db.initDb().catch(e => console.warn('Neon DB init warning:', e.message));

// Health / Status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const drivers = await store.getDrivers();
    const orders = await store.getOrders();
    res.json({
      online: true,
      database: db.isNeonConnected() ? 'Neon PostgreSQL' : 'Local Persistence',
      totalDrivers: drivers.length,
      activeDrivers: drivers.filter(d => d.isOnline).length,
      totalOrders: orders.length,
      activeOrders: orders.filter(o => ['SEARCHING', 'OFFERED', 'ACCEPTED', 'ARRIVED', 'IN_TRIP'].includes(o.status)).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pricing calculation
app.post('/api/pricing/calculate', (req, res) => {
  const { serviceType, distanceKm } = req.body;
  const dist = Number(distanceKm) || 2;
  const fare = store.calculateFare(serviceType || 'goride', dist);
  res.json({
    serviceType: serviceType || 'goride',
    distanceKm: dist,
    fare,
    currency: 'IDR'
  });
});

// Real Location Geocoding via OpenStreetMap Nominatim
app.get('/api/locations/search', async (req, res) => {
  const query = req.query.q;
  if (!query || query.trim().length < 2) {
    return res.json([]);
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=id&limit=8&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'GojekCloneApp/1.0 (contact: support@gojek-clone.local)' }
    });
    const data = await response.json();
    const formatted = data.map(item => ({
      name: item.name || item.display_name.split(',')[0],
      address: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Geocoding search failed: ' + err.message });
  }
});

app.get('/api/locations/reverse', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'GojekCloneApp/1.0 (contact: support@gojek-clone.local)' }
    });
    const data = await response.json();
    res.json({
      name: data.name || (data.address ? (data.address.road || data.address.suburb || data.address.city || data.display_name.split(',')[0]) : 'Lokasi Terpilih'),
      address: data.display_name || `${lat}, ${lng}`,
      lat: parseFloat(lat),
      lng: parseFloat(lng)
    });
  } catch (err) {
    res.status(500).json({ error: 'Reverse geocoding failed: ' + err.message });
  }
});

app.post('/api/fleet/recenter', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng are required' });
    const updatedDrivers = await store.recenterFleet(lat, lng);
    res.json({ success: true, drivers: updatedDrivers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Drivers endpoints
app.get('/api/drivers', async (req, res) => {
  try {
    const { isOnline, status, vehicleType } = req.query;
    const filter = {};
    if (isOnline !== undefined) filter.isOnline = isOnline === 'true';
    if (status) filter.status = status;
    if (vehicleType) filter.vehicleType = vehicleType;

    const drivers = await store.getDrivers(filter);
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drivers/:id', async (req, res) => {
  try {
    const driver = await store.getDriverById(req.params.id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drivers/:id/location', async (req, res) => {
  try {
    const { lat, lng, heading } = req.body;
    const driver = await store.updateDriver(req.params.id, {
      currentLocation: { lat: Number(lat), lng: Number(lng) },
      heading: heading || 0
    });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drivers/:id/toggle_online', async (req, res) => {
  try {
    const { isOnline } = req.body;
    const driver = await store.updateDriver(req.params.id, {
      isOnline: Boolean(isOnline),
      status: isOnline ? 'IDLE' : 'OFFLINE'
    });
    res.json(driver);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Orders endpoints
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await store.getOrders();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Official Digital E-Receipt (Printable & Save as PDF)
app.get('/api/orders/:id/receipt', async (req, res) => {
  try {
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).send('<h2>Pesanan tidak ditemukan / Order not found</h2>');

    let driver = null;
    if (order.assignedDriverId) {
      driver = await store.getDriverById(order.assignedDriverId);
    }

    const orderDate = new Date(order.createdAt || Date.now()).toLocaleString('id-ID', {
      dateStyle: 'full',
      timeStyle: 'medium',
      timeZone: 'Asia/Jakarta'
    });

    const baseFare = Math.round(order.fare * 0.4);
    const distanceFare = Math.round(order.fare * 0.55);
    const serviceFee = order.fare - baseFare - distanceFare;

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Bukti Pembayaran Perjalanan - ${order.id}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print {
      body { background: white !important; padding: 0 !important; }
      .no-print { display: none !important; }
      .receipt-card { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen py-8 px-4 flex flex-col items-center justify-center font-sans antialiased text-gray-800">
  
  <div class="no-print mb-4 flex space-x-3">
    <button onclick="window.print()" class="bg-[#00AA13] hover:bg-[#008f10] text-white px-5 py-2.5 rounded-full font-bold shadow-md flex items-center space-x-2 transition">
      <svg class="w-5 h-5 fill-current" viewBox="0 0 256 256"><path d="M200,80V48a16,16,0,0,0-16-16H72A16,16,0,0,0,56,48V80H40A24,24,0,0,0,16,104v80a24,24,0,0,0,24,24H56v16a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V208h16a24,24,0,0,0,24-24V104A24,24,0,0,0,216,80ZM72,48H184V80H72ZM184,224H72V168H184Zm32-40H200V160a8,8,0,0,0-8-8H64a8,8,0,0,0-8,8v24H40a8,8,0,0,1-8-8V104a8,8,0,0,1,8-8H216a8,8,0,0,1,8,8v80A8,8,0,0,1,216,184Z"></path></svg>
      <span>Cetak / Simpan PDF</span>
    </button>
    <button onclick="window.close()" class="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-full font-bold shadow-sm hover:bg-gray-50 transition">
      Tutup
    </button>
  </div>

  <div class="receipt-card max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
    <!-- Header banner -->
    <div class="bg-[#00AA13] p-6 text-white text-center relative">
      <div class="w-12 h-12 rounded-full bg-white mx-auto flex items-center justify-center mb-2 shadow-inner">
        <div class="w-6 h-6 rounded-full bg-[#00AA13] flex items-center justify-center">
          <div class="w-2.5 h-2.5 rounded-full bg-white"></div>
        </div>
      </div>
      <h1 class="text-2xl font-black tracking-tight">gojek</h1>
      <p class="text-xs font-semibold text-green-100 uppercase tracking-widest mt-1">E-Receipt Resmi Perjalanan</p>
    </div>

    <div class="p-6 space-y-5">
      <!-- Status Badge -->
      <div class="flex justify-between items-center border-b border-gray-100 pb-4">
        <div>
          <span class="text-[11px] font-bold text-gray-400 block uppercase">No. Pesanan</span>
          <span class="font-mono font-bold text-sm text-gray-800">${order.id}</span>
        </div>
        <div class="text-right">
          <span class="inline-block px-3 py-1 bg-green-100 text-[#00AA13] rounded-full text-xs font-black uppercase tracking-wider">
            ${order.status === 'COMPLETED' ? 'LUNAS / SELESAI' : order.status}
          </span>
        </div>
      </div>

      <!-- Detail Layanan & Tanggal -->
      <div class="grid grid-cols-2 gap-4 text-xs">
        <div>
          <span class="text-gray-400 block font-medium">Layanan</span>
          <span class="font-bold text-gray-800 uppercase">${order.serviceType === 'gocar' ? '🚗 GoCar' : '🛵 GoRide'}</span>
        </div>
        <div>
          <span class="text-gray-400 block font-medium">Waktu Transaksi</span>
          <span class="font-semibold text-gray-800">${orderDate}</span>
        </div>
      </div>

      <!-- Detail Rute -->
      <div class="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-3">
        <div class="flex items-start space-x-3">
          <span class="text-base mt-0.5">🟢</span>
          <div>
            <span class="text-[10px] font-bold text-gray-400 uppercase">Titik Jemput</span>
            <p class="text-xs font-bold text-gray-900">${order.pickup.name}</p>
          </div>
        </div>
        <div class="border-l-2 border-dashed border-gray-300 ml-2.5 h-4"></div>
        <div class="flex items-start space-x-3">
          <span class="text-base mt-0.5">🔴</span>
          <div>
            <span class="text-[10px] font-bold text-gray-400 uppercase">Tujuan</span>
            <p class="text-xs font-bold text-gray-900">${order.dropoff.name}</p>
          </div>
        </div>
        <div class="pt-2 border-t border-gray-200 text-[11px] text-gray-500 flex justify-between font-medium">
          <span>Jarak Tempuh:</span>
          <span class="font-bold text-gray-800">${order.distanceKm || 3.2} km</span>
        </div>
      </div>

      <!-- Detail Mitra Driver -->
      ${driver ? `
      <div class="flex items-center space-x-3 bg-white p-3 rounded-2xl border border-gray-200">
        <img src="${driver.photo || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'}" class="w-11 h-11 rounded-full object-cover border-2 border-[#00AA13]">
        <div class="flex-1 text-xs">
          <h4 class="font-extrabold text-gray-900">${driver.name}</h4>
          <p class="text-[11px] text-gray-500">${driver.vehicleModel || 'Honda Vario'} • <strong class="text-gray-800">${driver.plateNumber || 'B 4123 SDE'}</strong></p>
        </div>
        <span class="text-xs font-bold text-yellow-500">★ ${driver.rating || '4.9'}</span>
      </div>
      ` : ''}

      <!-- Rincian Biaya -->
      <div class="border-t border-gray-200 pt-3 space-y-2 text-xs">
        <div class="flex justify-between text-gray-600">
          <span>Tarif Dasar</span>
          <span>Rp ${baseFare.toLocaleString('id-ID')}</span>
        </div>
        <div class="flex justify-between text-gray-600">
          <span>Tarif Jarak (${order.distanceKm || 3.2} km)</span>
          <span>Rp ${distanceFare.toLocaleString('id-ID')}</span>
        </div>
        <div class="flex justify-between text-gray-600">
          <span>Biaya Jasa Aplikasi</span>
          <span>Rp ${serviceFee.toLocaleString('id-ID')}</span>
        </div>
        <div class="flex justify-between font-black text-sm text-gray-900 pt-2 border-t border-gray-200">
          <span>Total Bayar</span>
          <span class="text-[#00AA13]">Rp ${order.fare.toLocaleString('id-ID')}</span>
        </div>
        <div class="flex justify-between text-[11px] text-gray-500">
          <span>Metode Pembayaran</span>
          <span class="font-bold text-[#00AA13] flex items-center space-x-1">
            <span>● Saldo GoPay</span>
          </span>
        </div>
      </div>

      <!-- Footer & Verifikasi QR -->
      <div class="pt-4 border-t border-gray-100 text-center space-y-2">
        <p class="text-[10px] text-gray-400">Bukti sah transaksi digital ini diterbitkan secara otomatis oleh sistem Gojek MVP Platform.</p>
        <div class="inline-block bg-gray-100 p-2 rounded-xl text-[10px] font-mono text-gray-600 tracking-wider">
          VERIFIED-HASH: ${Buffer.from(order.id + ':' + order.fare).toString('base64')}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    res.status(500).send('Error generating receipt: ' + err.message);
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    let driver = null;
    if (order.assignedDriverId) {
      driver = await store.getDriverById(order.assignedDriverId);
    }

    res.json({ order, driver });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { pickup, dropoff, serviceType } = req.body;
    if (!pickup || typeof pickup.lat !== 'number' || typeof pickup.lng !== 'number') {
      return res.status(400).json({ error: 'Titik penjemputan (pickup lat & lng) wajib berupa angka valid' });
    }
    if (!dropoff || typeof dropoff.lat !== 'number' || typeof dropoff.lng !== 'number') {
      return res.status(400).json({ error: 'Titik tujuan (dropoff lat & lng) wajib berupa angka valid' });
    }
    const cleanService = (serviceType || 'goride').toLowerCase();
    if (!['goride', 'gocar'].includes(cleanService)) {
      return res.status(400).json({ error: 'Jenis layanan tidak valid (pilih goride atau gocar)' });
    }

    const order = await store.createOrder({ ...req.body, serviceType: cleanService });
    // Find eligible drivers
    const candidates = await store.findEligibleDrivers(
      order.serviceType,
      order.pickup.lat,
      order.pickup.lng
    );

    if (candidates.length > 0) {
      const bestDriver = candidates[0];
      await store.updateOrder(order.id, {
        status: 'OFFERED',
        offeredDriverIds: [bestDriver.id]
      });
      await store.updateDriver(bestDriver.id, { status: 'OFFERING' });
    }

    const updated = await store.getOrderById(order.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/accept', async (req, res) => {
  try {
    const { driverId } = req.body;
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await store.updateDriver(driverId, { status: 'BUSY' });
    const updated = await store.updateOrder(req.params.id, {
      status: 'ACCEPTED',
      assignedDriverId: driverId
    });
    const driver = await store.getDriverById(driverId);

    res.json({ success: true, order: updated, driver });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/reject', async (req, res) => {
  try {
    const { driverId } = req.body;
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (driverId) {
      await store.updateDriver(driverId, { status: 'IDLE' });
    }

    const offeredSet = new Set(order.offeredDriverIds || []);
    if (driverId) offeredSet.add(driverId);

    // Try finding next eligible driver
    const eligible = await store.findEligibleDrivers(
      order.serviceType,
      order.pickup.lat,
      order.pickup.lng
    );
    const nextCandidate = eligible.find(d => !offeredSet.has(d.id));

    if (nextCandidate) {
      offeredSet.add(nextCandidate.id);
      await store.updateDriver(nextCandidate.id, { status: 'OFFERING' });
      const updated = await store.updateOrder(req.params.id, {
        status: 'OFFERED',
        offeredDriverIds: Array.from(offeredSet)
      });
      return res.json({ success: true, status: 'REOFFERED', nextDriverId: nextCandidate.id, order: updated });
    } else {
      const updated = await store.updateOrder(req.params.id, {
        status: 'NO_DRIVER',
        offeredDriverIds: Array.from(offeredSet)
      });
      return res.json({ success: true, status: 'NO_DRIVER', order: updated });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updatedOrder = await store.updateOrder(req.params.id, { status });

    if (status === 'COMPLETED' && order.assignedDriverId) {
      const driver = await store.getDriverById(order.assignedDriverId);
      if (driver) {
        await store.updateDriver(driver.id, {
          status: 'IDLE',
          tripsCompleted: (driver.tripsCompleted || 0) + 1,
          earningsToday: (driver.earningsToday || 0) + order.fare,
          walletBalance: (driver.walletBalance || 0) + order.fare
        });
      }
      if (order.paymentMethod === 'GOPAY') {
        await store.updateCustomerGopay(order.customer.id || 'cust-demo', -order.fare);
      }
    }

    res.json(updatedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/chat', async (req, res) => {
  try {
    const { sender, text } = req.body;
    const msg = await store.addOrderMessage(req.params.id, { sender, text });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  try {
    const { reason, cancelledBy } = req.body;
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const updated = await store.updateOrder(req.params.id, {
      status: 'CANCELLED',
      cancelReason: reason || 'Dibatalkan',
      cancelledBy: cancelledBy || 'customer'
    });

    if (order.assignedDriverId) {
      await store.updateDriver(order.assignedDriverId, { status: 'IDLE' });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/:id/rating', async (req, res) => {
  try {
    const { rating, tip } = req.body;
    const order = await store.getOrderById(req.params.id);
    if (!order || !order.assignedDriverId) return res.status(404).json({ error: 'Order or driver not found' });

    const tipAmount = Number(tip) || 0;
    if (tipAmount > 0) {
      await store.updateCustomerGopay(order.customer.id || 'cust-demo', -tipAmount);
      const driver = await store.getDriverById(order.assignedDriverId);
      if (driver) {
        await store.updateDriver(driver.id, {
          walletBalance: (driver.walletBalance || 0) + tipAmount,
          earningsToday: (driver.earningsToday || 0) + tipAmount
        });
      }
    }

    res.json({ success: true, message: 'Rating and tip submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer endpoints
app.get('/api/customer', async (req, res) => {
  try {
    const cust = await store.getCustomer('cust-demo');
    res.json(cust);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customer/topup', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || isNaN(amount) || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ error: 'Nominal top up tidak valid (min Rp 1.000, maks Rp 10.000.000)' });
    }
    const cust = await store.updateCustomerGopay('cust-demo', amount);
    res.json(cust);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset', async (req, res) => {
  try {
    await store.resetSeeds();
    res.json({ success: true, message: 'Data reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
