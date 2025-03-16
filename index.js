require('dotenv').config();
const Loop = require('./lib/loop');

// Configuration
const config = {
  nightscout: {
    url: process.env.NIGHTSCOUT_URL || 'http://your-nightscout-site.herokuapp.com',
    apiSecret: process.env.API_SECRET || 'your-api-secret'
  },
  loops: {
    interval: 5 * 60 * 1000 // 5 minutes
  }
};

// Create and start the loop
const loop = new Loop(config);

// Handle shutdown signals
process.on('SIGINT', () => {
  console.log('Caught interrupt signal');
  loop.stop();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Caught terminate signal');
  loop.stop();
  process.exit();
});

// Start the loop
loop.start()
  .catch(err => {
    console.error('Failed to start loop:', err);
    process.exit(1);
  });

console.log('CGM simulator started. Press Ctrl+C to exit.');