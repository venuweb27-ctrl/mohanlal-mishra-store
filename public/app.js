const $ = s => document.querySelector(s); let T = localStorage.t, ME = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(m, u, b, form) {
  const r = await fetch(u, { method: m, headers: { Authorization: 'Bearer ' + T, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? b : b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) { alert(j.error || r.status); throw j; } return j;
}
const rupee = n => '₹' + Number(n || 0).toLocaleString('en-IN');
function loginView() {
  $('#nav').hidden = true; $('#who').textContent = '';
  $('#app').innerHTML = `<div id="login" class="card"><h3>Admin / Vendor Login</h3><div class="row"><input id="e" placeholder="Email" style="width:100%"></div>
  <div class="row"><input id="p" type="password" placeholder="Password" style="width:100%"></div><button class="b" id="go">Login</button>
  <p class="muted">New vendor? <a href="#" id="reg">Register for onboarding</a></p></div>`;
  $('#go').onclick = async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#e').value, password: $('#p').value }) }).then(r => r.json());
    if (!r.token) return alert(r.error); if (r.user.role === 'customer') return alert('Customers please use the Android app'); T = localStorage.t = r.token; boot(); };
  $('#reg').onclick = e => { e.preventDefault(); $('#app').innerHTML = `<div id="login" class="card"><h3>Vendor Registration</h3>${['name', 'email', 'phone', 'password', 'business_name', 'gstin', 'address', 'bank_account', 'ifsc'].map(f => `<div class="row"><input id="r_${f}" ${f === 'password' ? 'type=password' : ''} placeholder="${f.replace('_', ' ')}" style="width:100%"></div>`).join('')}<button class="b" id="sub">Submit</button></div>`;
    $('#sub').onclick = async () => { const b = { role: 'vendor' }; document.querySelectorAll('[id^=r_]').forEach(i => b[i.id.slice(2)] = i.value);
      const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()); if (!r.token) return alert(r.error);
      alert('Registered. Awaiting admin approval.'); T = localStorage.t = r.token; boot(); }; };
}
const TABS = { admin: ['Dashboard', 'Orders', 'Products', 'Categories', 'Users', 'Vendors', 'Leads', 'Logistics', 'Withdrawals'], vendor: ['Orders', 'Products', 'Wallet'] };
async function boot() {
  if (!T) return loginView(); try { ME = await api('GET', '/api/me'); } catch { T = localStorage.t = ''; return loginView(); }
  $('#who').innerHTML = `${esc(ME.name)} (${ME.role}${ME.vendor ? ' · ' + ME.vendor.status : ''}) <button class="b" onclick="localStorage.t='';location.reload()">Logout</button>`;
  const tabs = TABS[ME.role] || []; $('#nav').hidden = false;
  $('#nav').innerHTML = tabs.map(t => `<button data-t="${t}">${t}</button>`).join(''); $('#nav').onclick = e => e.target.dataset.t && show(e.target.dataset.t); show(tabs[0]);
}
function show(t) { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); V[t](); }
const V = {};
V.Dashboard = async () => { const s = await api('GET', '/api/admin/stats');
  $('#app').innerHTML = `<div class="grid">${Object.entries(s).map(([k, v]) => `<div class="card"><div class="muted">${k.replace('_', ' ')}</div><div class="stat">${k === 'revenue' ? rupee(v) : v}</div></div>`).join('')}</div>`; };
