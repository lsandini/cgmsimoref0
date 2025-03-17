const cron = require(`node-cron`);

const loop = require(`./index.js`);

console.log(`CGM simulator started. Press Ctrl+C to exit.`);

const cronLoop = cron.schedule(
  `*/5 * * * *`,
  () => {
    loop();
  },
  false
);

cronLoop.start();
