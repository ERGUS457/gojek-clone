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

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Also include assigned driver details if assigned
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
    const order = await store.createOrder(req.body);
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
    const { amount } = req.body;
    const cust = await store.updateCustomerGopay('cust-demo', Number(amount) || 50000);
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
