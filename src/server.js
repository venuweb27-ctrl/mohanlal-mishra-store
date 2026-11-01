require('dotenv').config();
const express = require('express'); const cors = require('cors'); const path = require('path'); const fs = require('fs');
const bcrypt = require('bcryptjs'); const jwt = require('jsonwebtoken'); const multer = require('multer');
const db = require('./db'); const seed = require('./seed');
const payments = require('./services/payments'); const telephony = require('./services/telephony');
const { generateInvoice } = require('./services/invoice'); const orders = require('./services/orders');
seed();
const app = express(); const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.set('trust proxy', true);
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));
const uploadDir = path.join(__dirname, '..', 'data', 'uploads'); fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_r, f, cb) => cb(null, Date.now() + '-' + f.originalname.replace(/[^\w.-]/g, '_')) }),
  limits: { fileSize: 5e6 }, fileFilter: (_r, f, cb) => cb(null, /^image\//.test(f.mimetype)) });
app.use('/uploads', express.static(uploadDir));
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));
app.use('/', express.static(path.join(__dirname, '..', 'web'))); // customer web storefront

const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const err = (status, message) => Object.assign(new Error(message), { status });
const sign = u => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '7d' });
const pub = u => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, created_at: u.created_at });
function auth(...roles) {
  return (req, _res, next) => {
    try {
      const t = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
      const p = jwt.verify(t, SECRET); const u = db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
      if (!u || u.status !== 'active') throw err(401, 'Account inactive');
      if (roles.length && !roles.includes(u.role)) throw err(403, 'Forbidden');
      req.user = u;
      if (u.role === 'vendor') req.vendor = db.prepare('SELECT * FROM vendors WHERE user_id=?').get(u.id);
      next();
    } catch (e) { next(e.status ? e : err(401, 'Unauthorized')); }
  };
}
const approvedVendor = (req, _res, next) => next(req.vendor && req.vendor.status === 'approved' ? undefined : err(403, 'Vendor not approved'));

// ---------- Auth ----------
app.post('/api/auth/register', h((req, res) => {
  const { name, email, phone, password, role = 'customer', business_name, gstin, address, bank_account, ifsc } = req.body;
  if (!name || !email || !password || password.length < 6) throw err(400, 'name, email and password (min 6) required');
  if (!['customer', 'vendor'].includes(role)) throw err(400, 'Invalid role');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) throw err(409, 'Email already registered');
  const id = db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)').run(name, email.toLowerCase(), phone, bcrypt.hashSync(password, 10), role).lastInsertRowid;
  if (role === 'vendor') db.prepare('INSERT INTO vendors(user_id,business_name,gstin,address,bank_account,ifsc) VALUES(?,?,?,?,?,?)').run(id, business_name || name, gstin, address, bank_account, ifsc);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id); res.status(201).json({ token: sign(u), user: pub(u) });
}));
app.post('/api/auth/login', h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash)) throw err(401, 'Invalid credentials');
  if (u.status !== 'active') throw err(403, 'Account ' + u.status);
  res.json({ token: sign(u), user: pub(u) });
}));
app.get('/api/me', auth(), (req, res) => res.json({ ...pub(req.user), vendor: req.vendor || null }));
app.put('/api/me', auth(), h((req, res) => {
  const { name, phone, password } = req.body;
  db.prepare('UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone) WHERE id=?').run(name, phone, req.user.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.user.id);
  res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
}));

