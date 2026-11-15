// PM2 process file: keeps the web app and the job worker running and restarts them on reboot.
module.exports = {
  apps: [
    { name: "tab-web", cwd: __dirname + "/..", script: "npm", args: "start", env: { NODE_ENV: "production", PORT: "3000" }, max_memory_restart: "700M" },
    { name: "tab-worker", cwd: __dirname + "/..", script: "npm", args: "run worker", env: { NODE_ENV: "production" }, max_memory_restart: "400M" },
  ],
};
