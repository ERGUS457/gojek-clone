const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const store = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mapping active sockets: socket.id -> { role, entityId }
const activeSockets = new Map();
// Mapping entityId -> socket.id
const driverSockets = new Map();
const customerSockets = new Map();

// Active offer timers: orderId -> timer
const offerTimers = new Map();

// Helper to notify admin room
function broadcastAdmin(event, data) {
  io.to('admin_room').emit(event, data);
}

// REST Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    online: true,
    totalDrivers: store.drivers.length,
    activeDrivers: store.drivers.filter(d => d.isOnline).length,
    totalOrders: store.orders.length,
    activeOrders: store.orders.filter(o => ['SEARCHING', 'OFFERED', 'ACCEPTED', 'ARRIVED', 'IN_TRIP'].includes(o.status)).length
  });
});

app.get('/api/drivers', (req, res) => {
  const { isOnline, status, vehicleType } = req.query;
  const filter = {};
  if (isOnline !== undefined) filter.isOnline = isOnline === 'true';
  if (status) filter.status = status;
  if (vehicleType) filter.vehicleType = vehicleType;
  res.json(store.getDrivers(filter));
});

app.get('/api/drivers/:id', (req, res) => {
  const driver = store.getDriverById(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  res.json(driver);
});

app.get('/api/orders', (req, res) => {
  res.json(store.orders);
});

app.get('/api/orders/:id', (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.get('/api/customer', (req, res) => {
  res.json(store.getCustomer('cust-demo'));
});

app.post('/api/customer/topup', (req, res) => {
  const { amount } = req.body;
  const cust = store.updateCustomerGopay('cust-demo', Number(amount) || 50000);
  res.json(cust);
});

app.post('/api/pricing/calculate', (req, res) => {
  const { serviceType, distanceKm } = req.body;
  const dist = Number(distanceKm) || 2;
  const fare = store.calculateFare(serviceType || 'goride', dist);
  res.json({
    serviceType,
    distanceKm: dist,
    fare,
    currency: 'IDR'
  });
});

app.post('/api/admin/reset', (req, res) => {
  store.resetSeeds();
  broadcastAdmin('fleet:reset', { drivers: store.drivers, orders: store.orders });
  io.emit('system:reset', {});
  res.json({ success: true, message: 'All demo data reset successfully' });
});

// Dispatch Engine: Find next best driver and send offer
function dispatchOrderToDriver(order) {
  const eligibleDrivers = store.findEligibleDrivers(
    order.serviceType,
    order.pickup.lat,
    order.pickup.lng
  ).filter(d => !order.offeredDriverIds.includes(d.id));

  if (eligibleDrivers.length === 0) {
    // No more drivers available
    store.updateOrder(order.id, { status: 'NO_DRIVER' });
    io.to(`order_${order.id}`).emit('order:no_driver', {
      orderId: order.id,
      message: 'Maaf, semua mitra pengemudi sedang sibuk. Silakan coba beberapa saat lagi.'
    });
    broadcastAdmin('order:updated', order);
    return;
  }

  const candidateDriver = eligibleDrivers[0];
  order.offeredDriverIds.push(candidateDriver.id);
  store.updateDriver(candidateDriver.id, { status: 'OFFERING' });
  store.updateOrder(order.id, { status: 'OFFERED' });

  broadcastAdmin('fleet:driver_updated', candidateDriver);
  broadcastAdmin('order:updated', order);

  // Send offer to driver socket
  const driverSocketId = driverSockets.get(candidateDriver.id);
  if (driverSocketId) {
    io.to(driverSocketId).emit('order:incoming_offer', {
      order,
      timeoutSeconds: 15
    });
  }

  // Clear existing timer if any
  if (offerTimers.has(order.id)) {
    clearTimeout(offerTimers.get(order.id));
  }

  // 15 seconds timer for driver to accept
  const timer = setTimeout(() => {
    offerTimers.delete(order.id);
    const currentOrder = store.getOrderById(order.id);
    if (currentOrder && currentOrder.status === 'OFFERED') {
      // Driver timed out / missed offer
      store.updateDriver(candidateDriver.id, { status: 'IDLE' });
      broadcastAdmin('fleet:driver_updated', candidateDriver);
      const sId = driverSockets.get(candidateDriver.id);
      if (sId) {
        io.to(sId).emit('order:offer_expired', { orderId: order.id });
      }
      // Re-dispatch to next driver
      dispatchOrderToDriver(currentOrder);
    }
  }, 15000);

  offerTimers.set(order.id, timer);
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Register identity
  socket.on('client:register', ({ role, id }) => {
    activeSockets.set(socket.id, { role, entityId: id });
    if (role === 'driver') {
      driverSockets.set(id, socket.id);
      socket.join(`driver_${id}`);
      const driver = store.getDriverById(id);
      socket.emit('driver:init_state', driver);
      console.log(`[Driver Connected] ${id} (${socket.id})`);
    } else if (role === 'customer') {
      customerSockets.set(id, socket.id);
      socket.join(`customer_${id}`);
      console.log(`[Customer Connected] ${id} (${socket.id})`);
    } else if (role === 'admin') {
      socket.join('admin_room');
      socket.emit('admin:init_state', {
        drivers: store.drivers,
        orders: store.orders
      });
      console.log(`[Admin Connected] (${socket.id})`);
    }
  });

  // Driver toggle online/offline
  socket.on('driver:toggle_online', ({ driverId, isOnline }) => {
    const driver = store.updateDriver(driverId, {
      isOnline,
      status: isOnline ? 'IDLE' : 'OFFLINE'
    });
    if (driver) {
      socket.emit('driver:status_changed', driver);
      broadcastAdmin('fleet:driver_updated', driver);
      io.emit('fleet:driver_location', {
        driverId: driver.id,
        isOnline: driver.isOnline,
        status: driver.status,
        location: driver.currentLocation,
        vehicleType: driver.vehicleType
      });
    }
  });

  // Driver GPS location streaming
  socket.on('driver:update_location', ({ driverId, lat, lng, heading }) => {
    const driver = store.updateDriver(driverId, {
      currentLocation: { lat, lng },
      heading: heading || 0
    });
    if (!driver) return;

    // Broadcast to public/customer and admin
    io.emit('fleet:driver_location', {
      driverId: driver.id,
      isOnline: driver.isOnline,
      status: driver.status,
      location: driver.currentLocation,
      heading: driver.heading,
      vehicleType: driver.vehicleType
    });

    // Check if driver has an active order
    const activeOrder = store.orders.find(o =>
      o.assignedDriverId === driverId &&
      ['ACCEPTED', 'ARRIVED', 'IN_TRIP'].includes(o.status)
    );

    if (activeOrder) {
      io.to(`order_${activeOrder.id}`).emit('order:driver_location', {
        orderId: activeOrder.id,
        location: driver.currentLocation,
        heading: driver.heading
      });
    }
  });

  // Customer creates order
  socket.on('order:create', (orderPayload) => {
    const order = store.createOrder(orderPayload);
    socket.join(`order_${order.id}`);

    // Confirm creation to customer
    socket.emit('order:created', order);
    broadcastAdmin('order:new', order);

    // Run dispatch engine
    dispatchOrderToDriver(order);
  });

  // Customer joins order room (for reloads)
  socket.on('order:join', ({ orderId }) => {
    socket.join(`order_${orderId}`);
    const order = store.getOrderById(orderId);
    if (order) {
      socket.emit('order:current_state', order);
    }
  });

  // Driver accepts order
  socket.on('order:accept', ({ orderId, driverId }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const order = store.getOrderById(orderId);
    const driver = store.getDriverById(driverId);
    if (!order || !driver) return;

    // Update states
    store.updateDriver(driverId, { status: 'BUSY' });
    store.updateOrder(orderId, {
      status: 'ACCEPTED',
      assignedDriverId: driverId
    });

    // Notify driver
    socket.emit('order:assigned', { order, driver });

    // Notify customer
    io.to(`order_${orderId}`).emit('order:matched', {
      order,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        rating: driver.rating,
        vehicleType: driver.vehicleType,
        vehicleModel: driver.vehicleModel,
        plateNumber: driver.plateNumber,
        currentLocation: driver.currentLocation
      }
    });

    broadcastAdmin('fleet:driver_updated', driver);
    broadcastAdmin('order:updated', order);
  });

  // Driver rejects order
  socket.on('order:reject', ({ orderId, driverId }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const driver = store.updateDriver(driverId, { status: 'IDLE' });
    if (driver) broadcastAdmin('fleet:driver_updated', driver);

    socket.emit('order:rejected_confirmed', { orderId });

    const order = store.getOrderById(orderId);
    if (order && order.status === 'OFFERED') {
      dispatchOrderToDriver(order);
    }
  });

  // Driver updates order lifecycle
  socket.on('order:update_status', ({ orderId, status }) => {
    const order = store.getOrderById(orderId);
    if (!order) return;

    store.updateOrder(orderId, { status });
    const driver = store.getDriverById(order.assignedDriverId);

    if (status === 'ARRIVED') {
      io.to(`order_${orderId}`).emit('order:driver_arrived', { orderId });
    } else if (status === 'IN_TRIP') {
      io.to(`order_${orderId}`).emit('order:trip_started', { orderId });
    } else if (status === 'COMPLETED') {
      // Driver completed trip: update driver wallet & trips
      if (driver) {
        store.updateDriver(driver.id, {
          status: 'IDLE',
          tripsCompleted: (driver.tripsCompleted || 0) + 1,
          earningsToday: (driver.earningsToday || 0) + order.fare,
          walletBalance: (driver.walletBalance || 0) + order.fare
        });
        broadcastAdmin('fleet:driver_updated', driver);
      }

      // Customer payment settlement
      if (order.paymentMethod === 'GOPAY') {
        store.updateCustomerGopay(order.customer.id || 'cust-demo', -order.fare);
      }

      io.to(`order_${orderId}`).emit('order:completed', {
        orderId,
        order,
        driver
      });
    }

    broadcastAdmin('order:updated', order);
  });

  // Customer or Driver cancels order
  socket.on('order:cancel', ({ orderId, reason, cancelledBy }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const order = store.getOrderById(orderId);
    if (!order) return;

    store.updateOrder(orderId, {
      status: 'CANCELLED',
      cancelReason: reason || 'Dibatalkan oleh pengguna',
      cancelledBy: cancelledBy || 'customer'
    });

    if (order.assignedDriverId) {
      const driver = store.updateDriver(order.assignedDriverId, { status: 'IDLE' });
      broadcastAdmin('fleet:driver_updated', driver);
      const dSocketId = driverSockets.get(order.assignedDriverId);
      if (dSocketId) {
        io.to(dSocketId).emit('order:cancelled_by_customer', { orderId, reason });
      }
    }

    io.to(`order_${orderId}`).emit('order:cancelled', { orderId, reason });
    broadcastAdmin('order:updated', order);
  });

  // Realtime in-trip chat
  socket.on('chat:message', ({ orderId, sender, text }) => {
    const msg = store.addOrderMessage(orderId, { sender, text });
    if (msg) {
      io.to(`order_${orderId}`).emit('chat:incoming', { orderId, message: msg });
    }
  });

  // Disconnection cleanup
  socket.on('disconnect', () => {
    const meta = activeSockets.get(socket.id);
    if (meta) {
      if (meta.role === 'driver') {
        driverSockets.delete(meta.entityId);
      } else if (meta.role === 'customer') {
        customerSockets.delete(meta.entityId);
      }
      activeSockets.delete(socket.id);
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Gojek Clone Platform is running on port ${PORT}`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
