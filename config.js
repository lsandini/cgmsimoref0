

module.exports = {
    nightscout: {
        url: process.env.NIGHTSCOUT_URL,
        apiSecret: process.env.API_SECRET
      },
    loop: {
      // Loop-specific settings
      runInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
      // Add any other settings you need
    }
  };

