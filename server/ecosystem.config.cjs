module.exports = {
  apps: [{
    name: 'alarmmini',
    cwd: __dirname,
    script: './src/main.js',
    node_args: ['--env-file=.env'],
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    restart_delay: 5000,
    kill_timeout: 10000,
    max_memory_restart: '200M',
    time: true,
  }],
};
