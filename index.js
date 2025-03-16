require('dotenv').config();
const Loop = require('./lib/loop');

// Configuration
const config = {
  nightscout: {
    url: process.env.NIGHTSCOUT_URL || 'http://your-nightscout-site.herokuapp.com',
    apiSecret: process.env.API_SECRET || 'your-api-secret'
  }
};

const loopInstance = new Loop(config);

// Initialize on load
loopInstance.initialize();

// Export a function that runs a cycle
module.exports = function() {
  return loopInstance.runCycle();
};