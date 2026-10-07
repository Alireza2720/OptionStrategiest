// ============================================================
// ecosystem.config.js — PM2 config for OptionStrategist
// ============================================================
// Loads .env from project root explicitly so PM2 gets the
// OPTIONS_CHAIN_PROXY_URL and other vars.
//
// Server usage:
//   cd ~/apps/OptionStrategiest
//   pm2 delete optionstrategiest
//   pm2 start ecosystem.config.js --update-env
//   pm2 save
// ============================================================

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8')
        .split('\n')
        .forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            const idx = line.indexOf('=');
            if (idx > 0) {
                const k = line.slice(0, idx).trim();
                let v = line.slice(idx + 1).trim();
                if (v.length >= 2 &&
                    ((v.startsWith('"') && v.endsWith('"')) ||
                     (v.startsWith("'") && v.endsWith("'")))) {
                    v = v.slice(1, -1);
                }
                envVars[k] = v;
            }
        });
}

module.exports = {
    apps: [{
        name: 'optionstrategiest',
        script: './backend/src/index.js',
        cwd: __dirname,
        exec_mode: 'fork',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '400M',
        env: Object.assign({ NODE_ENV: 'production' }, envVars),
        error_file: path.join(__dirname, 'logs', 'error.log'),
        out_file: path.join(__dirname, 'logs', 'out.log'),
        merge_logs: true,
        time: true,
    }]
};