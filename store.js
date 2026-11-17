const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const DATA_FILE = path.join(__dirname, 'data.json');

const INITIAL_DRIVERS = [
  {
    id: 'drv-1',
    name: 'Budi Santoso',
    phone: '0812-3456-7890',
    rating: 4.95,
    tripsCompleted: 1240,
    vehicleType: 'goride',
    vehicleModel: 'Honda Vario 160 (Hitam)',
    plateNumber: 'B 4123 SDE',
    isOnline: true,
    status: 'IDLE',
    currentLocation: { lat: -6.1754, lng: 106.8272 },
    walletBalance: 145000,
    earningsToday: 75000
  },
  {
    id: 'drv-2',
    name: 'Joko Widodo',
    phone: '0813-9876-5432',
    rating: 4.98,
    tripsCompleted: 2150,
    vehicleType: 'goride',
    vehicleModel: 'Yamaha NMAX (Abu-abu)',
    plateNumber: 'B 3099 KZX',
    isOnline: true,
    status: 'IDLE',
    currentLocation: { lat: -6.1932, lng: 106.8229 },
    walletBalance: 280000,
    earningsToday: 120000
  },
  {
    id: 'drv-3',
    name: 'Ahmad Fauzi',
    phone: '0857-1122-3344',
    rating: 4.88,
    tripsCompleted: 830,
    vehicleType: 'gocar',
    vehicleModel: 'Toyota Avanza Veloz (Silver)',
    plateNumber: 'B 1876 TYY',
    isOnline: true,
    status: 'IDLE',
    currentLocation: { lat: -6.2255, lng: 106.8097 },
    walletBalance: 420000,
    earningsToday: 185000
  },
  {
    id: 'drv-4',
    name: 'Rian Pratama',
    phone: '0878-5566-7788',
    rating: 4.92,
    tripsCompleted: 1420,
    vehicleType: 'goride',
    vehicleModel: 'Honda Beat Street (Putih)',
    plateNumber: 'B 6245 PRT',
    isOnline: true,
    status: 'IDLE',
    currentLocation: { lat: -6.2150, lng: 106.8580 },
    walletBalance: 98000,
    earningsToday: 42000
  },
  {
    id: 'drv-5',
    name: 'Bambang Sudirman',
    phone: '0811-9988-7766',
    rating: 4.97,
    tripsCompleted: 3100,
    vehicleType: 'gocar',
    vehicleModel: 'Honda Brio RS (Merah)',
    plateNumber: 'B 2341 BRM',
    isOnline: true,
    status: 'IDLE',
    currentLocation: { lat: -6.2238, lng: 106.7995 },
    walletBalance: 610000,
    earningsToday: 240000
  }
];

