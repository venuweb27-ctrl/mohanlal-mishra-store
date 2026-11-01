// SQLite data layer (better-sqlite3). Schema uses portable SQL so it can be moved to Postgres
// by swapping this module (see README "Switching to Postgres").
const Database = require('better-sqlite3');
const fs = require('fs'); const path = require('path');
const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('admin','vendor','customer')), status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS vendors(id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id), business_name TEXT NOT NULL,
  gstin TEXT, address TEXT, bank_account TEXT, ifsc TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','suspended','rejected')),
  commission_percent REAL, wallet_balance REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, icon TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, vendor_id INTEGER REFERENCES vendors(id), category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL, description TEXT, price REAL NOT NULL, mrp REAL, stock INTEGER NOT NULL DEFAULT 0, sku TEXT, brand TEXT, specs TEXT,
  image_url TEXT, is_top_seller INTEGER NOT NULL DEFAULT 0, sold_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS addresses(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT, phone TEXT,
  line1 TEXT, line2 TEXT, city TEXT, state TEXT, pincode TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, order_no TEXT UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'placed', payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
  subtotal REAL, tax REAL, shipping REAL, total REAL, ship_name TEXT, ship_phone TEXT, ship_address TEXT,
  logistics_partner_id INTEGER, tracking_id TEXT, delivery_status TEXT, settled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER REFERENCES products(id),
  vendor_id INTEGER, name TEXT, price REAL, qty INTEGER);
CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), status TEXT, note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), provider TEXT, provider_order_id TEXT,
  provider_payment_id TEXT, amount REAL, currency TEXT DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'created', raw TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id), invoice_no TEXT UNIQUE,
  file_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, company TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'new', source TEXT, assigned_to INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS call_logs(id INTEGER PRIMARY KEY, lead_id INTEGER REFERENCES leads(id), provider TEXT, provider_call_id TEXT,
  status TEXT, to_number TEXT, initiated_by INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS logistics_partners(id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_phone TEXT, tracking_url_template TEXT,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS wallet_transactions(id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL REFERENCES vendors(id), type TEXT, amount REAL,
  order_id INTEGER, withdrawal_id INTEGER, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL REFERENCES vendors(id), amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','rejected','paid')), admin_note TEXT, utr TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
module.exports = db;