// ---------- Catalog (public) ----------
const productSel = `SELECT p.*, c.name category_name, v.business_name vendor_name FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN vendors v ON v.id=p.vendor_id`;
app.get('/api/categories', (_q, res) => res.json(db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) product_count FROM categories c ORDER BY name').all()));
app.get('/api/products', (req, res) => {
  const { q, category_id, top, sort } = req.query; const w = ['p.active=1', "(v.status IS NULL OR v.status='approved')"]; const a = [];
  if (q) { w.push('(p.name LIKE ? OR p.description LIKE ? OR p.brand LIKE ?)'); a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category_id) { w.push('p.category_id=?'); a.push(category_id); }
  if (top) { const ids = orders.refreshTopSellers(); w.push(`(p.is_top_seller=1 OR p.id IN (${ids.join(',') || 0}))`); }
  const order = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', popular: 'p.sold_count DESC' }[sort] || 'p.created_at DESC, p.id DESC';
  res.json(db.prepare(`${productSel} WHERE ${w.join(' AND ')} ORDER BY ${top ? 'p.sold_count DESC' : order}`).all(...a));
});
app.get('/api/products/:id', h((req, res) => { const p = db.prepare(`${productSel} WHERE p.id=?`).get(req.params.id); if (!p) throw err(404, 'Not found'); res.json(p); }));

// ---------- Addresses ----------
app.get('/api/addresses', auth(), (req, res) => res.json(db.prepare('SELECT * FROM addresses WHERE user_id=?').all(req.user.id)));
app.post('/api/addresses', auth(), h((req, res) => {
  const { name, phone, line1, line2, city, state, pincode } = req.body; if (!line1 || !city || !pincode) throw err(400, 'line1, city, pincode required');
  const id = db.prepare('INSERT INTO addresses(user_id,name,phone,line1,line2,city,state,pincode) VALUES(?,?,?,?,?,?,?,?)').run(req.user.id, name, phone, line1, line2, city, state, pincode).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM addresses WHERE id=?').get(id));
}));

// ---------- Orders (customer) ----------
const GST = () => Number(process.env.GST_PERCENT || 18) / 100;
function orderDetail(id) {
  const o = db.prepare('SELECT o.*, l.name logistics_partner_name, l.tracking_url_template FROM orders o LEFT JOIN logistics_partners l ON l.id=o.logistics_partner_id WHERE o.id=?').get(id);
  if (!o) return null;
  o.items = db.prepare('SELECT oi.*, p.image_url FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE order_id=?').all(id);
  o.events = db.prepare('SELECT * FROM order_events WHERE order_id=? ORDER BY id').all(id);
  o.payments = db.prepare('SELECT id,provider,provider_order_id,provider_payment_id,amount,status,created_at FROM payments WHERE order_id=?').all(id);
  o.invoice = db.prepare('SELECT invoice_no, created_at FROM invoices WHERE order_id=?').get(id) || null;
  o.tracking_url = o.tracking_id && o.tracking_url_template ? o.tracking_url_template.replace('{tracking_id}', o.tracking_id) : null;
  return o;
}
app.post('/api/orders/quote', auth(), h((req, res) => res.json(price(req.body.items))));
function price(items) {
  if (!Array.isArray(items) || !items.length) throw err(400, 'items required');
  const lines = items.map(i => {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id); const qty = parseInt(i.qty, 10);
    if (!p) throw err(400, `Product ${i.product_id} unavailable`); if (!(qty > 0)) throw err(400, 'Invalid qty');
    if (p.stock < qty) throw err(400, `Insufficient stock for ${p.name}`);
    return { p, qty };
  });
  const subtotal = +lines.reduce((s, l) => s + l.p.price * l.qty, 0).toFixed(2);
  const tax = +(subtotal * GST()).toFixed(2); const shipping = subtotal >= 50000 ? 0 : 1500;
  return { lines, subtotal, tax, shipping, total: +(subtotal + tax + shipping).toFixed(2) };
}
app.post('/api/orders', auth('customer', 'admin'), h(async (req, res) => {
  const { items, address_id, address, payment_method = 'cod' } = req.body;
  if (!['cod', 'online'].includes(payment_method)) throw err(400, 'payment_method must be cod or online');
  let a = address_id ? db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(address_id, req.user.id) : address;
  if (!a || !a.line1 || !a.city || !a.pincode) throw err(400, 'Valid shipping address required');
  const q = price(items);
  const shipAddr = [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ');
  const id = db.transaction(() => {
    const oid = db.prepare(`INSERT INTO orders(user_id,payment_method,subtotal,tax,shipping,total,ship_name,ship_phone,ship_address,delivery_status) VALUES(?,?,?,?,?,?,?,?,?,'placed')`)
      .run(req.user.id, payment_method, q.subtotal, q.tax, q.shipping, q.total, a.name || req.user.name, a.phone || req.user.phone, shipAddr).lastInsertRowid;
    db.prepare('UPDATE orders SET order_no=? WHERE id=?').run('MLM' + String(100000 + Number(oid)), oid);
    for (const l of q.lines) {
      const r = db.prepare('UPDATE products SET stock=stock-?, sold_count=sold_count+? WHERE id=? AND stock>=?').run(l.qty, l.qty, l.p.id, l.qty);
      if (!r.changes) throw err(400, `Insufficient stock for ${l.p.name}`);
      db.prepare('INSERT INTO order_items(order_id,product_id,vendor_id,name,price,qty) VALUES(?,?,?,?,?,?)').run(oid, l.p.id, l.p.vendor_id, l.p.name, l.p.price, l.qty);
    }
    orders.addEvent(oid, 'placed', payment_method === 'cod' ? 'Order placed (Cash on Delivery)' : 'Order placed, awaiting payment');
    return oid;
  })();
  const out = orderDetail(id);
  if (payment_method === 'online') out.payment = await createPayment(out);
  res.status(201).json(out);
}));
async function createPayment(o) {
  const g = await payments.createGatewayOrder(o);
  db.prepare("INSERT INTO payments(order_id,provider,provider_order_id,amount,status) VALUES(?,?,?,?,'created')").run(o.id, g.provider, g.provider_order_id, o.total);
  return g;
}
app.get('/api/orders', auth(), (req, res) => res.json(db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.get('/api/orders/:id', auth(), h((req, res) => {
  const o = orderDetail(req.params.id); if (!o) throw err(404, 'Not found');
  if (req.user.role === 'customer' && o.user_id !== req.user.id) throw err(403, 'Forbidden');
  if (req.user.role === 'vendor' && !o.items.some(i => i.vendor_id === req.vendor?.id)) throw err(403, 'Forbidden');
  res.json(o);
}));
app.post('/api/orders/:id/cancel', auth('customer'), h((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!o) throw err(404, 'Not found');
  if (!['placed', 'confirmed'].includes(o.status)) throw err(400, 'Order can no longer be cancelled');
  orders.setStatus(o.id, 'cancelled', 'Cancelled by customer'); res.json(orderDetail(o.id));
}));
app.get('/api/orders/:id/invoice', auth(), h(async (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id); if (!o) throw err(404, 'Not found');
  if (req.user.role === 'customer' && o.user_id !== req.user.id) throw err(403, 'Forbidden');
  const inv = await generateInvoice(o.id); res.download(inv.file_path, `${o.order_no}-invoice.pdf`);
}));

// ---------- Payments ----------
app.get('/api/payments/config', (_q, res) => res.json({ provider: payments.provider(), key_id: payments.provider() === 'razorpay' ? process.env.RAZORPAY_KEY_ID : 'mock' }));
app.post('/api/payments/retry/:orderId', auth(), h(async (req, res) => {
  const o = orderDetail(req.params.orderId); if (!o || o.user_id !== req.user.id) throw err(404, 'Not found');
  if (o.payment_status === 'paid') throw err(400, 'Already paid'); res.json(await createPayment(o));
}));
function markPaid(pay, paymentId, raw) {
  db.prepare("UPDATE payments SET status='captured', provider_payment_id=?, raw=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(paymentId, JSON.stringify(raw || {}), pay.id);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(pay.order_id);
  if (o.payment_status !== 'paid') { db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(o.id); orders.addEvent(o.id, o.status, `Payment received (${pay.provider} ${paymentId})`); }
}
app.post('/api/payments/verify', auth(), h((req, res) => {
  const { provider_order_id, provider_payment_id, signature } = req.body;
  const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(provider_order_id); if (!pay) throw err(404, 'Payment not found');
  if (!payments.verifyCheckoutSignature({ provider_order_id, provider_payment_id, signature })) {
    db.prepare("UPDATE payments SET status='failed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pay.id);
    db.prepare("UPDATE orders SET payment_status='failed' WHERE id=?").run(pay.order_id); throw err(400, 'Signature verification failed');
  }
  markPaid(pay, provider_payment_id, req.body); res.json(orderDetail(pay.order_id));
}));
// Razorpay webhook (configure URL: https://<host>/api/payments/webhook, events: payment.captured, payment.failed)
app.post('/api/payments/webhook', h((req, res) => {
  if (!payments.verifyWebhookSignature(req.rawBody || '', req.headers['x-razorpay-signature'])) throw err(400, 'Invalid webhook signature');
  const ent = req.body?.payload?.payment?.entity || {}; const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(ent.order_id);
  if (pay) {
    if (req.body.event === 'payment.captured') markPaid(pay, ent.id, req.body);
    if (req.body.event === 'payment.failed') { db.prepare("UPDATE payments SET status='failed', raw=? WHERE id=?").run(JSON.stringify(req.body), pay.id); db.prepare("UPDATE orders SET payment_status='failed' WHERE id=? AND payment_status!='paid'").run(pay.order_id); }
  }
  res.json({ ok: true });
}));

// ---------- Admin: users & vendors ----------
const A = auth('admin');
app.get('/api/admin/stats', A, (_q, res) => res.json({
  users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='customer'").get().c, vendors: db.prepare('SELECT COUNT(*) c FROM vendors').get().c,
  products: db.prepare('SELECT COUNT(*) c FROM products').get().c, orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
  revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment_status='paid'").get().s,
  pending_withdrawals: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='requested'").get().c,
  leads: db.prepare('SELECT COUNT(*) c FROM leads').get().c }));
app.get('/api/admin/users', A, (req, res) => res.json(db.prepare(`SELECT id,name,email,phone,role,status,created_at FROM users ${req.query.role ? 'WHERE role=?' : ''} ORDER BY id DESC`).all(...(req.query.role ? [req.query.role] : []))));
app.post('/api/admin/users', A, h((req, res) => {
  const { name, email, phone, password, role } = req.body; if (!name || !email || !password || !['admin', 'vendor', 'customer'].includes(role)) throw err(400, 'Invalid input');
  const id = db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)').run(name, email.toLowerCase(), phone, bcrypt.hashSync(password, 10), role).lastInsertRowid;
  if (role === 'vendor') db.prepare("INSERT INTO vendors(user_id,business_name,status) VALUES(?,?,'approved')").run(id, req.body.business_name || name);
  res.status(201).json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
}));
app.put('/api/admin/users/:id', A, h((req, res) => {
  const { name, phone, status, role, password } = req.body;
  if (status && !['active', 'blocked'].includes(status)) throw err(400, 'status must be active|blocked');
  db.prepare('UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), status=COALESCE(?,status), role=COALESCE(?,role) WHERE id=?').run(name, phone, status, role, req.params.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id)));
}));
app.delete('/api/admin/users/:id', A, h((req, res) => {
  if (+req.params.id === req.user.id) throw err(400, 'Cannot delete yourself');
  db.prepare("UPDATE users SET status='deleted', email=email||'.deleted.'||id WHERE id=?").run(req.params.id); res.json({ ok: true });
}));
app.get('/api/admin/vendors', A, (_q, res) => res.json(db.prepare('SELECT v.*, u.name owner_name, u.email, u.phone FROM vendors v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC').all()));
app.put('/api/admin/vendors/:id', A, h((req, res) => {
  const { status, commission_percent, business_name } = req.body;
  if (status && !['pending', 'approved', 'suspended', 'rejected'].includes(status)) throw err(400, 'Invalid status');
  db.prepare('UPDATE vendors SET status=COALESCE(?,status), commission_percent=COALESCE(?,commission_percent), business_name=COALESCE(?,business_name) WHERE id=?').run(status, commission_percent, business_name, req.params.id);
  res.json(db.prepare('SELECT * FROM vendors WHERE id=?').get(req.params.id));
}));

