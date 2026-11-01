'use strict';
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const S = { get token() { return localStorage.mlm_token }, set token(v) { v ? localStorage.mlm_token = v : localStorage.removeItem('mlm_token') },
  get user() { try { return JSON.parse(localStorage.mlm_user) } catch { return null } }, set user(v) { v ? localStorage.mlm_user = JSON.stringify(v) : localStorage.removeItem('mlm_user') },
  get cart() { try { return JSON.parse(localStorage.mlm_cart) || [] } catch { return [] } }, set cart(v) { localStorage.mlm_cart = JSON.stringify(v); badge() } };
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 2600) }
async function api(path, opt = {}) {
  const h = { 'Content-Type': 'application/json' }; if (S.token) h.Authorization = 'Bearer ' + S.token;
  const r = await fetch('/api/' + path, { ...opt, headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { S.token = null; S.user = null; hdr(); location.hash = '#/account'; }
  if (!r.ok) throw new Error(d.error || 'Request failed'); return d;
}
function badge() { $('#cc').textContent = S.cart.reduce((s, i) => s + i.qty, 0) }
function hdr() { $('#acct').textContent = S.user ? 'Hi, ' + S.user.name.split(' ')[0] : 'Login'; badge() }
function addCart(p, qty = 1) { const c = S.cart, e = c.find(i => i.id === p.id); if (e) e.qty = Math.min(e.qty + qty, p.stock); else c.push({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, stock: p.stock, qty }); S.cart = c; toast('Added to cart') }
const need = () => { if (!S.token) { sessionStorage.after = location.hash; location.hash = '#/account'; return true } };
const card = p => `<div class="card"><a href="#/p/${p.id}"><img loading="lazy" src="${esc(p.image_url)}" alt="${esc(p.name)}"></a><div class="c">
${p.is_top_seller ? '<span class="tag">TOP SELLER</span>' : ''}<a class="n" href="#/p/${p.id}">${esc(p.name)}</a><small class="muted">${esc(p.brand || '')} · ${esc(p.category_name || '')}</small>
<div><span class="price">${inr(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${inr(p.mrp)}</span>` : ''}</div>
${p.stock > 0 ? `<button class="btn s" data-add="${p.id}">Add to cart</button>` : '<span class="muted">Out of stock</span>'}</div></div>`;
let pcache = {};
function bindAdd(list) { list.forEach(p => pcache[p.id] = p); app.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addCart(pcache[b.dataset.add])) }

const V = {
  async home() {
    const [cats, top] = await Promise.all([api('categories'), api('products?top=1')]);
    app.innerHTML = `<section class="hero"><h1>Industrial machinery, delivered.</h1><p>CNC machines, lathes, compressors, generators, pumps and more from verified vendors — GST invoice, COD and secure online payment.</p>
<a class="btn" href="#/products">Shop all equipment</a> <a class="btn o" href="#/enquiry">Request a call back</a></section>
<h2>Categories</h2><div class="cats">${cats.map(c => `<a class="cat" href="#/products?category_id=${c.id}">${esc(c.name)}<small>${c.product_count} products</small></a>`).join('')}</div>
<h2>Top Sellers</h2><div class="grid">${top.map(card).join('')}</div>`; bindAdd(top);
  },
  async products(qs) {
    const cats = await api('categories'); const f = Object.fromEntries(qs);
    app.innerHTML = `<h2>Products</h2><div class="filters"><input id="fq" placeholder="Search" value="${esc(f.q || '')}">
<select id="fc"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${f.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
<select id="fs"><option value="">Newest</option><option value="popular">Popular</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select>
<input id="fmax" type="number" placeholder="Max price ₹" value="${esc(f.max || '')}"></div><div id="res" class="grid"></div>`;
    $('#fs').value = f.sort || '';
    const go = () => { const p = new URLSearchParams(); [['q', '#fq'], ['category_id', '#fc'], ['sort', '#fs'], ['max', '#fmax']].forEach(([k, s]) => $(s).value && p.set(k, $(s).value)); location.hash = '#/products?' + p };
    ['#fc', '#fs', '#fmax'].forEach(s => $(s).onchange = go); $('#fq').onkeydown = e => e.key === 'Enter' && go();
    const p = new URLSearchParams(); ['q', 'category_id', 'sort'].forEach(k => f[k] && p.set(k, f[k]));
    let list = await api('products?' + p); if (f.max) list = list.filter(x => x.price <= +f.max);
    $('#res').innerHTML = list.length ? list.map(card).join('') : '<p class="muted">No products found.</p>'; bindAdd(list);
  },
  async p(_, id) {
    const p = await api('products/' + id); pcache[p.id] = p;
    app.innerHTML = `<p><a href="#/products">← Back to products</a></p><div class="pd"><img src="${esc(p.image_url)}" alt="${esc(p.name)}"><div class="panel">
${p.is_top_seller ? '<span class="tag">TOP SELLER</span>' : ''}<h1>${esc(p.name)}</h1><p class="muted">${esc(p.brand || '')} · ${esc(p.category_name || '')} · SKU ${esc(p.sku || '-')}</p>
<p><span class="price">${inr(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${inr(p.mrp)}</span> <span class="tag">${Math.round(100 - p.price / p.mrp * 100)}% off</span>` : ''}<br><small class="muted">+ GST. Sold by ${esc(p.vendor_name || 'Mohan Lal Mishra')}</small></p>
<p>${esc(p.description || '')}</p>${p.specs ? `<h3>Specifications</h3><ul>${p.specs.split(/;\s*/).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
<p>${p.stock > 0 ? `<b style="color:var(--ok)">In stock</b> (${p.stock})` : '<b style="color:var(--er)">Out of stock</b>'}</p>
${p.stock > 0 ? `<div class="qty"><button id="qm">−</button><b id="qv">1</b><button id="qp">+</button></div><p><button class="btn s" id="add">Add to cart</button> <button class="btn" id="buy">Buy now</button></p>` : ''}
<p><a href="#/enquiry?product=${encodeURIComponent(p.name)}">Need a quote or bulk pricing? Request a call back →</a></p></div></div>`;
    if (p.stock > 0) { let q = 1; const u = () => $('#qv').textContent = q; $('#qm').onclick = () => { q = Math.max(1, q - 1); u() }; $('#qp').onclick = () => { q = Math.min(p.stock, q + 1); u() };
      $('#add').onclick = () => addCart(p, q); $('#buy').onclick = () => { addCart(p, q); location.hash = '#/cart' } }
  },
  async cart() {
    const c = S.cart; if (!c.length) { app.innerHTML = '<div class="panel"><h2>Your cart is empty</h2><a class="btn" href="#/products">Browse products</a></div>'; return }
    let q = null; if (S.token) q = await api('orders/quote', { method: 'POST', body: { items: c.map(i => ({ product_id: i.id, qty: i.qty })) } }).catch(e => ({ err: e.message }));
    const sub = c.reduce((s, i) => s + i.price * i.qty, 0);
    app.innerHTML = `<h2>Cart</h2><div class="panel">${c.map((i, k) => `<div class="li"><img src="${esc(i.image_url)}" alt=""><div class="g"><a href="#/p/${i.id}">${esc(i.name)}</a><br>${inr(i.price)}</div>
<div class="qty"><button data-d="${k}">−</button><b>${i.qty}</b><button data-i="${k}">+</button></div><button class="btn o" data-r="${k}">Remove</button></div>`).join('')}</div>
<div class="panel">${q && !q.err ? totals(q) : `<p>Subtotal: <b>${inr(sub)}</b> <small class="muted">(GST & shipping at checkout)</small></p>`}${q?.err ? `<p style="color:var(--er)">${esc(q.err)}</p>` : ''}
<a class="btn" href="#/checkout">Proceed to checkout</a></div>`;
    const m = (k, f) => { const x = S.cart; f(x, +k); S.cart = x.filter(i => i.qty > 0); V.cart() };
    app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => m(b.dataset.d, (x, k) => x[k].qty--));
    app.querySelectorAll('[data-i]').forEach(b => b.onclick = () => m(b.dataset.i, (x, k) => x[k].qty = Math.min(x[k].stock || 999, x[k].qty + 1)));
    app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => m(b.dataset.r, (x, k) => x[k].qty = 0));
  },
  async checkout() {
    if (need()) return; if (!S.cart.length) { location.hash = '#/cart'; return }
    const st = { step: 1, addr: null, pm: 'online' }; const addrs = await api('addresses'); const cfg = await api('payments/config');
    const items = () => S.cart.map(i => ({ product_id: i.id, qty: i.qty }));
    const render = async () => {
      const steps = ['Address', 'Payment', 'Review'].map((s, i) => `<span class="${i + 1 <= st.step ? 'on' : ''}">${i + 1}. ${s}</span>`).join('');
      let body = '';
      if (st.step === 1) body = `<h3>Delivery address</h3>${addrs.map(a => `<label class="radio"><input type="radio" name="ad" value="${a.id}" ${st.addr?.id === a.id ? 'checked' : ''}> <b>${esc(a.name)}</b> ${esc(a.phone || '')}<br>${esc([a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '))}</label>`).join('')}
<details ${addrs.length ? '' : 'open'}><summary><b>+ Add new address</b></summary><form id="af" class="f"><div class="row2"><div><label>Full name</label><input name="name" required value="${esc(S.user.name)}"></div><div><label>Phone</label><input name="phone" required pattern="[0-9+ ]{10,14}" value="${esc(S.user.phone || '')}"></div></div>
<label>Address line 1</label><input name="line1" required><label>Address line 2</label><input name="line2"><div class="row2"><div><label>City</label><input name="city" required></div><div><label>State</label><input name="state" required></div></div><label>Pincode</label><input name="pincode" required pattern="[0-9]{6}"><p><button class="btn s">Save address</button></p></form></details>
<p><button class="btn" id="nx">Continue</button></p>`;
      if (st.step === 2) body = `<h3>Payment method</h3><label class="radio"><input type="radio" name="pm" value="online" ${st.pm === 'online' ? 'checked' : ''}> <b>Pay online</b> — UPI, cards, netbanking (Razorpay${cfg.provider === 'mock' ? ', test mode' : ''})</label>
<label class="radio"><input type="radio" name="pm" value="cod" ${st.pm === 'cod' ? 'checked' : ''}> <b>Cash on Delivery</b></label><p><button class="btn o" id="bk">Back</button> <button class="btn" id="nx">Continue</button></p>`;
      if (st.step === 3) { const q = await api('orders/quote', { method: 'POST', body: { items: items() } });
        body = `<h3>Review order</h3>${S.cart.map(i => `<div class="li"><img src="${esc(i.image_url)}" alt=""><div class="g">${esc(i.name)}<br><small>${i.qty} × ${inr(i.price)}</small></div><b>${inr(i.qty * i.price)}</b></div>`).join('')}
<p><b>Deliver to:</b> ${esc(st.addr.name)}, ${esc([st.addr.line1, st.addr.city, st.addr.pincode].join(', '))}<br><b>Payment:</b> ${st.pm === 'cod' ? 'Cash on Delivery' : 'Online'}</p>${totals(q)}
<p><button class="btn o" id="bk">Back</button> <button class="btn" id="po">Place order · ${inr(q.total)}</button></p>` }
      app.innerHTML = `<h2>Checkout</h2><div class="steps">${steps}</div><div class="panel">${body}</div>`;
      $('#bk') && ($('#bk').onclick = () => { st.step--; render() });
      if (st.step === 1) { $('#af').onsubmit = async e => { e.preventDefault(); try { const a = await api('addresses', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); addrs.push(a); st.addr = a; render() } catch (x) { toast(x.message) } };
        $('#nx').onclick = () => { const v = app.querySelector('[name=ad]:checked'); if (!v) return toast('Select or add an address'); st.addr = addrs.find(a => a.id == v.value); st.step = 2; render() } }
      if (st.step === 2) $('#nx').onclick = () => { st.pm = app.querySelector('[name=pm]:checked').value; st.step = 3; render() };
      if (st.step === 3) $('#po').onclick = async e => { e.target.disabled = true; try {
        const o = await api('orders', { method: 'POST', body: { items: items(), address_id: st.addr.id, payment_method: st.pm } }); S.cart = [];
        if (st.pm === 'online') await pay(o, o.payment); location.hash = '#/done/' + o.id } catch (x) { toast(x.message); e.target.disabled = false } };
    };
    render();
  },
  async done(_, id) { const o = await api('orders/' + id);
    app.innerHTML = `<div class="panel" style="text-align:center"><h1 style="color:var(--ok)">✓ Order placed</h1><p>Order <b>${esc(o.order_no)}</b> · ${inr(o.total)}</p><p>Payment: <span class="st ${o.payment_status}">${o.payment_status}</span> (${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'})</p>
${o.payment_method === 'online' && o.payment_status !== 'paid' ? `<button class="btn" id="rp">Retry payment</button> ` : ''}<a class="btn s" href="#/order/${o.id}">Track order</a> <a class="btn o" href="#/products">Continue shopping</a></div>`;
    $('#rp') && ($('#rp').onclick = async () => { try { await pay(o, await api('payments/retry/' + o.id, { method: 'POST' })); V.done(0, id) } catch (x) { toast(x.message) } }) },
  async orders() { if (need()) return; const os = await api('orders');
    app.innerHTML = `<h2>My orders</h2>${os.length ? os.map(o => `<a class="panel" style="display:block;color:inherit" href="#/order/${o.id}"><b>${esc(o.order_no)}</b> · ${inr(o.total)} <span class="st ${o.status}">${o.status.replace(/_/g, ' ')}</span> <span class="st ${o.payment_status}">${o.payment_status}</span><br><small class="muted">${esc(o.created_at)} · ${o.payment_method.toUpperCase()}</small></a>`).join('') : '<div class="panel">No orders yet. <a href="#/products">Start shopping</a></div>'}` },
  async order(_, id) { if (need()) return; const o = await api('orders/' + id);
    app.innerHTML = `<p><a href="#/orders">← My orders</a></p><div class="panel"><h2 style="margin-top:0">${esc(o.order_no)} <span class="st ${o.status}">${o.status.replace(/_/g, ' ')}</span></h2>
<p class="muted">Placed ${esc(o.created_at)} · Payment ${o.payment_method.toUpperCase()} <span class="st ${o.payment_status}">${o.payment_status}</span></p>
${o.items.map(i => `<div class="li"><img src="${esc(i.image_url)}" alt=""><div class="g">${esc(i.name)}<br><small>${i.qty} × ${inr(i.price)}</small></div></div>`).join('')}
${totals(o)}<p><b>Ship to:</b> ${esc(o.ship_name)}, ${esc(o.ship_address)}</p>
${o.logistics_partner_name ? `<p><b>Courier:</b> ${esc(o.logistics_partner_name)} · ${esc(o.tracking_id || '')} ${o.tracking_url ? `<a target="_blank" rel="noopener" href="${esc(o.tracking_url)}">Track shipment</a>` : ''}</p>` : ''}
<p><button class="btn s" id="inv">Download invoice</button> ${['placed', 'confirmed'].includes(o.status) ? '<button class="btn d" id="cn">Cancel order</button>' : ''}
${o.payment_method === 'online' && o.payment_status !== 'paid' && o.status !== 'cancelled' ? '<button class="btn" id="rp">Pay now</button>' : ''}</p></div>
<div class="panel"><h3>Status timeline</h3><ul class="tl">${o.events.map(e => `<li><b>${esc((e.status || '').replace(/_/g, ' '))}</b> — ${esc(e.note || '')}<br><small class="muted">${esc(e.created_at)}</small></li>`).join('')}</ul></div>`;
    $('#inv').onclick = async () => { try { const r = await fetch('/api/orders/' + id + '/invoice', { headers: { Authorization: 'Bearer ' + S.token } }); if (!r.ok) throw new Error('Invoice failed');
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = o.order_no + '-invoice.pdf'; a.click() } catch (x) { toast(x.message) } };
    $('#cn') && ($('#cn').onclick = async () => { if (!confirm('Cancel this order?')) return; try { await api('orders/' + id + '/cancel', { method: 'POST' }); toast('Order cancelled'); V.order(0, id) } catch (x) { toast(x.message) } });
    $('#rp') && ($('#rp').onclick = async () => { try { await pay(o, await api('payments/retry/' + o.id, { method: 'POST' })); V.order(0, id) } catch (x) { toast(x.message) } });
    clearTimeout(V._t); V._t = setTimeout(() => location.hash === '#/order/' + id && V.order(0, id), 20000) },
  async account() {
    if (S.user) { const u = await api('me'); S.user = u; hdr();
      app.innerHTML = `<h2>My profile</h2><div class="panel"><form id="pf" class="f"><label>Name</label><input name="name" value="${esc(u.name)}" required><label>Email</label><input value="${esc(u.email)}" disabled><label>Phone</label><input name="phone" value="${esc(u.phone || '')}">
<label>New password (optional)</label><input name="password" type="password" minlength="6"><p><button class="btn s">Save</button> <button type="button" class="btn o" id="lo">Logout</button></p></form></div><p><a href="#/orders">My orders →</a></p>`;
      $('#pf').onsubmit = async e => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); if (!b.password) delete b.password; try { S.user = await api('me', { method: 'PUT', body: b }); hdr(); toast('Profile saved') } catch (x) { toast(x.message) } };
      $('#lo').onclick = () => { S.token = null; S.user = null; hdr(); location.hash = '#/' }; return }
    const mode = sessionStorage.mode || 'login';
    app.innerHTML = `<div class="panel" style="max-width:440px;margin:auto"><h2 style="margin-top:0">${mode === 'login' ? 'Login' : 'Create account'}</h2><form id="lf" class="f">
${mode === 'login' ? '' : '<label>Full name</label><input name="name" required><label>Phone</label><input name="phone" required>'}<label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" minlength="6" required>
<p><button class="btn s" style="width:100%">${mode === 'login' ? 'Login' : 'Sign up'}</button></p></form><p>${mode === 'login' ? 'New here? <a href="#" id="sw">Create an account</a>' : 'Have an account? <a href="#" id="sw">Login</a>'}</p>
<p class="muted"><small>Vendor or admin? <a href="/admin/">Go to the Vendor / Admin panel</a></small></p></div>`;
    $('#sw').onclick = e => { e.preventDefault(); sessionStorage.mode = mode === 'login' ? 'signup' : 'login'; V.account() };
    $('#lf').onsubmit = async e => { e.preventDefault(); try { const r = await api(mode === 'login' ? 'auth/login' : 'auth/register', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      S.token = r.token; S.user = r.user; hdr(); toast('Welcome, ' + r.user.name); const n = sessionStorage.after; sessionStorage.removeItem('after'); location.hash = n || '#/' } catch (x) { toast(x.message) } } },
  async enquiry(qs) { const u = S.user || {}; const prod = qs.get('product') || '';
    app.innerHTML = `<div class="panel" style="max-width:560px;margin:auto"><h2 style="margin-top:0">Request a call back</h2><p class="muted">Tell us what you need — our sales team will call you with pricing, specs and delivery timelines.</p>
<form id="ef" class="f"><div class="row2"><div><label>Name *</label><input name="name" required value="${esc(u.name || '')}"></div><div><label>Phone *</label><input name="phone" required value="${esc(u.phone || '')}"></div></div>
<div class="row2"><div><label>Email</label><input name="email" type="email" value="${esc(u.email || '')}"></div><div><label>Company</label><input name="company"></div></div>
<label>Requirement</label><textarea name="notes" rows="4">${prod ? esc('Interested in: ' + prod) : ''}</textarea><p><button class="btn s">Submit enquiry</button></p></form></div>`;
    $('#ef').onsubmit = async e => { e.preventDefault(); try { await api('leads', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), source: 'web' } });
      app.innerHTML = '<div class="panel" style="text-align:center"><h2>Thank you!</h2><p>We will call you back shortly.</p><a class="btn" href="#/">Back to home</a></div>' } catch (x) { toast(x.message) } } },
};
const totals = q => `<table class="tot"><tr><td>Subtotal</td><td>${inr(q.subtotal)}</td></tr><tr><td>GST</td><td>${inr(q.tax)}</td></tr><tr><td>Shipping</td><td>${q.shipping ? inr(q.shipping) : 'FREE'}</td></tr><tr><td><b>Total</b></td><td><b>${inr(q.total)}</b></td></tr></table>`;
function loadRzp() { return new Promise((ok, no) => { if (window.Razorpay) return ok(); const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load Razorpay')); document.head.appendChild(s) }) }
async function pay(o, g) {
  if (!g) return;
  if (g.provider === 'mock') { const ok = await new Promise(r => { const m = document.createElement('div'); m.className = 'modal';
      m.innerHTML = `<div><h3>Test payment gateway</h3><p>Order ${esc(o.order_no)}<br>Amount <b>${inr(g.amount / 100)}</b></p><p class="muted"><small>Mock Razorpay (test mode). No real money is charged.</small></p><button class="btn s" id="mp">Pay successfully</button> <button class="btn o" id="mf">Fail / cancel</button></div>`;
      document.body.appendChild(m); m.querySelector('#mp').onclick = () => { m.remove(); r(true) }; m.querySelector('#mf').onclick = () => { m.remove(); r(false) } });
    if (!ok) { toast('Payment not completed — you can retry from the order page'); return }
    await api('payments/verify', { method: 'POST', body: { provider_order_id: g.provider_order_id, provider_payment_id: 'mock_pay_' + Date.now(), signature: 'mock_signature' } }); toast('Payment successful'); return }
  await loadRzp();
  await new Promise(res => { const rz = new Razorpay({ key: g.key_id, amount: g.amount, currency: g.currency, order_id: g.provider_order_id, name: 'Mohan Lal Mishra', description: 'Order ' + o.order_no,
    prefill: { name: S.user?.name, email: S.user?.email, contact: S.user?.phone }, theme: { color: '#0B3D91' },
    handler: async r => { try { await api('payments/verify', { method: 'POST', body: { provider_order_id: r.razorpay_order_id, provider_payment_id: r.razorpay_payment_id, signature: r.razorpay_signature } }); toast('Payment successful') } catch (x) { toast(x.message) } res() },
    modal: { ondismiss: () => { toast('Payment not completed — retry from the order page'); res() } } }); rz.open() });
}
async function route() {
  const [path, q] = (location.hash.slice(1) || '/').split('?'); const [, name = '', id] = path.split('/'); const fn = V[name || 'home'] || V.home;
  app.innerHTML = '<p class="muted">Loading…</p>'; window.scrollTo(0, 0);
  try { await fn(new URLSearchParams(q || ''), id) } catch (e) { app.innerHTML = `<div class="panel"><b>Something went wrong:</b> ${esc(e.message)} <p><a href="#/">Home</a></p></div>` }
}
$('#sform').onsubmit = e => { e.preventDefault(); location.hash = '#/products?q=' + encodeURIComponent($('#sq').value) };
$('#yr').textContent = new Date().getFullYear(); window.onhashchange = route; hdr(); route();
