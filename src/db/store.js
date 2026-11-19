const env = require('../config/env');

const store = env.useSupabase ? require('./supabaseStore') : require('./sqliteStore');

module.exports = store;