// ---------- Products management (admin + vendor) ----------
const AV = auth('admin', 'vendor');
const ownGuard = (req, p) => { if (req.user.role === 'vendor' && p.vendor_id !== req.vendor?.id) throw err(403, 'Not your product'); };
app.get('/api/manage/products', AV, (req, res) => res.json(req.user.role === 'admin' ? db.prepare(`${productSel} ORDER BY p.id DESC`).all() : db.prepare(`${productSel} WHERE p.vendor_id=? ORDER BY p.id DESC`).all(req.vendor?.id)));
const PF = ['category_id', 'name', 'description', 'price', 'mrp', 'stock', 'sku', 'brand', 'specs', 'image_url', 'active'];
app.post('/api/manage/products', AV, (req, res, next) => req.user.role === 'vendor' ? approvedVendor(req, res, next) : next(), upload.single('image'), h((req, res) => {
  const b = req.body; if (!b.name || b.price == null) throw err(400, 'name and price required');
  if (req.file) b.image_url = '/uploads/' + req.file.filename;
  const vendorId = req.user.role === 'vendor' ? req.vendor.id : (b.vendor_id || null);
  const id = db.prepare(`INSERT INTO products(vendor_id,${PF.join(',')},is_top_seller) VALUES(?,${PF.map(() => '?').join(',')},?)`)
    .run(vendorId, ...PF.map(f => b[f] ?? (f === 'active' ? 1 : f === 'stock' ? 0 : null)), req.user.role === 'admin' && (b.is_top_seller == 1 || b.is_top_seller === 'true') ? 1 : 0).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id=?').get(id));
}));
app.put('/api/manage/products/:id', AV, upload.single('image'), h((req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id); if (!p) throw err(404, 'Not found'); ownGuard(req, p);
  const b = req.body; if (req.file) b.image_url = '/uploads/' + req.file.filename;
  const f = PF.filter(k => b[k] !== undefined); if (req.user.role === 'admin' && b.is_top_seller !== undefined) { f.push('is_top_seller'); b.is_top_seller = (b.is_top_seller == 1 || b.is_top_seller === 'true' || b.is_top_seller === true) ? 1 : 0; }
  if (f.length) db.prepare(`UPDATE products SET ${f.map(k => k + '=?').join(',')} WHERE id=?`).run(...f.map(k => b[k]), p.id);
  res.json(db.prepare('SELECT * FROM products WHERE id=?').get(p.id));
}));
app.delete('/api/manage/products/:id', AV, h((req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id); if (!p) throw err(404, 'Not found'); ownGuard(req, p);
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id); res.json({ ok: true });
}));
app.post('/api/admin/categories', A, h((req, res) => { if (!req.body.name) throw err(400, 'name required'); res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(db.prepare('INSERT INTO categories(name,icon) VALUES(?,?)').run(req.body.name, req.body.icon).lastInsertRowid)); }));
app.put('/api/admin/categories/:id', A, (req, res) => { db.prepare('UPDATE categories SET name=COALESCE(?,name), icon=COALESCE(?,icon) WHERE id=?').run(req.body.name, req.body.icon, req.params.id); res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id)); });
app.delete('/api/admin/categories/:id', A, h((req, res) => {
  if (db.prepare('SELECT COUNT(*) c FROM products WHERE category_id=?').get(req.params.id).c) throw err(400, 'Category has products');
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id); res.json({ ok: true });
}));

