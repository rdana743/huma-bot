// Запуск ботов на сервере через PM2: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'huma-max-bot',
      script: 'src/index.js',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '300M',
      restart_delay: 5000,
    },
    {
      name: 'huma-tg-bot',
      script: 'src/tg.js',
      node_args: '--env-file=.env',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '300M',
      restart_delay: 5000,
    },
  ],
};
