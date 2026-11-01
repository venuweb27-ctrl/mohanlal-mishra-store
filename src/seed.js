require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return false;
  const h = p => bcrypt.hashSync(p, 10);
  const u = db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)');
  u.run('Admin', 'admin@mohanlalmishra.com', '9000000000', h('Admin@123'), 'admin');
  const v1 = u.run('Mishra Machines', 'vendor@mohanlalmishra.com', '9000000001', h('Vendor@123'), 'vendor').lastInsertRowid;
  u.run('Demo Customer', 'customer@example.com', '9000000002', h('Customer@123'), 'customer');
  const vid = db.prepare(`INSERT INTO vendors(user_id,business_name,gstin,address,bank_account,ifsc,status) VALUES(?,?,?,?,?,?,'approved')`)
    .run(v1, 'Mishra Machines Pvt Ltd', '09AAACM1234A1Z2', 'Kanpur, UP', '123456789012', 'SBIN0000001').lastInsertRowid;
  const cats = ['CNC Machines', 'Lathe Machines', 'Compressors', 'Generators', 'Pumps & Motors', 'Welding Equipment', 'Power Tools', 'Safety Equipment'];
  const c = db.prepare('INSERT INTO categories(name) VALUES(?)'); const cid = {}; cats.forEach(n => cid[n] = c.run(n).lastInsertRowid);
  const p = db.prepare(`INSERT INTO products(vendor_id,category_id,name,description,price,mrp,stock,sku,brand,specs,image_url,is_top_seller,sold_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const img = t => `https://placehold.co/600x400/0B3D91/FFFFFF/png?text=${encodeURIComponent(t)}`;
  [
    ['CNC Machines', 'VMC 850 Vertical Machining Centre', 'High-precision 3-axis VMC for die & mould work.', 2450000, 2700000, 3, 'CNC-VMC850', 'MLM', 'Travel 800x500x500mm; Spindle 8000rpm', 1, 42],
    ['Lathe Machines', 'All Geared Lathe 6ft', 'Heavy-duty all geared lathe machine, 6 ft bed.', 185000, 210000, 10, 'LTH-6FT', 'MLM', 'Swing 450mm; 3HP motor', 1, 55],
    ['Compressors', 'Screw Air Compressor 15HP', 'Energy-efficient rotary screw compressor.', 325000, 360000, 7, 'CMP-15HP', 'Atlas', '15HP, 8 bar, 56 CFM', 1, 31],
    ['Generators', 'Diesel Generator 62.5 kVA', 'Silent DG set, CPCB IV+ compliant.', 890000, 950000, 4, 'GEN-62', 'Kirloskar', '62.5 kVA, 3-phase', 0, 12],
    ['Pumps & Motors', 'Centrifugal Pump 5HP', 'Monoblock centrifugal pump for industrial use.', 28500, 32000, 40, 'PMP-5HP', 'Crompton', '5HP, 3-phase, 2" outlet', 1, 88],
    ['Welding Equipment', 'MIG Welding Machine 400A', 'Inverter MIG/MAG welder.', 68000, 75000, 15, 'WLD-MIG400', 'ESAB', '400A, 60% duty cycle', 0, 20],
    ['Power Tools', 'Angle Grinder 2000W', '180mm heavy-duty angle grinder.', 6500, 7800, 100, 'PT-AG180', 'Bosch', '2000W, 8500rpm', 1, 140],
    ['Safety Equipment', 'Industrial Safety Kit', 'Helmet, goggles, gloves, ear muffs, vest.', 2400, 3000, 200, 'SAF-KIT', 'Karam', 'ISI marked', 0, 60],
    ['Compressors', 'Reciprocating Compressor 5HP', 'Two-stage piston compressor 220L tank.', 74000, 82000, 12, 'CMP-5HP', 'Elgi', '5HP, 12 bar', 0, 9],
  ].forEach(r => p.run(vid, cid[r[0]], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], img(r[1]), r[9], r[10]));
  const l = db.prepare('INSERT INTO logistics_partners(name,contact_phone,tracking_url_template) VALUES(?,?,?)');
  l.run('Delhivery Freight', '18001234567', 'https://www.delhivery.com/track/package/{tracking_id}');
  l.run('VRL Logistics', '18004255001', 'https://www.vrlgroup.in/track?lr={tracking_id}');
  l.run('Own Fleet', '9000000009', null);
  db.prepare('INSERT INTO leads(name,phone,company,notes,status,source) VALUES(?,?,?,?,?,?)')
    .run('Rakesh Gupta', '+919811111111', 'Gupta Fabricators', 'Interested in VMC 850', 'new', 'website');
  return true;
}
module.exports = seed;
if (require.main === module) console.log(seed() ? 'Seeded' : 'Already seeded');
