// Complete automated test runner with embedded server
require('./server.js');

setTimeout(async () => {
  try {
    require('./test-suite.js');
  } catch (err) {
    console.error('Runner error:', err);
    process.exit(1);
  }
}, 1000);
