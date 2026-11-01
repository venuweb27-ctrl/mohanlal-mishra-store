# Mohan Lal Mishra — Machinery & Industrial Equipment E-commerce

```
web storefront: backend/web/ (served at /)
backend/   Node.js + Express + SQLite (better-sqlite3) REST API + web Admin/Vendor panel (/admin)
android/   Kotlin + Jetpack Compose (Material 3, MVVM, Retrofit/OkHttp) customer app
dist/      app-debug.apk (prebuilt, points to http://10.0.2.2:4000/ = host machine from emulator)
```

## 1. Backend

Requirements: Node 18+ (tested on Node 24).

```bash
cd backend
cp .env.example .env      # edit as needed
npm install
npm start                 # http://localhost:4000  (admin panel: http://localhost:4000/admin)
npm test                  # end-to-end API test (fresh temp DB, mock payment + telephony)
```
The DB (`data/app.db`) is created and seeded automatically on first start (`npm run seed` also works).
Invoices are written to `data/invoices/`, uploaded images to `data/uploads/`.

### Default dev accounts (CHANGE BEFORE PRODUCTION)
| Role | Email | Password |
|---|---|---|
| Admin | admin@mohanlalmishra.com | Admin@123 |
| Vendor | vendor@mohanlalmishra.com | Vendor@123 |
| Customer | customer@example.com | Customer@123 |

### Environment variables
| Var | Purpose | Default |
|---|---|---|
| PORT | HTTP port | 4000 |
| JWT_SECRET | JWT signing secret | dev-secret-change-me |
| DB_FILE | SQLite file | ./data/app.db |
| COMMISSION_PERCENT | Platform commission deducted from vendor earnings (per-vendor override in panel) | 10 |
| GST_PERCENT | GST applied at checkout / on invoice (CGST+SGST for UP addresses, else IGST) | 18 |
| COMPANY_GSTIN, COMPANY_ADDRESS | Printed on invoices | sample |
| PAYMENT_PROVIDER | `mock` or `razorpay` | mock |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET | Razorpay keys | – |
| TELEPHONY_PROVIDER | `mock`, `twilio` or `tel` (plain tel: link) | mock |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER / AGENT_PHONE_NUMBER | Twilio click-to-call (rings agent, then bridges to lead) | – |

### Features (admin/vendor panel + API)
- **Users**: list/create/block/activate/reset password/delete; roles admin, vendor, customer (JWT).
- **Vendors**: self-registration from the panel → pending → admin approve/reject/suspend, per-vendor commission. Suspended vendors' products are hidden.
- **Products**: CRUD, categories CRUD, image upload, stock, sold count, manual Top-Seller flag; Top Sellers = flagged OR top 6 by sales.
- **Orders**: placed → confirmed → packed → shipped → out_for_delivery → delivered (or cancelled); transitions validated, every change logged to a timeline the customer sees. Stock is reserved on order and restored on cancel. Vendors can confirm/pack their orders.
- **Invoices**: GST tax-invoice PDF per order (invoice no., GSTIN, HSN, CGST/SGST or IGST split).
- **CRM**: leads (name, phone, email, company, notes, status pipeline, source); app "request a call back" creates leads; **Call** button uses the pluggable telephony provider (`src/services/telephony.js`) with call log; falls back to `tel:` link.
- **Logistics**: partners with tracking-URL templates, assign partner + tracking id to an order, delivery status/free-text updates → customer timeline.
- **Payments**: Razorpay order creation, checkout signature verification (`POST /api/payments/verify`) and webhook (`POST /api/payments/webhook`, `payment.captured`/`payment.failed`, HMAC verified); mock mode for testing. Payment rows store status (created/captured/failed).
- **Vendor wallet**: on delivery, each vendor is credited (item total − commission). Vendors request withdrawals (funds held), admin approve → mark paid (UTR) or reject (refunded to wallet).