const NEXT = { placed: ['confirmed', 'cancelled'], confirmed: ['packed', 'cancelled'], packed: ['shipped', 'cancelled'], shipped: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'] };
V.Orders = async (st = '') => { const os = await api('GET', '/api/manage/orders' + (st ? '?status=' + st : '')); const adm = ME.role === 'admin';
  $('#app').innerHTML = `<div class="row">Filter: <select id="f"><option value="">All</option>${['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'].map(s => `<option ${s === st ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <table><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Logistics</th><th>Actions</th></tr>${os.map(o => `<tr><td><a href="#" onclick="orderDetail(${o.id});return false">${o.order_no}</a><div class="muted">${o.created_at}</div></td>
  <td>${esc(o.customer_name)}<div class="muted">${esc(o.ship_address)}</div></td><td>${rupee(o.total)}</td><td>${o.payment_method}<br><span class="pill">${o.payment_status}</span></td>
  <td><span class="pill">${o.status}</span><div class="muted">${esc(o.delivery_status || '')}</div></td><td>${esc(o.logistics_partner_name || '-')}<div class="muted">${esc(o.tracking_id || '')}</div></td>
  <td>${(NEXT[o.status] || []).filter(s => adm || ['confirmed', 'packed'].includes(s)).map(s => `<button class="b ${s === 'cancelled' ? 'r' : ''}" onclick="setSt(${o.id},'${s}')">${s}</button>`).join('')}
  ${adm ? `<button class="b o" onclick="assign(${o.id})">Assign logistics</button><button class="b o" onclick="trk(${o.id})">Tracking update</button>` : ''}
  <button class="b g" onclick="invoice(${o.id})">Invoice</button></td></tr>`).join('')}</table>`;
  $('#f').onchange = e => V.Orders(e.target.value); };
window.setSt = async (id, s) => { await api('PUT', `/api/manage/orders/${id}/status`, { status: s, note: prompt('Note (optional)') || undefined }); V.Orders(); };
window.assign = async id => { const lps = await api('GET', '/api/admin/logistics'); const lp = prompt('Partner id:\n' + lps.map(l => `${l.id}: ${l.name}`).join('\n')); if (!lp) return;
  await api('POST', `/api/admin/orders/${id}/assign-logistics`, { logistics_partner_id: +lp, tracking_id: prompt('Tracking ID') }); V.Orders(); };
window.trk = async id => { const s = prompt('Status (shipped/out_for_delivery/delivered) or free text e.g. "Reached Delhi hub"'); if (s) { await api('POST', `/api/admin/orders/${id}/delivery-update`, { status: s, note: s }); V.Orders(); } };
window.invoice = async id => { const r = await fetch(`/api/orders/${id}/invoice`, { headers: { Authorization: 'Bearer ' + T } }); if (!r.ok) return alert('Failed'); window.open(URL.createObjectURL(await r.blob())); };
window.orderDetail = async id => { const o = await api('GET', `/api/manage/orders/${id}`);
  $('#app').innerHTML = `<button class="b" onclick="V.Orders()">← Back</button><div class="card"><h3>${o.order_no} <span class="pill">${o.status}</span></h3>
  <p>${esc(o.ship_name)} · ${esc(o.ship_phone)}<br>${esc(o.ship_address)}</p><table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${rupee(i.price)}</td></tr>`).join('')}</table>
  <p>Subtotal ${rupee(o.subtotal)} · GST ${rupee(o.tax)} · Shipping ${rupee(o.shipping)} · <b>Total ${rupee(o.total)}</b></p>
  <h4>Payments</h4>${o.payments.map(p => `<div>${p.provider} ${p.provider_order_id} – <span class="pill">${p.status}</span> ${esc(p.provider_payment_id || '')}</div>`).join('') || '<div class="muted">None</div>'}
  <h4>Timeline</h4>${o.events.map(e => `<div>• <b>${e.status}</b> – ${esc(e.note || '')} <span class="muted">${e.created_at}</span></div>`).join('')}</div>`; };
V.Products = async () => { const [ps, cats] = await Promise.all([api('GET', '/api/manage/products'), api('GET', '/api/categories')]); const adm = ME.role === 'admin';
  $('#app').innerHTML = `<div class="card"><h4>Add / Edit product</h4><form id="pf"><input type="hidden" name="id"><div class="row">
  <input name="name" placeholder="Name" required><select name="category_id">${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
  <input name="price" type="number" step="0.01" placeholder="Price" required><input name="mrp" type="number" placeholder="MRP"><input name="stock" type="number" placeholder="Stock">
  <input name="sku" placeholder="SKU"><input name="brand" placeholder="Brand"></div><div class="row"><textarea name="description" placeholder="Description" cols="40"></textarea>
  <textarea name="specs" placeholder="Specifications" cols="30"></textarea><input type="file" name="image" accept="image/*">${adm ? '<label><input type="checkbox" name="is_top_seller" value="1"> Top seller</label>' : ''}
  <button class="b g">Save</button><button type="reset" class="b">Clear</button></div></form></div>
  <table><tr><th></th><th>Name</th><th>Category</th><th>Vendor</th><th>Price</th><th>Stock</th><th>Sold</th><th>Top</th><th>Active</th><th></th></tr>${ps.map(p => `<tr><td><img class="t" src="${esc(p.image_url || '')}"></td><td>${esc(p.name)}<div class="muted">${esc(p.sku || '')}</div></td>
  <td>${esc(p.category_name || '')}</td><td>${esc(p.vendor_name || '-')}</td><td>${rupee(p.price)}</td><td>${p.stock}</td><td>${p.sold_count}</td><td>${p.is_top_seller ? '★' : ''}</td><td>${p.active ? 'Yes' : 'No'}</td>
  <td><button class="b" onclick='editP(${JSON.stringify(p).replace(/'/g, '&#39;')})'>Edit</button>${p.active ? `<button class="b r" onclick="delP(${p.id})">Deactivate</button>` : `<button class="b g" onclick="actP(${p.id})">Activate</button>`}</td></tr>`).join('')}</table>`;
  $('#pf').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const id = fd.get('id'); fd.delete('id'); if (!fd.get('image').size) fd.delete('image');
    if (adm) fd.set('is_top_seller', e.target.is_top_seller.checked ? '1' : '0'); await api(id ? 'PUT' : 'POST', '/api/manage/products' + (id ? '/' + id : ''), fd, true); V.Products(); }; };
