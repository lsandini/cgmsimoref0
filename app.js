const cron = require('node-cron');
const mpc = require('./mpc.js');

console.log(`CGM simulator started. Press Ctrl+C to exit.`);

const cronLoop = cron.schedule(
  '*/5 * * * *',  // Run every 5 minutes
  async () => {
    try {
      console.log(`Running loop at: ${new Date().toISOString()}`);
      await mpc();
    } catch (error) {
      console.error('Error in cron loop:', error);
    }
  },
  {
    scheduled: false,  // Don't start automatically
    timezone: "UTC"   // Optional: set timezone if needed
  }
);

// Start the cron job
cronLoop.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Stopping cron loop...');
  cronLoop.stop();
  process.exit(0);
});