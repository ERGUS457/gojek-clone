require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
let isConnected = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

// Initial Jakarta drivers seed for Neon DB
const SEED_DRIVERS = [
  {
    id: 'drv-1',
    name: 'Budi Santoso',
    phone: '0812-3456-7890',
    rating: 4.95,
    trips_completed: 1240,
    vehicle_type: 'goride',
    vehicle_model: 'Honda Vario 160 (Hitam)',
    plate_number: 'B 4123 SDE',
    is_online: true,
    status: 'IDLE',
    lat: -6.1754,
    lng: 106.8272,
    wallet_balance: 145000,
    earnings_today: 75000
  },
  {
    id: 'drv-2',
    name: 'Joko Widodo',
    phone: '0813-9876-5432',
    rating: 4.98,
    trips_completed: 2150,
    vehicle_type: 'goride',
    vehicle_model: 'Yamaha NMAX (Abu-abu)',
    plate_number: 'B 3099 KZX',
    is_online: true,
    status: 'IDLE',
    lat: -6.1932,
    lng: 106.8229,
    wallet_balance: 280000,
    earnings_today: 120000
  },
  {
    id: 'drv-3',
    name: 'Ahmad Fauzi',
    phone: '0857-1122-3344',
    rating: 4.88,
    trips_completed: 830,
    vehicle_type: 'gocar',
    vehicle_model: 'Toyota Avanza Veloz (Silver)',
    plate_number: 'B 1876 TYY',
    is_online: true,
    status: 'IDLE',
    lat: -6.2255,
    lng: 106.8097,
    wallet_balance: 420000,
    earnings_today: 185000
  },
  {
    id: 'drv-4',
    name: 'Rian Pratama',
    phone: '0878-5566-7788',
    rating: 4.92,
    trips_completed: 1420,
    vehicle_type: 'goride',
    vehicle_model: 'Honda Beat Street (Putih)',
    plate_number: 'B 6245 PRT',
    is_online: true,
    status: 'IDLE',
    lat: -6.2150,
    lng: 106.8580,
    wallet_balance: 98000,
    earnings_today: 42000
  },
  {
    id: 'drv-5',
    name: 'Bambang Sudirman',
    phone: '0811-9988-7766',
    rating: 4.97,
    trips_completed: 3100,
    vehicle_type: 'gocar',
    vehicle_model: 'Honda Brio RS (Merah)',
    plate_number: 'B 2341 BRM',
    is_online: true,
    status: 'IDLE',
    lat: -6.2238,
    lng: 106.7995,
    wallet_balance: 610000,
    earnings_today: 240000
  }
];

async function initDb() {
  if (!pool) return false;
  try {
    const client = await pool.connect();
    try {
      // Create tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          phone VARCHAR(30) NOT NULL,
          gopay_balance INTEGER DEFAULT 250000
        );

        CREATE TABLE IF NOT EXISTS drivers (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          phone VARCHAR(30) NOT NULL,
          rating NUMERIC(3,2) DEFAULT 4.90,
          trips_completed INTEGER DEFAULT 0,
          vehicle_type VARCHAR(20) NOT NULL,
          vehicle_model VARCHAR(100) NOT NULL,
          plate_number VARCHAR(20) NOT NULL,
          is_online BOOLEAN DEFAULT true,
          status VARCHAR(20) DEFAULT 'IDLE',
          lat NUMERIC(10,6) NOT NULL,
          lng NUMERIC(10,6) NOT NULL,
          wallet_balance INTEGER DEFAULT 0,
          earnings_today INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(50) PRIMARY KEY,
          customer_id VARCHAR(50) NOT NULL,
          customer_name VARCHAR(100) NOT NULL,
          customer_phone VARCHAR(30) NOT NULL,
          service_type VARCHAR(20) NOT NULL,
          pickup_name VARCHAR(255) NOT NULL,
          pickup_lat NUMERIC(10,6) NOT NULL,
          pickup_lng NUMERIC(10,6) NOT NULL,
          dropoff_name VARCHAR(255) NOT NULL,
          dropoff_lat NUMERIC(10,6) NOT NULL,
          dropoff_lng NUMERIC(10,6) NOT NULL,
          distance_km NUMERIC(5,2) NOT NULL,
          estimated_minutes INTEGER NOT NULL,
          fare INTEGER NOT NULL,
          payment_method VARCHAR(20) DEFAULT 'GOPAY',
          status VARCHAR(30) DEFAULT 'SEARCHING',
          assigned_driver_id VARCHAR(50),
          cancel_reason TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id VARCHAR(50) PRIMARY KEY,
          order_id VARCHAR(50) NOT NULL,
          sender VARCHAR(20) NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed customer if missing
      await client.query(`
        INSERT INTO customers (id, name, phone, gopay_balance)
        VALUES ('cust-demo', 'Andi Pratama', '0812-9900-1122', 250000)
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed drivers if empty
      const countRes = await client.query('SELECT count(*) FROM drivers');
      if (parseInt(countRes.rows[0].count) === 0) {
        for (const d of SEED_DRIVERS) {
          await client.query(`
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
      }

      isConnected = true;
      console.log('✅ Connected to Neon PostgreSQL database and initialized schema.');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('⚠️ Could not connect to Neon PostgreSQL:', err.message);
    return false;
  }
}

// Map SQL row to standard Driver object
function mapDriverRow(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    rating: parseFloat(row.rating),
    tripsCompleted: row.trips_completed,
    vehicleType: row.vehicle_type,
    vehicleModel: row.vehicle_model,
    plateNumber: row.plate_number,
    isOnline: row.is_online,
    status: row.status,
    currentLocation: {
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng)
    },
    walletBalance: row.wallet_balance,
    earningsToday: row.earnings_today
  };
}

// Map SQL row to standard Order object
function mapOrderRow(row, messages = []) {
  return {
    id: row.id,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone
    },
    serviceType: row.service_type,
    pickup: {
      name: row.pickup_name,
      lat: parseFloat(row.pickup_lat),
      lng: parseFloat(row.pickup_lng)
    },
    dropoff: {
      name: row.dropoff_name,
      lat: parseFloat(row.dropoff_lat),
      lng: parseFloat(row.dropoff_lng)
    },
    distanceKm: parseFloat(row.distance_km),
    estimatedMinutes: row.estimated_minutes,
    fare: row.fare,
    paymentMethod: row.payment_method,
    status: row.status,
    assignedDriverId: row.assigned_driver_id,
    cancelReason: row.cancel_reason,
    messages: messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  pool,
  initDb,
  isNeonConnected: () => isConnected,
  mapDriverRow,
  mapOrderRow,
  SEED_DRIVERS
};
