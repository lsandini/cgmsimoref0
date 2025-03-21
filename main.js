require('dotenv').config();
const InMemoryLoop = require('./InMemoryLoop');
const config = require('./config');

// Create the loop instance
const loop = new InMemoryLoop(config);

// Start the loop
async function startApp() {
  try {
    console.log('Initializing OpenAPS loop...');
    await loop.start();
    console.log('OpenAPS loop running');
  } catch (error) {
    console.error('Error starting loop:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Stopping loop...');
  loop.stop();
  process.exit(0);
});

// Start the application
startApp();