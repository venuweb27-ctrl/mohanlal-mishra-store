// End-to-end API test. Runs against a fresh temp DB in mock payment/telephony mode.
const os = require('os'); const path = require('path'); const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlm-'));
Object.assign(process.env, { DB_FILE: path.join(tmp, 'test.db'), PAYMENT_PROVIDER: 'mock', TELEPHONY_PROVIDER: 'mock', JWT_SECRET: 'test' });
const app = require('../src/server');
let base, pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function api(method, url, body, token, raw) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r; const j = await r.json().catch(() => null); if (!r.ok) j.__status = r.status; return j;
}
(async () => {
  const srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`;
  try {
    console.log('Auth');
    const reg = await api('POST', '/api/auth/register', { name: 'Test Buyer', email: 'buyer@test.com', phone: '9876543210', password: 'secret123' });
    ok(reg.token && reg.user.role === 'customer', 'register customer');
    const login = await api('POST', '/api/auth/login', { email: 'buyer@test.com', password: 'secret123' }); const C = login.token;
    ok(!!C, 'login customer');
    ok((await api('POST', '/api/auth/login', { email: 'buyer@test.com', password: 'bad' })).__status === 401, 'bad password rejected');
    const A = (await api('POST', '/api/auth/login', { email: 'admin@mohanlalmishra.com', password: 'Admin@123' })).token; ok(!!A, 'admin login');
    const V = (await api('POST', '/api/auth/login', { email: 'vendor@mohanlalmishra.com', password: 'Vendor@123' })).token; ok(!!V, 'vendor login');
    ok((await api('GET', '/api/admin/users', null, C)).__status === 403, 'customer blocked from admin API');

    console.log('Catalog');
    const cats = await api('GET', '/api/categories'); ok(cats.length >= 8, `categories (${cats.length})`);
    const prods = await api('GET', '/api/products'); ok(prods.length >= 9, `products (${prods.length})`);
    const top = await api('GET', '/api/products?top=1'); ok(top.length > 0, `top sellers (${top.length})`);
    const srch = await api('GET', '/api/products?q=compressor'); ok(srch.length === 2, 'search "compressor"');
    const pump = prods.find(p => p.sku === 'PMP-5HP'); const grinder = prods.find(p => p.sku === 'PT-AG180');

    console.log('Vendor onboarding + product CRUD');
    const nv = await api('POST', '/api/auth/register', { name: 'New Vendor', email: 'nv@test.com', password: 'secret123', role: 'vendor', business_name: 'NV Tools' });
    ok((await api('POST', '/api/manage/products', { name: 'X', price: 1 }, nv.token)).__status === 403, 'pending vendor cannot list');
    const vend = (await api('GET', '/api/admin/vendors', null, A)).find(v => v.business_name === 'NV Tools');
    ok((await api('PUT', `/api/admin/vendors/${vend.id}`, { status: 'approved' }, A)).status === 'approved', 'admin approves vendor');
    const np = await api('POST', '/api/manage/products', { name: 'Bench Drill 13mm', price: 9000, stock: 5, category_id: cats[0].id }, nv.token); ok(np.id, 'vendor creates product');
    ok((await api('PUT', `/api/manage/products/${np.id}`, { price: 8500 }, nv.token)).price === 8500, 'vendor updates product');
    ok((await api('PUT', `/api/manage/products/${pump.id}`, { price: 1 }, nv.token)).__status === 403, 'vendor cannot edit others product');
    ok((await api('PUT', `/api/admin/vendors/${vend.id}`, { status: 'suspended' }, A)).status === 'suspended', 'admin suspends vendor');
    ok(!(await api('GET', '/api/products')).some(p => p.id === np.id), 'suspended vendor products hidden');

    console.log('Order flow (online/mock)');
    const addr = await api('POST', '/api/addresses', { name: 'Test Buyer', phone: '9876543210', line1: 'Plot 12, Industrial Area', city: 'Kanpur', state: 'Uttar Pradesh', pincode: '208001' }, C); ok(addr.id, 'save address');
    const quote = await api('POST', '/api/orders/quote', { items: [{ product_id: pump.id, qty: 2 }] }, C); ok(quote.total > 0, `quote total ₹${quote.total}`);
    const order = await api('POST', '/api/orders', { items: [{ product_id: pump.id, qty: 2 }, { product_id: grinder.id, qty: 1 }], address_id: addr.id, payment_method: 'online' }, C);
    ok(order.id && order.status === 'placed' && order.payment?.provider === 'mock', `order placed ${order.order_no}`);
    ok((await api('POST', '/api/payments/verify', { provider_order_id: order.payment.provider_order_id, provider_payment_id: 'pay_x', signature: 'wrong' }, C)).__status === 400, 'bad signature rejected');
    const retry = await api('POST', `/api/payments/retry/${order.id}`, null, C);
    const paid = await api('POST', '/api/payments/verify', { provider_order_id: retry.provider_order_id, provider_payment_id: 'pay_mock_1', signature: 'mock_signature' }, C);
    ok(paid.payment_status === 'paid', 'payment verified (mock) -> paid');
    const wh = await api('POST', '/api/payments/webhook', { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_mock_1', order_id: retry.provider_order_id } } } });
    ok(wh.ok, 'webhook accepted');
    ok((await api('GET', `/api/products/${pump.id}`)).stock === pump.stock - 2, 'stock decremented');

    console.log('Status, logistics, invoice');
    for (const s of ['confirmed', 'packed']) ok((await api('PUT', `/api/manage/orders/${order.id}/status`, { status: s }, A)).status === s, `status -> ${s}`);
    ok((await api('PUT', `/api/manage/orders/${order.id}/status`, { status: 'placed' }, A)).__status === 400, 'invalid transition rejected');
    const lps = await api('GET', '/api/admin/logistics', null, A); ok(lps.length >= 3, 'logistics partners');
    const newLp = await api('POST', '/api/admin/logistics', { name: 'Blue Dart', tracking_url_template: 'https://bd.example/{tracking_id}' }, A); ok(newLp.id, 'create logistics partner');
    const asg = await api('POST', `/api/admin/orders/${order.id}/assign-logistics`, { logistics_partner_id: newLp.id, tracking_id: 'BD123' }, A);
    ok(asg.tracking_id === 'BD123' && asg.tracking_url === 'https://bd.example/BD123', 'logistics assigned with tracking');
    ok((await api('POST', `/api/admin/orders/${order.id}/delivery-update`, { status: 'shipped', note: 'Picked up' }, A)).status === 'shipped', 'delivery update -> shipped');
    ok((await api('POST', `/api/admin/orders/${order.id}/delivery-update`, { status: 'In transit - Lucknow hub' }, A)).delivery_status.includes('Lucknow'), 'free-text tracking update');
    await api('PUT', `/api/manage/orders/${order.id}/status`, { status: 'out_for_delivery' }, A);
    const del = await api('PUT', `/api/manage/orders/${order.id}/status`, { status: 'delivered' }, A); ok(del.status === 'delivered', 'status -> delivered');
    const cust = await api('GET', `/api/orders/${order.id}`, null, C); ok(cust.events.length >= 7 && cust.status === 'delivered', `customer sees timeline (${cust.events.length} events)`);
    const inv = await api('GET', `/api/orders/${order.id}/invoice`, null, C, true); const buf = Buffer.from(await inv.arrayBuffer());
    ok(inv.ok && buf.slice(0, 4).toString() === '%PDF', `invoice PDF (${buf.length} bytes)`);

    console.log('COD + cancel');
    const cod = await api('POST', '/api/orders', { items: [{ product_id: grinder.id, qty: 1 }], address: { line1: 'X', city: 'Pune', pincode: '411001' }, payment_method: 'cod' }, C);
    ok(cod.payment_method === 'cod', 'COD order placed');
    ok((await api('POST', `/api/orders/${cod.id}/cancel`, null, C)).status === 'cancelled', 'customer cancels');

    console.log('CRM + calling');
    const lead = await api('POST', '/api/admin/leads', { name: 'Suresh', phone: '+919800000000', company: 'Suresh Steels', notes: 'Wants lathe', source: 'trade fair' }, A); ok(lead.id, 'lead saved');
    const call = await api('POST', `/api/admin/leads/${lead.id}/call`, {}, A); ok(call.provider === 'mock' && call.telLink === 'tel:+919800000000', 'mock call initiated');
    ok((await api('GET', `/api/admin/leads/${lead.id}/calls`, null, A)).length === 1, 'call logged');
    ok((await api('GET', '/api/admin/leads', null, A)).find(l => l.id === lead.id).status === 'contacted', 'lead status -> contacted');

    console.log('Wallet + withdrawals');
    const w = await api('GET', '/api/vendor/wallet', null, V); const expected = +((pump.price * 2 + grinder.price) * 0.9).toFixed(2);
    ok(Math.abs(w.vendor.wallet_balance - expected) < 0.01, `vendor credited ₹${w.vendor.wallet_balance} (gross minus 10%)`);
    ok((await api('POST', '/api/vendor/withdrawals', { amount: 1e9 }, V)).__status === 400, 'over-withdrawal rejected');
    const wr = await api('POST', '/api/vendor/withdrawals', { amount: 10000 }, V); ok(wr.status === 'requested', 'withdrawal requested');
    ok((await api('PUT', `/api/admin/withdrawals/${wr.id}`, { action: 'approve' }, A)).status === 'approved', 'admin approves');
    ok((await api('PUT', `/api/admin/withdrawals/${wr.id}`, { action: 'mark_paid', utr: 'UTR1' }, A)).status === 'paid', 'admin marks paid');
    const wr2 = await api('POST', '/api/vendor/withdrawals', { amount: 500 }, V);
    ok((await api('PUT', `/api/admin/withdrawals/${wr2.id}`, { action: 'reject', note: 'KYC' }, A)).status === 'rejected', 'admin rejects');
    const w2 = await api('GET', '/api/vendor/wallet', null, V); ok(Math.abs(w2.vendor.wallet_balance - (expected - 10000)) < 0.01, 'balance correct after payout + refund');

    console.log('User management');
    const users = await api('GET', '/api/admin/users', null, A); const b = users.find(u => u.email === 'buyer@test.com');
    ok((await api('PUT', `/api/admin/users/${b.id}`, { status: 'blocked' }, A)).status === 'blocked', 'block user');
    ok((await api('GET', '/api/me', null, C)).__status === 401, 'blocked user token rejected');
    const stats = await api('GET', '/api/admin/stats', null, A); ok(stats.orders === 2 && stats.revenue > 0, 'admin stats');
  } catch (e) { fail++; console.error(e); }
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
})();