### API overview (all under `/api`, `Authorization: Bearer <token>`)
```
POST auth/register | auth/login       GET/PUT me
GET  categories | products?q=&category_id=&top=1&sort=price_asc|price_desc|popular | products/:id
GET/POST addresses
POST orders/quote | orders            GET orders | orders/:id     POST orders/:id/cancel    GET orders/:id/invoice (PDF)
GET  payments/config  POST payments/verify | payments/retry/:orderId | payments/webhook
POST leads (public enquiry)
-- admin --
GET  admin/stats | admin/users | admin/vendors | admin/leads | admin/logistics | admin/withdrawals
POST/PUT/DELETE admin/users[/:id]  PUT admin/vendors/:id  POST/PUT/DELETE admin/categories[/:id]
POST/PUT/DELETE admin/leads[/:id]  POST admin/leads/:id/call  GET admin/leads/:id/calls
POST/PUT admin/logistics[/:id]  POST admin/orders/:id/assign-logistics | admin/orders/:id/delivery-update | admin/orders/:id/invoice
PUT  admin/withdrawals/:id  {action: approve|reject|mark_paid, utr, note}
-- admin + vendor --
GET/POST manage/products  PUT/DELETE manage/products/:id (multipart, field "image")
GET manage/orders[?status=] | manage/orders/:id   PUT manage/orders/:id/status {status, note}
-- vendor --
GET vendor/wallet   POST vendor/withdrawals {amount}
```

### Switching to Postgres
All SQL lives in `src/db.js` (schema) and the route/service files and is standard SQL (only `INSERT ... lastInsertRowid` and `?` placeholders are driver-specific). To move: replace `db.js` with a `pg` wrapper exposing `prepare(sql).get/all/run` (convert `?`→`$n`, add `RETURNING id`), change `INTEGER PRIMARY KEY` → `SERIAL PRIMARY KEY`, `REAL` → `NUMERIC(12,2)`.

## 1b. Customer web storefront
Plain HTML/CSS/JS SPA in `backend/web/` (no build step), served by the backend at `/` (admin/vendor panel stays at `/admin`).
Features: sign up/login, home hero + categories + Top Sellers, product listing with search/category/price filter/sort, product detail, cart (persisted in localStorage),
3-step checkout (address → payment online/COD → review → place order → confirmation), mock Razorpay dialog in test mode and real Razorpay `checkout.js` when `PAYMENT_PROVIDER=razorpay`,
My Orders with status timeline (auto-refresh), courier tracking, invoice PDF download, cancel, retry payment; profile edit; call-back enquiry form (creates CRM lead, source `web`); "Vendor / Admin login" link to `/admin`.
CORS: open by default; set `CORS_ORIGINS=https://a.com,https://b.com` to restrict.

## 2. Android app

Features: login/sign-up (JWT stored locally), Home with search, categories and **Top Sellers**, product listing with search/category/sort, product detail, cart, 3-step checkout (address → payment method → review → place order) with Razorpay or mock gateway, order confirmation, My Orders with auto-refreshing status timeline + courier tracking + invoice download + cancel, profile edit and call-back enquiry.

Prebuilt: `dist/app-debug.apk` (base URL `http://10.0.2.2:4000/`, works in the Android emulator with the backend on the same machine).

Build yourself (JDK 17 + Android SDK 34):
```bash
cd android
./gradlew assembleDebug -PAPI_BASE_URL=http://192.168.1.10:4000/   # your server URL (trailing slash)
# APK: app/build/outputs/apk/debug/app-debug.apk
```
Or open `android/` in Android Studio (Hedgehog+) and Run. The base URL can also be set permanently in `android/gradle.properties` (`API_BASE_URL`).
On a physical phone use your PC's LAN IP or a public HTTPS URL.

## 3. Before production (needs real keys / changes)
- `JWT_SECRET` (long random), change all default passwords / delete seed accounts.
- Razorpay: `PAYMENT_PROVIDER=razorpay`, live `RAZORPAY_KEY_ID/SECRET`, `RAZORPAY_WEBHOOK_SECRET` and configure webhook URL `https://<host>/api/payments/webhook`.
- Twilio: `TELEPHONY_PROVIDER=twilio`, account SID/token, a verified Indian-capable caller ID (`TWILIO_FROM_NUMBER`), `AGENT_PHONE_NUMBER`. (Exotel/Knowlarity can be added via `telephony.register()`.)
- Real `COMPANY_GSTIN`, address, HSN codes per product.
- HTTPS + remove cleartext in `android/app/src/main/res/xml/network_security_config.xml`; release signing keystore for the APK/Play Store.
- Consider Postgres + S3/object storage for uploads/invoices, backups, rate limiting.