// ---------- Order management ----------
app.get('/api/manage/orders', AV, (req, res) => {
  const st = req.query.status; const a = [];
  let sql = 'SELECT o.*, u.name customer_name, l.name logistics_partner_name FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN logistics_partners l ON l.id=o.logistics_partner_id WHERE 1=1';
  if (req.user.role === 'vendor') { sql += ' AND o.id IN (SELECT order_id FROM order_items WHERE vendor_id=?)'; a.push(req.vendor?.id); }
  if (st) { sql += ' AND o.status=?'; a.push(st); }
  res.json(db.prepare(sql + ' ORDER BY o.id DESC').all(...a));
});
app.get('/api/manage/orders/:id', AV, h((req, res) => {
  const o = orderDetail(req.params.id); if (!o) throw err(404, 'Not found');
  if (req.user.role === 'vendor' && !o.items.some(i => i.vendor_id === req.vendor?.id)) throw err(403, 'Forbidden'); res.json(o);
}));
app.put('/api/manage/orders/:id/status', AV, h((req, res) => {
  const o = orderDetail(req.params.id); if (!o) throw err(404, 'Not found');
  if (req.user.role === 'vendor') { if (!o.items.some(i => i.vendor_id === req.vendor?.id)) throw err(403, 'Forbidden'); if (!['confirmed', 'packed'].includes(req.body.status)) throw err(403, 'Vendors may only confirm/pack'); }
  orders.setStatus(o.id, req.body.status, req.body.note); res.json(orderDetail(o.id));
}));
app.post('/api/admin/orders/:id/invoice', A, h(async (req, res) => res.json(await generateInvoice(+req.params.id))));
app.get('/api/order-statuses', (_q, res) => res.json({ statuses: orders.STATUSES, transitions: orders.NEXT }));

