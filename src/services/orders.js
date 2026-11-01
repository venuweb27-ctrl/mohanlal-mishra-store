const db = require('../db');
const STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
const NEXT = { placed: ['confirmed', 'cancelled'], confirmed: ['packed', 'cancelled'], packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'], delivered: [], cancelled: [] };
function addEvent(orderId, status, note) { db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(orderId, status, note || null); }
const setStatus = db.transaction((orderId, status, note) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!o) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
  if (!NEXT[o.status].includes(status)) throw Object.assign(new Error(`Cannot move from ${o.status} to ${status}`), { status: 400 });
  db.prepare('UPDATE orders SET status=?, delivery_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, status, orderId);
  addEvent(orderId, status, note);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
  if (status === 'cancelled') items.forEach(i => db.prepare('UPDATE products SET stock=stock+?, sold_count=MAX(0,sold_count-?) WHERE id=?').run(i.qty, i.qty, i.product_id));
  if (status === 'delivered' && !o.settled) {
    if (o.payment_method === 'cod') db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(orderId);
    const defPct = Number(process.env.COMMISSION_PERCENT || 10); const per = {};
    items.forEach(i => { if (i.vendor_id) per[i.vendor_id] = (per[i.vendor_id] || 0) + i.price * i.qty; });
    for (const [vid, gross] of Object.entries(per)) {
      const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(vid);
      const pct = v.commission_percent ?? defPct; const net = +(gross * (1 - pct / 100)).toFixed(2);
      db.prepare('UPDATE vendors SET wallet_balance=wallet_balance+? WHERE id=?').run(net, vid);
      db.prepare("INSERT INTO wallet_transactions(vendor_id,type,amount,order_id,note) VALUES(?,'credit',?,?,?)").run(vid, net, orderId, `Order ${o.order_no}: ${gross} - ${pct}% commission`);
    }
    db.prepare('UPDATE orders SET settled=1 WHERE id=?').run(orderId);
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
});
function refreshTopSellers(limit = 6) {
  // Top seller = manual flag OR among top N by sold_count
  const ids = db.prepare('SELECT id FROM products WHERE active=1 ORDER BY sold_count DESC LIMIT ?').all(limit).map(r => r.id);
  return ids;
}
module.exports = { STATUSES, NEXT, setStatus, addEvent, refreshTopSellers };