window.editP = p => { const f = $('#pf'); ['id', 'name', 'category_id', 'price', 'mrp', 'stock', 'sku', 'brand', 'description', 'specs'].forEach(k => f[k].value = p[k] ?? ''); if (f.is_top_seller) f.is_top_seller.checked = !!p.is_top_seller; scrollTo(0, 0); };
window.delP = async id => { if (confirm('Deactivate?')) { await api('DELETE', '/api/manage/products/' + id); V.Products(); } };
window.actP = async id => { await api('PUT', '/api/manage/products/' + id, { active: 1 }); V.Products(); };
V.Categories = async () => { const cs = await api('GET', '/api/categories');
  $('#app').innerHTML = `<div class="row"><input id="cn" placeholder="New category"><button class="b g" id="ca">Add</button></div><table><tr><th>ID</th><th>Name</th><th>Products</th><th></th></tr>${cs.map(c => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${c.product_count}</td><td><button class="b" onclick="renC(${c.id})">Rename</button><button class="b r" onclick="delC(${c.id})">Delete</button></td></tr>`).join('')}</table>`;
  $('#ca').onclick = async () => { await api('POST', '/api/admin/categories', { name: $('#cn').value }); V.Categories(); }; };
window.renC = async id => { const n = prompt('New name'); if (n) { await api('PUT', '/api/admin/categories/' + id, { name: n }); V.Categories(); } };
window.delC = async id => { await api('DELETE', '/api/admin/categories/' + id); V.Categories(); };
V.Users = async () => { const us = await api('GET', '/api/admin/users');
  $('#app').innerHTML = `<div class="card row"><input id="un" placeholder="Name"><input id="ue" placeholder="Email"><input id="up" placeholder="Phone"><input id="upw" placeholder="Password"><select id="ur"><option>customer</option><option>vendor</option><option>admin</option></select><button class="b g" id="ua">Create user</button></div>
  <table><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th></th></tr>${us.map(u => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '')}</td><td>${u.role}</td><td><span class="pill">${u.status}</span></td>
  <td>${u.status === 'active' ? `<button class="b r" onclick="uSt(${u.id},'blocked')">Block</button>` : `<button class="b g" onclick="uSt(${u.id},'active')">Activate</button>`}<button class="b" onclick="uPw(${u.id})">Reset pw</button><button class="b r" onclick="uDel(${u.id})">Delete</button></td></tr>`).join('')}</table>`;
  $('#ua').onclick = async () => { await api('POST', '/api/admin/users', { name: $('#un').value, email: $('#ue').value, phone: $('#up').value, password: $('#upw').value, role: $('#ur').value }); V.Users(); }; };