// ---------- Logistics ----------
app.get('/api/admin/logistics', A, (_q, res) => res.json(db.prepare('SELECT * FROM logistics_partners ORDER BY id').all()));
app.post('/api/admin/logistics', A, h((req, res) => { const { name, contact_phone, tracking_url_template } = req.body; if (!name) throw err(400, 'name required');
  res.status(201).json(db.prepare('SELECT * FROM logistics_partners WHERE id=?').get(db.prepare('INSERT INTO logistics_partners(name,contact_phone,tracking_url_template) VALUES(?,?,?)').run(name, contact_phone, tracking_url_template).lastInsertRowid)); }));
app.put('/api/admin/logistics/:id', A, (req, res) => { const { name, contact_phone, tracking_url_template, active } = req.body;
  db.prepare('UPDATE logistics_partners SET name=COALESCE(?,name), contact_phone=COALESCE(?,contact_phone), tracking_url_template=COALESCE(?,tracking_url_template), active=COALESCE(?,active) WHERE id=?').run(name, contact_phone, tracking_url_template, active, req.params.id);
  res.json(db.prepare('SELECT * FROM logistics_partners WHERE id=?').get(req.params.id)); });
app.post('/api/admin/orders/:id/assign-logistics', A, h((req, res) => {
  const { logistics_partner_id, tracking_id } = req.body; const lp = db.prepare('SELECT * FROM logistics_partners WHERE id=? AND active=1').get(logistics_partner_id);
  if (!lp) throw err(400, 'Invalid logistics partner'); const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id); if (!o) throw err(404, 'Not found');
  db.prepare('UPDATE orders SET logistics_partner_id=?, tracking_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(lp.id, tracking_id || null, o.id);
  orders.addEvent(o.id, o.status, `Assigned to ${lp.name}${tracking_id ? ' (Tracking ' + tracking_id + ')' : ''}`); res.json(orderDetail(o.id));
}));
// Delivery status update (admin, or partner integration hitting this with admin token)
app.post('/api/admin/orders/:id/delivery-update', A, h((req, res) => {
  const { status, note } = req.body; const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id); if (!o) throw err(404, 'Not found');
  if (orders.STATUSES.includes(status) && status !== o.status) orders.setStatus(o.id, status, note);
  else { db.prepare('UPDATE orders SET delivery_status=? WHERE id=?').run(status, o.id); orders.addEvent(o.id, o.status, note || status); }
  res.json(orderDetail(o.id));
}));

