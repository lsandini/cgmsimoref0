const cron = require(`node-cron`);

const loop = require(`./index.js`);

console.log(`CGM simulator started. Press Ctrl+C to exit.`);

const cronLoop = cron.schedule(
  `01,06,11,16,21,26,31,36,41,46,51,56 * * * *`,
  () => {
    loop();
  },
  false
);

cronLoop.start();