window.uSt = async (id, s) => { await api('PUT', '/api/admin/users/' + id, { status: s }); V.Users(); };
window.uPw = async id => { const p = prompt('New password'); if (p) await api('PUT', '/api/admin/users/' + id, { password: p }); };
window.uDel = async id => { if (confirm('Delete user?')) { await api('DELETE', '/api/admin/users/' + id); V.Users(); } };
V.Vendors = async () => { const vs = await api('GET', '/api/admin/vendors');
  $('#app').innerHTML = `<table><tr><th>Business</th><th>Owner</th><th>GSTIN</th><th>Bank</th><th>Commission %</th><th>Wallet</th><th>Status</th><th></th></tr>${vs.map(v => `<tr><td>${esc(v.business_name)}<div class="muted">${esc(v.address || '')}</div></td><td>${esc(v.owner_name)}<div class="muted">${esc(v.email)} ${esc(v.phone || '')}</div></td>
  <td>${esc(v.gstin || '')}</td><td>${esc(v.bank_account || '')}<div class="muted">${esc(v.ifsc || '')}</div></td><td>${v.commission_percent ?? 'default'}</td><td>${rupee(v.wallet_balance)}</td><td><span class="pill">${v.status}</span></td>
  <td>${v.status !== 'approved' ? `<button class="b g" onclick="vSt(${v.id},{status:'approved'})">Approve</button>` : ''}${v.status === 'pending' ? `<button class="b r" onclick="vSt(${v.id},{status:'rejected'})">Reject</button>` : ''}${v.status === 'approved' ? `<button class="b r" onclick="vSt(${v.id},{status:'suspended'})">Suspend</button>` : ''}
  <button class="b" onclick="vCom(${v.id})">Commission</button></td></tr>`).join('')}</table>`; };
