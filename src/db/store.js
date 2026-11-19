const env = require('../config/env');

let store;

if (env.useSupabase) {
  store = require('./supabaseStore');
} else {
  try {
    // Only use SQLite if node:sqlite is supported by this Node runtime
    require('node:sqlite');
    store = require('./sqliteStore');
  } catch (err) {
    console.warn(
      '[DB] SUPABASE_URL not set and node:sqlite unavailable on this runtime; falling back to memoryStore:',
      err.message
    );
    store = require('./memoryStore');
  }
}

module.exports = store;
