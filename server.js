const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const apiApp = require('./api/index');
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

// Mount unified REST API endpoints
app.use(apiApp);

// Mapping active sockets
const activeSockets = new Map();
const driverSockets = new Map();
const customerSockets = new Map();
const offerTimers = new Map();

function broadcastAdmin(event, data) {
  io.to('admin_room').emit(event, data);
}

// Dispatch Engine: Find next best driver and send offer
async function dispatchOrderToDriver(order) {
  const eligibleDrivers = (await store.findEligibleDrivers(
    order.serviceType,
    order.pickup.lat,
    order.pickup.lng
  )).filter(d => !order.offeredDriverIds.includes(d.id));

  if (eligibleDrivers.length === 0) {
    await store.updateOrder(order.id, { status: 'NO_DRIVER' });
    io.to(`order_${order.id}`).emit('order:no_driver', {
      orderId: order.id,
      message: 'Maaf, semua mitra pengemudi sedang sibuk. Silakan coba beberapa saat lagi.'
    });
    broadcastAdmin('order:updated', order);
    return;
  }

  const candidateDriver = eligibleDrivers[0];
  order.offeredDriverIds.push(candidateDriver.id);
  await store.updateDriver(candidateDriver.id, { status: 'OFFERING' });
  await store.updateOrder(order.id, { status: 'OFFERED', offeredDriverIds: order.offeredDriverIds });

  broadcastAdmin('fleet:driver_updated', candidateDriver);
  broadcastAdmin('order:updated', order);

  const driverSocketId = driverSockets.get(candidateDriver.id);
  if (driverSocketId) {
    io.to(driverSocketId).emit('order:incoming_offer', {
      order,
      timeoutSeconds: 15
    });
  }

  if (offerTimers.has(order.id)) {
    clearTimeout(offerTimers.get(order.id));
  }

  const timer = setTimeout(async () => {
    offerTimers.delete(order.id);
    const currentOrder = await store.getOrderById(order.id);
    if (currentOrder && currentOrder.status === 'OFFERED') {
      await store.updateDriver(candidateDriver.id, { status: 'IDLE' });
      broadcastAdmin('fleet:driver_updated', candidateDriver);
      const sId = driverSockets.get(candidateDriver.id);
      if (sId) {
        io.to(sId).emit('order:offer_expired', { orderId: order.id });
      }
      dispatchOrderToDriver(currentOrder);
    }
  }, 15000);

  offerTimers.set(order.id, timer);
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  socket.on('client:register', async ({ role, id }) => {
    activeSockets.set(socket.id, { role, entityId: id });
    if (role === 'driver') {
      driverSockets.set(id, socket.id);
      socket.join(`driver_${id}`);
      const driver = await store.getDriverById(id);
      socket.emit('driver:init_state', driver);
    } else if (role === 'customer') {
      customerSockets.set(id, socket.id);
      socket.join(`customer_${id}`);
    } else if (role === 'admin') {
      socket.join('admin_room');
      const [drivers, orders] = await Promise.all([store.getDrivers(), store.getOrders()]);
      socket.emit('admin:init_state', { drivers, orders });
    }
  });

  socket.on('driver:toggle_online', async ({ driverId, isOnline }) => {
    const driver = await store.updateDriver(driverId, {
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

  socket.on('driver:update_location', async ({ driverId, lat, lng, heading }) => {
    const driver = await store.updateDriver(driverId, {
      currentLocation: { lat, lng },
      heading: heading || 0
    });
    if (!driver) return;

    io.emit('fleet:driver_location', {
      driverId: driver.id,
      isOnline: driver.isOnline,
      status: driver.status,
      location: driver.currentLocation,
      heading: driver.heading,
      vehicleType: driver.vehicleType
    });

    const orders = await store.getOrders();
    const activeOrder = orders.find(o =>
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

  socket.on('order:create', async (orderPayload) => {
    const order = await store.createOrder(orderPayload);
    socket.join(`order_${order.id}`);

    socket.emit('order:created', order);
    broadcastAdmin('order:new', order);

    dispatchOrderToDriver(order);
  });

  socket.on('order:join', async ({ orderId }) => {
    socket.join(`order_${orderId}`);
    const order = await store.getOrderById(orderId);
    if (order) {
      socket.emit('order:current_state', order);
    }
  });

  socket.on('order:accept', async ({ orderId, driverId }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const order = await store.getOrderById(orderId);
    const driver = await store.getDriverById(driverId);
    if (!order || !driver) return;

    await store.updateDriver(driverId, { status: 'BUSY' });
    const updated = await store.updateOrder(orderId, {
      status: 'ACCEPTED',
      assignedDriverId: driverId
    });

    socket.emit('order:assigned', { order: updated, driver });

    io.to(`order_${orderId}`).emit('order:matched', {
      order: updated,
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
    broadcastAdmin('order:updated', updated);
  });

  socket.on('order:reject', async ({ orderId, driverId }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const driver = await store.updateDriver(driverId, { status: 'IDLE' });
    if (driver) broadcastAdmin('fleet:driver_updated', driver);

    socket.emit('order:rejected_confirmed', { orderId });

    const order = await store.getOrderById(orderId);
    if (order && order.status === 'OFFERED') {
      dispatchOrderToDriver(order);
    }
  });

  socket.on('order:update_status', async ({ orderId, status }) => {
    const order = await store.getOrderById(orderId);
    if (!order) return;

    const updated = await store.updateOrder(orderId, { status });
    const driver = await store.getDriverById(order.assignedDriverId);

    if (status === 'ARRIVED') {
      io.to(`order_${orderId}`).emit('order:driver_arrived', { orderId });
    } else if (status === 'IN_TRIP') {
      io.to(`order_${orderId}`).emit('order:trip_started', { orderId });
    } else if (status === 'COMPLETED') {
      if (driver) {
        await store.updateDriver(driver.id, {
          status: 'IDLE',
          tripsCompleted: (driver.tripsCompleted || 0) + 1,
          earningsToday: (driver.earningsToday || 0) + order.fare,
          walletBalance: (driver.walletBalance || 0) + order.fare
        });
        broadcastAdmin('fleet:driver_updated', driver);
      }

      if (order.paymentMethod === 'GOPAY') {
        await store.updateCustomerGopay(order.customer.id || 'cust-demo', -order.fare);
      }

      io.to(`order_${orderId}`).emit('order:completed', {
        orderId,
        order: updated,
        driver
      });
    }

    broadcastAdmin('order:updated', updated);
  });

  socket.on('order:cancel', async ({ orderId, reason, cancelledBy }) => {
    if (offerTimers.has(orderId)) {
      clearTimeout(offerTimers.get(orderId));
      offerTimers.delete(orderId);
    }

    const order = await store.getOrderById(orderId);
    if (!order) return;

    const updated = await store.updateOrder(orderId, {
      status: 'CANCELLED',
      cancelReason: reason || 'Dibatalkan oleh pengguna',
      cancelledBy: cancelledBy || 'customer'
    });

    if (order.assignedDriverId) {
      const driver = await store.updateDriver(order.assignedDriverId, { status: 'IDLE' });
      broadcastAdmin('fleet:driver_updated', driver);
      const dSocketId = driverSockets.get(order.assignedDriverId);
      if (dSocketId) {
        io.to(dSocketId).emit('order:cancelled_by_customer', { orderId, reason });
      }
    }

    io.to(`order_${orderId}`).emit('order:cancelled', { orderId, reason });
    broadcastAdmin('order:updated', updated);
  });

  socket.on('chat:message', async ({ orderId, sender, text }) => {
    const msg = await store.addOrderMessage(orderId, { sender, text });
    if (msg) {
      io.to(`order_${orderId}`).emit('chat:incoming', { orderId, message: msg });
    }
  });

  socket.on('disconnect', () => {
    const meta = activeSockets.get(socket.id);
    if (meta) {
      if (meta.role === 'driver') driverSockets.delete(meta.entityId);
      else if (meta.role === 'customer') customerSockets.delete(meta.entityId);
      activeSockets.delete(socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Gojek Clone Platform is running on port ${PORT}`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
