const PDFDocument = require('pdfkit'); const fs = require('fs'); const path = require('path');
const db = require('../db');
const dir = path.join(__dirname, '..', '..', 'data', 'invoices');
function generateInvoice(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId); if (!o) throw new Error('Order not found');
  let inv = db.prepare('SELECT * FROM invoices WHERE order_id=?').get(orderId);
  const invoiceNo = inv ? inv.invoice_no : `MLM/INV/${new Date().getFullYear()}/${String(orderId).padStart(6, '0')}`;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
  fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, `invoice-${orderId}.pdf`);
  const gstPct = Number(process.env.GST_PERCENT || 18); const intra = /uttar pradesh|\bup\b/i.test(o.ship_address || '');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 }); const ws = fs.createWriteStream(file); doc.pipe(ws);
    doc.fontSize(20).fillColor('#0B3D91').text('MOHAN LAL MISHRA', { align: 'left' }).fillColor('black');
    doc.fontSize(9).text(process.env.COMPANY_ADDRESS || 'Industrial Supplies, India').text(`GSTIN: ${process.env.COMPANY_GSTIN || 'N/A'}`);
    doc.moveDown().fontSize(14).text('TAX INVOICE', { align: 'center' }).moveDown(0.5).fontSize(10);
    doc.text(`Invoice No: ${invoiceNo}`).text(`Invoice Date: ${new Date().toISOString().slice(0, 10)}`).text(`Order No: ${o.order_no}`)
      .text(`Payment: ${o.payment_method.toUpperCase()} (${o.payment_status})`).moveDown(0.5)
      .text(`Bill/Ship To: ${o.ship_name}, ${o.ship_phone}`).text(o.ship_address || '').text(`Place of Supply: ${intra ? 'Intra-state' : 'Inter-state'}`).moveDown();
    const y0 = doc.y; const cols = [40, 70, 300, 350, 420, 490];
    ['#', 'Item', 'HSN', 'Qty', 'Rate', 'Amount'].forEach((h, i) => doc.font('Helvetica-Bold').text(h, cols[i], y0));
    doc.font('Helvetica'); let y = y0 + 18;
    items.forEach((it, i) => { [String(i + 1), it.name, '8457', String(it.qty), it.price.toFixed(2), (it.price * it.qty).toFixed(2)].forEach((v, j) => doc.text(v, cols[j], y, { width: j === 1 ? 225 : 70 })); y += 30; });
    doc.moveTo(40, y).lineTo(560, y).stroke(); y += 10;
    const line = (k, v) => { doc.text(k, 350, y); doc.text(v.toFixed(2), 490, y); y += 16; };
    line('Taxable Value', o.subtotal);
    if (intra) { line(`CGST @ ${gstPct / 2}%`, o.tax / 2); line(`SGST @ ${gstPct / 2}%`, o.tax / 2); } else line(`IGST @ ${gstPct}%`, o.tax);
    line('Shipping', o.shipping); doc.font('Helvetica-Bold'); line('Grand Total (INR)', o.total); doc.font('Helvetica');
    doc.text('This is a computer generated invoice.', 40, y + 30);
    doc.end();
    ws.on('finish', () => {
      if (!inv) db.prepare('INSERT INTO invoices(order_id,invoice_no,file_path) VALUES(?,?,?)').run(orderId, invoiceNo, file);
      resolve(db.prepare('SELECT * FROM invoices WHERE order_id=?').get(orderId));
    }); ws.on('error', reject);
  });
}
module.exports = { generateInvoice };