// ---------- CRM leads + calling ----------
app.get('/api/admin/leads', A, (req, res) => res.json(db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM call_logs c WHERE c.lead_id=l.id) call_count FROM leads l ${req.query.status ? 'WHERE status=?' : ''} ORDER BY id DESC`).all(...(req.query.status ? [req.query.status] : []))));
app.post('/api/leads', h((req, res) => { // public enquiry form (from app) as well
  const { name, phone, email, company, notes, source } = req.body; if (!name || !phone) throw err(400, 'name and phone required');
  res.status(201).json(db.prepare('SELECT * FROM leads WHERE id=?').get(db.prepare('INSERT INTO leads(name,phone,email,company,notes,source) VALUES(?,?,?,?,?,?)').run(name, phone, email, company, notes, source || 'app').lastInsertRowid));
}));
app.post('/api/admin/leads', A, h((req, res) => {
  const { name, phone, email, company, notes, status = 'new', source = 'manual' } = req.body; if (!name || !phone) throw err(400, 'name and phone required');
  res.status(201).json(db.prepare('SELECT * FROM leads WHERE id=?').get(db.prepare('INSERT INTO leads(name,phone,email,company,notes,status,source) VALUES(?,?,?,?,?,?,?)').run(name, phone, email, company, notes, status, source).lastInsertRowid));
}));
app.put('/api/admin/leads/:id', A, (req, res) => { const f = ['name', 'phone', 'email', 'company', 'notes', 'status', 'source'].filter(k => req.body[k] !== undefined);
  if (f.length) db.prepare(`UPDATE leads SET ${f.map(k => k + '=?').join(',')} WHERE id=?`).run(...f.map(k => req.body[k]), req.params.id);
  res.json(db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id)); });
app.delete('/api/admin/leads/:id', A, (req, res) => { db.prepare('DELETE FROM call_logs WHERE lead_id=?').run(req.params.id); db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.post('/api/admin/leads/:id/call', A, h(async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id); if (!lead) throw err(404, 'Not found');
  let r; try { r = await telephony.getProvider(req.body.provider).call({ to: lead.phone, leadId: lead.id }); }
  catch (e) { r = { provider: 'tel', callId: null, status: 'failed: ' + e.message, telLink: `tel:${lead.phone}` }; }
  db.prepare('INSERT INTO call_logs(lead_id,provider,provider_call_id,status,to_number,initiated_by) VALUES(?,?,?,?,?,?)').run(lead.id, r.provider, r.callId, r.status, lead.phone, req.user.id);
  if (lead.status === 'new') db.prepare("UPDATE leads SET status='contacted' WHERE id=?").run(lead.id);
  res.json(r);
}));
app.get('/api/admin/leads/:id/calls', A, (req, res) => res.json(db.prepare('SELECT * FROM call_logs WHERE lead_id=? ORDER BY id DESC').all(req.params.id)));

// ---------- Vendor wallet & withdrawals ----------
app.get('/api/vendor/wallet', auth('vendor'), (req, res) => res.json({ vendor: req.vendor,
  transactions: db.prepare('SELECT * FROM wallet_transactions WHERE vendor_id=? ORDER BY id DESC').all(req.vendor.id),
  withdrawals: db.prepare('SELECT * FROM withdrawals WHERE vendor_id=? ORDER BY id DESC').all(req.vendor.id) }));
app.post('/api/vendor/withdrawals', auth('vendor'), approvedVendor, h((req, res) => {
  const amount = Number(req.body.amount); if (!(amount > 0)) throw err(400, 'Invalid amount');
  const id = db.transaction(() => {
    const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(req.vendor.id); if (v.wallet_balance < amount) throw err(400, 'Insufficient balance');
    db.prepare('UPDATE vendors SET wallet_balance=wallet_balance-? WHERE id=?').run(amount, v.id); // hold funds
    const wid = db.prepare('INSERT INTO withdrawals(vendor_id,amount) VALUES(?,?)').run(v.id, amount).lastInsertRowid;
    db.prepare("INSERT INTO wallet_transactions(vendor_id,type,amount,withdrawal_id,note) VALUES(?,'debit_hold',?,?,'Withdrawal requested')").run(v.id, -amount, wid);
    return wid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id));
}));
app.get('/api/admin/withdrawals', A, (_q, res) => res.json(db.prepare('SELECT w.*, v.business_name, v.bank_account, v.ifsc, v.wallet_balance FROM withdrawals w JOIN vendors v ON v.id=w.vendor_id ORDER BY w.id DESC').all()));
app.put('/api/admin/withdrawals/:id', A, h((req, res) => {
  const { action, note, utr } = req.body; const w = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id); if (!w) throw err(404, 'Not found');
  const allowed = { approve: ['requested'], reject: ['requested', 'approved'], mark_paid: ['approved'] };
  if (!allowed[action] || !allowed[action].includes(w.status)) throw err(400, `Cannot ${action} a ${w.status} withdrawal`);
  db.transaction(() => {
    const st = { approve: 'approved', reject: 'rejected', mark_paid: 'paid' }[action];
    db.prepare('UPDATE withdrawals SET status=?, admin_note=COALESCE(?,admin_note), utr=COALESCE(?,utr), updated_at=CURRENT_TIMESTAMP WHERE id=?').run(st, note, utr, w.id);
    if (action === 'reject') { db.prepare('UPDATE vendors SET wallet_balance=wallet_balance+? WHERE id=?').run(w.amount, w.vendor_id);
      db.prepare("INSERT INTO wallet_transactions(vendor_id,type,amount,withdrawal_id,note) VALUES(?,'refund',?,?,'Withdrawal rejected')").run(w.vendor_id, w.amount, w.id); }
    if (action === 'mark_paid') db.prepare("INSERT INTO wallet_transactions(vendor_id,type,amount,withdrawal_id,note) VALUES(?,'payout',0,?,?)").run(w.vendor_id, w.id, 'Paid out, UTR ' + (utr || '-'));
  })();
  res.json(db.prepare('SELECT * FROM withdrawals WHERE id=?').get(w.id));
}));

app.get('/api/health', (_q, res) => res.json({ ok: true, payment_provider: payments.provider(), telephony: process.env.TELEPHONY_PROVIDER || 'mock' }));
app.use((e, _req, res, _next) => { if (!e.status) console.error(e); res.status(e.status || (/UNIQUE/.test(e.message) ? 409 : 500)).json({ error: e.message }); });
const PORT = process.env.PORT || 4000;
if (require.main === module) app.listen(PORT, () => console.log(`Mohan Lal Mishra API on http://localhost:${PORT} (admin panel /admin)`));
module.exports = app;