window.vSt = async (id, b) => { await api('PUT', '/api/admin/vendors/' + id, b); V.Vendors(); };
window.vCom = async id => { const c = prompt('Commission %'); if (c) vSt(id, { commission_percent: +c }); };
V.Leads = async () => { const ls = await api('GET', '/api/admin/leads'); const ST = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
  $('#app').innerHTML = `<div class="card row"><input id="ln" placeholder="Name"><input id="lp" placeholder="Phone (+91...)"><input id="lc" placeholder="Company"><input id="le" placeholder="Email"><input id="ls" placeholder="Source"><input id="lno" placeholder="Notes" size="30"><button class="b g" id="la">Save lead</button></div>
  <table><tr><th>Name</th><th>Phone</th><th>Company</th><th>Source</th><th>Notes</th><th>Status</th><th>Calls</th><th></th></tr>${ls.map(l => `<tr><td>${esc(l.name)}<div class="muted">${esc(l.email || '')}</div></td><td>${esc(l.phone)}</td><td>${esc(l.company || '')}</td><td>${esc(l.source || '')}</td>
  <td>${esc(l.notes || '')}</td><td><select onchange="lUp(${l.id},{status:this.value})">${ST.map(s => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><a href="#" onclick="lCalls(${l.id});return false">${l.call_count}</a></td>
  <td><button class="b g" onclick="lCall(${l.id})">📞 Call</button><a class="b" style="text-decoration:none;padding:6px 10px;display:inline-block" href="tel:${esc(l.phone)}">tel:</a><button class="b" onclick="lNote(${l.id})">Note</button><button class="b r" onclick="lDel(${l.id})">Delete</button></td></tr>`).join('')}</table>`;
  $('#la').onclick = async () => { await api('POST', '/api/admin/leads', { name: $('#ln').value, phone: $('#lp').value, company: $('#lc').value, email: $('#le').value, source: $('#ls').value, notes: $('#lno').value }); V.Leads(); }; };
window.lUp = async (id, b) => { await api('PUT', '/api/admin/leads/' + id, b); V.Leads(); };
window.lNote = id => { const n = prompt('Notes'); if (n !== null) lUp(id, { notes: n }); };
window.lDel = async id => { if (confirm('Delete lead?')) { await api('DELETE', '/api/admin/leads/' + id); V.Leads(); } };
window.lCall = async id => { const r = await api('POST', `/api/admin/leads/${id}/call`, {}); if (r.provider === 'tel' || /failed/.test(r.status)) location.href = r.telLink; else alert(`Call ${r.status} via ${r.provider} (${r.callId})`); V.Leads(); };
window.lCalls = async id => { const cs = await api('GET', `/api/admin/leads/${id}/calls`); alert(cs.map(c => `${c.created_at} ${c.provider} ${c.status} ${c.provider_call_id || ''}`).join('\n') || 'No calls'); };
V.Logistics = async () => { const ls = await api('GET', '/api/admin/logistics');
  $('#app').innerHTML = `<div class="card row"><input id="gn" placeholder="Partner name"><input id="gp" placeholder="Contact phone"><input id="gt" placeholder="Tracking URL with {tracking_id}" size="40"><button class="b g" id="ga">Add partner</button></div>
  <table><tr><th>ID</th><th>Name</th><th>Phone</th><th>Tracking URL</th><th>Active</th><th></th></tr>${ls.map(l => `<tr><td>${l.id}</td><td>${esc(l.name)}</td><td>${esc(l.contact_phone || '')}</td><td>${esc(l.tracking_url_template || '')}</td><td>${l.active ? 'Yes' : 'No'}</td>
  <td><button class="b" onclick="gTog(${l.id},${l.active ? 0 : 1})">${l.active ? 'Disable' : 'Enable'}</button></td></tr>`).join('')}</table>`;
  $('#ga').onclick = async () => { await api('POST', '/api/admin/logistics', { name: $('#gn').value, contact_phone: $('#gp').value, tracking_url_template: $('#gt').value }); V.Logistics(); }; };
window.gTog = async (id, a) => { await api('PUT', '/api/admin/logistics/' + id, { active: a }); V.Logistics(); };
V.Withdrawals = async () => { const ws = await api('GET', '/api/admin/withdrawals');
  $('#app').innerHTML = `<table><tr><th>ID</th><th>Vendor</th><th>Bank</th><th>Amount</th><th>Status</th><th>UTR / Note</th><th>Requested</th><th></th></tr>${ws.map(w => `<tr><td>${w.id}</td><td>${esc(w.business_name)}</td><td>${esc(w.bank_account || '')} ${esc(w.ifsc || '')}</td><td>${rupee(w.amount)}</td><td><span class="pill">${w.status}</span></td><td>${esc(w.utr || '')} ${esc(w.admin_note || '')}</td><td>${w.created_at}</td>
  <td>${w.status === 'requested' ? `<button class="b g" onclick="wAct(${w.id},'approve')">Approve</button>` : ''}${['requested', 'approved'].includes(w.status) ? `<button class="b r" onclick="wAct(${w.id},'reject')">Reject</button>` : ''}${w.status === 'approved' ? `<button class="b o" onclick="wAct(${w.id},'mark_paid')">Mark paid</button>` : ''}</td></tr>`).join('')}</table>`; };
window.wAct = async (id, action) => { const b = { action }; if (action === 'mark_paid') b.utr = prompt('Bank UTR / reference'); if (action === 'reject') b.note = prompt('Reason'); await api('PUT', '/api/admin/withdrawals/' + id, b); V.Withdrawals(); };
V.Wallet = async () => { const w = await api('GET', '/api/vendor/wallet');
  $('#app').innerHTML = `<div class="card"><div class="muted">Available balance</div><div class="stat">${rupee(w.vendor.wallet_balance)}</div><div class="row"><input id="wa" type="number" placeholder="Amount"><button class="b g" id="wr">Request withdrawal</button></div></div>
  <h4>Withdrawals</h4><table><tr><th>ID</th><th>Amount</th><th>Status</th><th>UTR</th><th>Date</th></tr>${w.withdrawals.map(x => `<tr><td>${x.id}</td><td>${rupee(x.amount)}</td><td>${x.status}</td><td>${esc(x.utr || '')}</td><td>${x.created_at}</td></tr>`).join('')}</table>
  <h4>Transactions</h4><table><tr><th>Type</th><th>Amount</th><th>Note</th><th>Date</th></tr>${w.transactions.map(x => `<tr><td>${x.type}</td><td>${rupee(x.amount)}</td><td>${esc(x.note || '')}</td><td>${x.created_at}</td></tr>`).join('')}</table>`;
  $('#wr').onclick = async () => { await api('POST', '/api/vendor/withdrawals', { amount: +$('#wa').value }); V.Wallet(); }; };
window.V = V; boot();
