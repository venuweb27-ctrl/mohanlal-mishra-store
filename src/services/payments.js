// Payment gateway abstraction: 'razorpay' (real, needs keys) or 'mock' (for dev/testing).
const crypto = require('crypto');
const provider = () => (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
let rz = null;
function razorpay() {
  if (!rz) { const Razorpay = require('razorpay'); rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }); }
  return rz;
}
async function createGatewayOrder(order) {
  const amount = Math.round(order.total * 100);
  if (provider() === 'razorpay') {
    const r = await razorpay().orders.create({ amount, currency: 'INR', receipt: order.order_no });
    return { provider: 'razorpay', provider_order_id: r.id, key_id: process.env.RAZORPAY_KEY_ID, amount, currency: 'INR' };
  }
  return { provider: 'mock', provider_order_id: 'mock_order_' + crypto.randomBytes(6).toString('hex'), key_id: 'mock', amount, currency: 'INR' };
}
// Checkout signature: HMAC_SHA256(order_id|payment_id, key_secret)
function verifyCheckoutSignature({ provider_order_id, provider_payment_id, signature }) {
  if (provider() === 'mock') return signature === 'mock_signature';
  const exp = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${provider_order_id}|${provider_payment_id}`).digest('hex');
  return safeEq(exp, signature);
}
// Webhook signature: HMAC_SHA256(raw_body, webhook_secret)
function verifyWebhookSignature(rawBody, signature) {
  if (provider() === 'mock') return true;
  const exp = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '').update(rawBody).digest('hex');
  return safeEq(exp, signature || '');
}
function safeEq(a, b) { const x = Buffer.from(a), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
module.exports = { provider, createGatewayOrder, verifyCheckoutSignature, verifyWebhookSignature };
