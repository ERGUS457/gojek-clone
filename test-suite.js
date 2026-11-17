const http = require('http');

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Gojek MVP Comprehensive Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Reset Demo Data
    console.log('1. Testing System Reset & Seeding...');
    const resetRes = await request('POST', '/api/admin/reset');
    assert(resetRes.status === 200, 'Admin reset returns 200 OK');

    // 2. Health & Status
    console.log('\n2. Testing System Status...');
    const statusRes = await request('GET', '/api/status');
    assert(statusRes.status === 200, 'Status returns 200 OK');
    assert(statusRes.body.online === true, 'Status reports online: true');
    assert(statusRes.body.totalDrivers === 5, 'Total drivers equals 5');

    // 3. Drivers List & Filter
    console.log('\n3. Testing Driver Management...');
    const driversRes = await request('GET', '/api/drivers?vehicleType=goride');
    assert(driversRes.status === 200, 'GET /api/drivers?vehicleType=goride returns 200');
    assert(driversRes.body.length >= 3, 'Found GoRide drivers in Jakarta fleet');

    const firstDriver = driversRes.body[0];
    const driverDetailRes = await request('GET', `/api/drivers/${firstDriver.id}`);
    assert(driverDetailRes.body.name === firstDriver.name, `Fetched driver detail: ${firstDriver.name}`);

    // 4. Pricing Calculation
    console.log('\n4. Testing Pricing Engine...');
    const priceRes = await request('POST', '/api/pricing/calculate', {
      serviceType: 'goride',
      distanceKm: 4.5
    });
    assert(priceRes.status === 200, 'POST /api/pricing/calculate returns 200');
    assert(priceRes.body.fare > 9000, `Calculated fare for 4.5km: Rp ${priceRes.body.fare}`);

    // 5. Order Creation & Dispatch
    console.log('\n5. Testing Ride Order Lifecycle...');
    const orderPayload = {
      customer: { id: 'cust-demo', name: 'Andi Pratama', phone: '0812-9900-1122' },
      serviceType: 'goride',
      pickup: { name: 'Monas', lat: -6.1754, lng: 106.8272 },
      dropoff: { name: 'Grand Indonesia', lat: -6.1954, lng: 106.8218 },
      distanceKm: 3.2,
      fare: 13000,
      paymentMethod: 'GOPAY'
    };

    const createRes = await request('POST', '/api/orders', orderPayload);
    assert(createRes.status === 200, 'POST /api/orders returns 200 OK');
    assert(createRes.body.id.startsWith('ord-'), `Order created successfully: ${createRes.body.id}`);
    const orderId = createRes.body.id;

    // 6. Driver Acceptance
    console.log('\n6. Testing Driver Accept...');
    const acceptRes = await request('POST', `/api/orders/${orderId}/accept`, {
      driverId: firstDriver.id
    });
    assert(acceptRes.status === 200, 'Driver accepts order returns 200');
    assert(acceptRes.body.order.status === 'ACCEPTED', 'Order status transitioned to ACCEPTED');
    assert(acceptRes.body.order.assignedDriverId === firstDriver.id, 'Driver assigned properly');

    // 7. In-App Chat
    console.log('\n7. Testing In-App Realtime Chat...');
    const chat1 = await request('POST', `/api/orders/${orderId}/chat`, {
      sender: 'customer',
      text: 'Halo pak, posisi di mana?'
    });
    assert(chat1.status === 200, 'Customer chat sent');

    const chat2 = await request('POST', `/api/orders/${orderId}/chat`, {
      sender: 'driver',
      text: 'Halo kak, saya otw lobi selatan ya.'
    });
    assert(chat2.status === 200, 'Driver chat sent');

    const orderWithChat = await request('GET', `/api/orders/${orderId}`);
    assert(orderWithChat.body.order.messages.length === 2, 'Both chat messages persisted');

    // 8. Driver GPS Telemetry Streaming
    console.log('\n8. Testing Driver GPS Coordinate Updates...');
    const locUpdate = await request('POST', `/api/drivers/${firstDriver.id}/location`, {
      lat: -6.1780,
      lng: 106.8260,
      heading: 180
    });
    assert(locUpdate.status === 200, 'Driver location updated');

    // 9. Trip Progress: Arrived -> In Trip -> Completed
    console.log('\n9. Testing Trip Progression & Settlement...');
    const arrivedRes = await request('POST', `/api/orders/${orderId}/status`, { status: 'ARRIVED' });
    assert(arrivedRes.body.status === 'ARRIVED', 'Driver arrived at pickup');

    const inTripRes = await request('POST', `/api/orders/${orderId}/status`, { status: 'IN_TRIP' });
    assert(inTripRes.body.status === 'IN_TRIP', 'Trip in progress towards destination');

    const completedRes = await request('POST', `/api/orders/${orderId}/status`, { status: 'COMPLETED' });
    assert(completedRes.body.status === 'COMPLETED', 'Trip completed successfully');

    // 10. Financial Settlement & Tip
    console.log('\n10. Testing Financial Settlement & Tipping...');
    const ratingRes = await request('POST', `/api/orders/${orderId}/rating`, {
      rating: 5,
      tip: 5000
    });
    assert(ratingRes.status === 200, 'Tip and rating submitted');

    const custRes = await request('GET', '/api/customer');
    assert(custRes.body.gopayBalance === 250000 - 13000 - 5000, `GoPay deducted for fare + tip: Rp ${custRes.body.gopayBalance}`);

    // 11. Driver Rejection & Fallback Dispatch
    console.log('\n11. Testing Driver Rejection & Dispatch Fallback...');
    const order2 = await request('POST', '/api/orders', {
      serviceType: 'goride',
      pickup: { name: 'Monas', lat: -6.1754, lng: 106.8272 },
      dropoff: { name: 'SCBD', lat: -6.2255, lng: 106.8097 },
      distanceKm: 5.0,
      fare: 17500
    });
    const order2Id = order2.body.id;
    const firstOfferedDriver = order2.body.offeredDriverIds[0];

    const rejectRes = await request('POST', `/api/orders/${order2Id}/reject`, {
      driverId: firstOfferedDriver
    });
    assert(rejectRes.status === 200, 'Driver reject handled successfully');
    assert(rejectRes.body.order.offeredDriverIds.length >= 2 || rejectRes.body.status === 'NO_DRIVER', 'Order dispatched to next candidate or closed');

    // 12. Order Cancellation
    console.log('\n12. Testing Order Cancellation...');
    const cancelRes = await request('POST', `/api/orders/${order2Id}/cancel`, {
      reason: 'Ingin ubah tujuan',
      cancelledBy: 'customer'
    });
    assert(cancelRes.status === 200, 'Order cancelled successfully');
    assert(cancelRes.body.status === 'CANCELLED', 'Order status marked as CANCELLED');

    // 13. Security & Input Validation (Karpathy Guidelines & Security Audit)
    console.log('\n13. Testing Security & Input Validation...');
    const invalidTopup = await request('POST', '/api/customer/topup', { amount: -50000 });
    assert(invalidTopup.status === 400, 'Negative topup rejected with 400 Bad Request');

    const invalidOrder = await request('POST', '/api/orders', {
      customer: { id: 'cust-demo' },
      pickup: 'InvalidLocation',
      dropoff: null
    });
    assert(invalidOrder.status === 400, 'Malformed order coordinates rejected with 400 Bad Request');

    // 14. Official Digital E-Receipt Endpoint
    console.log('\n14. Testing Digital E-Receipt Generation...');
    const receiptRes = await request('GET', `/api/orders/${orderId}/receipt`);
    assert(receiptRes.status === 200, 'GET /api/orders/:id/receipt returns 200 OK');
    assert(typeof receiptRes.body === 'string' && receiptRes.body.includes('E-Receipt Resmi Perjalanan'), 'Receipt contains Gojek official header & details');

    // Summary
    console.log('\n===============================================');
    console.log(`  Tests Completed: ${passed + failed}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log('===============================================');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