class Store {
  constructor() {
    this.drivers = [];
    this.orders = [];
    this.customers = {
      'cust-demo': {
        id: 'cust-demo',
        name: 'Andi Pratama',
        phone: '0812-9900-1122',
        gopayBalance: 250000
      }
    };
    this.pricing = {
      goride: { baseFare: 9000, baseKm: 2, perKmFare: 2800 },
      gocar: { baseFare: 16000, baseKm: 2, perKmFare: 5500 }
    };

    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const data = JSON.parse(raw);
        this.drivers = data.drivers || INITIAL_DRIVERS;
        this.orders = data.orders || [];
        if (data.customers) this.customers = data.customers;
        return;
      }
    } catch (e) {
      console.warn('Using fresh seeds:', e.message);
    }
    this.resetSeedsLocal();
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        drivers: this.drivers,
        orders: this.orders,
        customers: this.customers
      }, null, 2), 'utf8');
    } catch (e) {
      // Ignored in read-only serverless environment
    }
  }

  resetSeedsLocal() {
    this.drivers = JSON.parse(JSON.stringify(INITIAL_DRIVERS));
    this.orders = [];
    this.save();
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
  }

  calculateFare(serviceType, distanceKm) {
    const config = this.pricing[serviceType] || this.pricing.goride;
    if (distanceKm <= config.baseKm) return config.baseFare;
    const extraKm = distanceKm - config.baseKm;
    const fare = config.baseFare + Math.round(extraKm * config.perKmFare);
    return Math.ceil(fare / 500) * 500;
  }

  async getDrivers(filter = {}) {
    if (db.isNeonConnected()) {
      try {
        let query = 'SELECT * FROM drivers WHERE 1=1';
        const params = [];
        if (filter.isOnline !== undefined) {
          params.push(filter.isOnline);
          query += ` AND is_online = $${params.length}`;
        }
        if (filter.status) {
          params.push(filter.status);
          query += ` AND status = $${params.length}`;
        }
        if (filter.vehicleType) {
          params.push(filter.vehicleType);
          query += ` AND vehicle_type = $${params.length}`;
        }
        const res = await db.pool.query(query, params);
        return res.rows.map(db.mapDriverRow);
      } catch (err) {
        console.warn('Neon query error, fallback to memory:', err.message);
      }
    }

    return this.drivers.filter(d => {
      if (filter.isOnline !== undefined && d.isOnline !== filter.isOnline) return false;
      if (filter.status && d.status !== filter.status) return false;
      if (filter.vehicleType && d.vehicleType !== filter.vehicleType) return false;
      return true;
    });
  }

  async getDriverById(id) {
    if (db.isNeonConnected()) {
      try {
        const res = await db.pool.query('SELECT * FROM drivers WHERE id = $1', [id]);
        if (res.rows.length > 0) return db.mapDriverRow(res.rows[0]);
      } catch (err) {
        console.warn('Neon query error:', err.message);
      }
    }
    return this.drivers.find(d => d.id === id);
  }

  async updateDriver(id, updates) {
    if (db.isNeonConnected()) {
      try {
        const sets = [];
        const params = [id];
        if (updates.isOnline !== undefined) {
          params.push(updates.isOnline);
          sets.push(`is_online = $${params.length}`);
        }
        if (updates.status !== undefined) {
          params.push(updates.status);
          sets.push(`status = $${params.length}`);
        }
        if (updates.currentLocation) {
          params.push(updates.currentLocation.lat);
          sets.push(`lat = $${params.length}`);
          params.push(updates.currentLocation.lng);
          sets.push(`lng = $${params.length}`);
        }
        if (updates.walletBalance !== undefined) {
          params.push(updates.walletBalance);
          sets.push(`wallet_balance = $${params.length}`);
        }
        if (updates.earningsToday !== undefined) {
          params.push(updates.earningsToday);
          sets.push(`earnings_today = $${params.length}`);
        }
        if (updates.tripsCompleted !== undefined) {
          params.push(updates.tripsCompleted);
          sets.push(`trips_completed = $${params.length}`);
        }
        if (sets.length > 0) {
          await db.pool.query(`UPDATE drivers SET ${sets.join(', ')} WHERE id = $1`, params);
        }
        return this.getDriverById(id);
      } catch (err) {
        console.warn('Neon updateDriver error:', err.message);
      }
    }

    const driver = this.drivers.find(d => d.id === id);
    if (!driver) return null;
    Object.assign(driver, updates);
    this.save();
    return driver;
  }

  async findEligibleDrivers(serviceType, pickupLat, pickupLng, maxDistanceKm = 10) {
    const drivers = await this.getDrivers({ isOnline: true, status: 'IDLE', vehicleType: serviceType });
    return drivers
      .map(d => {
        const dist = this.calculateDistance(pickupLat, pickupLng, d.currentLocation.lat, d.currentLocation.lng);
        return { driver: d, distanceKm: dist };
      })
      .filter(item => item.distanceKm <= maxDistanceKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map(item => item.driver);
  }

  async getOrders() {
    if (db.isNeonConnected()) {
      try {
        const res = await db.pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
        return res.rows.map(r => db.mapOrderRow(r));
      } catch (err) {
        console.warn('Neon getOrders error:', err.message);
      }
    }
    return this.orders;
  }

  async getOrderById(id) {
    if (db.isNeonConnected()) {
      try {
        const res = await db.pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (res.rows.length > 0) {
          const msgRes = await db.pool.query('SELECT * FROM chat_messages WHERE order_id = $1 ORDER BY created_at ASC', [id]);
          const messages = msgRes.rows.map(m => ({
            id: m.id,
            sender: m.sender,
            text: m.text,
            timestamp: m.created_at
          }));
          return db.mapOrderRow(res.rows[0], messages);
        }
      } catch (err) {
        console.warn('Neon getOrderById error:', err.message);
      }
    }
    return this.orders.find(o => o.id === id);
  }

  async createOrder(orderData) {
    const id = 'ord-' + uuidv4().slice(0, 8);
    const distanceKm = orderData.distanceKm || this.calculateDistance(
      orderData.pickup.lat, orderData.pickup.lng,
      orderData.dropoff.lat, orderData.dropoff.lng
    );
    const fare = orderData.fare || this.calculateFare(orderData.serviceType, distanceKm);
    const estimatedMinutes = Math.max(5, Math.round(distanceKm * 3.5));

    const order = {
      id,
      customer: orderData.customer || {
        id: 'cust-demo',
        name: 'Andi Pratama',
        phone: '0812-9900-1122'
      },
      serviceType: orderData.serviceType,
      pickup: orderData.pickup,
      dropoff: orderData.dropoff,
      distanceKm,
      estimatedMinutes,
      fare,
      paymentMethod: orderData.paymentMethod || 'GOPAY',
      status: 'SEARCHING',
      assignedDriverId: null,
      offeredDriverIds: [],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (db.isNeonConnected()) {
      try {
        await db.pool.query(`
          INSERT INTO orders (
            id, customer_id, customer_name, customer_phone, service_type,
            pickup_name, pickup_lat, pickup_lng, dropoff_name, dropoff_lat, dropoff_lng,
            distance_km, estimated_minutes, fare, payment_method, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `, [
          order.id, order.customer.id, order.customer.name, order.customer.phone,
          order.serviceType, order.pickup.name, order.pickup.lat, order.pickup.lng,
          order.dropoff.name, order.dropoff.lat, order.dropoff.lng,
          order.distanceKm, order.estimatedMinutes, order.fare, order.paymentMethod, order.status
        ]);
        return order;
      } catch (err) {
        console.warn('Neon createOrder error:', err.message);
      }
    }

    this.orders.unshift(order);
    this.save();
    return order;
  }

  async updateOrder(id, updates) {
    if (db.isNeonConnected()) {
      try {
        const sets = ['updated_at = CURRENT_TIMESTAMP'];
        const params = [id];
        if (updates.status) {
          params.push(updates.status);
          sets.push(`status = $${params.length}`);
        }
        if (updates.assignedDriverId !== undefined) {
          params.push(updates.assignedDriverId);
          sets.push(`assigned_driver_id = $${params.length}`);
        }
        if (updates.cancelReason !== undefined) {
          params.push(updates.cancelReason);
          sets.push(`cancel_reason = $${params.length}`);
        }
        await db.pool.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, params);
        return this.getOrderById(id);
      } catch (err) {
        console.warn('Neon updateOrder error:', err.message);
      }
    }

    const order = this.orders.find(o => o.id === id);
    if (!order) return null;
    Object.assign(order, updates, { updatedAt: new Date().toISOString() });
    this.save();
    return order;
  }

  async addOrderMessage(orderId, message) {
    const msgId = 'msg-' + Date.now();
    if (db.isNeonConnected()) {
      try {
        await db.pool.query(`
          INSERT INTO chat_messages (id, order_id, sender, text)
          VALUES ($1, $2, $3, $4)
        `, [msgId, orderId, message.sender, message.text]);
        return {
          id: msgId,
          sender: message.sender,
          text: message.text,
          timestamp: new Date().toISOString()
        };
      } catch (err) {
        console.warn('Neon addOrderMessage error:', err.message);
      }
    }

    const order = this.orders.find(o => o.id === orderId);
    if (!order) return null;
    const msg = {
      id: msgId,
      sender: message.sender,
      text: message.text,
      timestamp: new Date().toISOString()
    };
    order.messages.push(msg);
    this.save();
    return msg;
  }

  async getCustomer(id = 'cust-demo') {
    if (db.isNeonConnected()) {
      try {
        const res = await db.pool.query('SELECT * FROM customers WHERE id = $1', [id]);
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id: row.id,
            name: row.name,
            phone: row.phone,
            gopayBalance: row.gopay_balance
          };
        }
      } catch (err) {
        console.warn('Neon getCustomer error:', err.message);
      }
    }
    if (!this.customers[id]) {
      this.customers[id] = { id, name: 'Andi Pratama', phone: '0812-9900-1122', gopayBalance: 250000 };
    }
    return this.customers[id];
  }

  async updateCustomerGopay(id, amount) {
    if (db.isNeonConnected()) {
      try {
        await db.pool.query(`
          UPDATE customers
          SET gopay_balance = GREATEST(0, gopay_balance + $1)
          WHERE id = $2
        `, [amount, id]);
        return this.getCustomer(id);
      } catch (err) {
        console.warn('Neon updateCustomerGopay error:', err.message);
      }
    }

    const cust = await this.getCustomer(id);
    cust.gopayBalance = Math.max(0, cust.gopayBalance + amount);
    this.save();
    return cust;
  }

  async resetSeeds() {
    if (db.isNeonConnected()) {
      try {
        await db.pool.query('DELETE FROM chat_messages');
        await db.pool.query('DELETE FROM orders');
        await db.pool.query('DELETE FROM drivers');
        for (const d of db.SEED_DRIVERS) {
          await db.pool.query(`
            INSERT INTO drivers (
              id, name, phone, rating, trips_completed, vehicle_type,
              vehicle_model, plate_number, is_online, status, lat, lng,
              wallet_balance, earnings_today
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          `, [
            d.id, d.name, d.phone, d.rating, d.trips_completed, d.vehicle_type,
            d.vehicle_model, d.plate_number, d.is_online, d.status, d.lat, d.lng,
            d.wallet_balance, d.earnings_today
          ]);
        }
      } catch (err) {
        console.warn('Neon resetSeeds error:', err.message);
      }
    }
    this.resetSeedsLocal();
  }
}

module.exports = new Store();
