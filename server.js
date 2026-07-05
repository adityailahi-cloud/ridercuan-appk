/**
 * RiderCuan Backend — Express + SQLite
 * Jalankan: node server.js
 */

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────
// DATABASE SETUP
// ─────────────────────────────────────────────
const db = new Database('./ridercuan.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    password TEXT NOT NULL DEFAULT 'demo123',
    motor_brand TEXT DEFAULT 'Yamaha',
    motor_year INTEGER DEFAULT 2020,
    current_odometer REAL DEFAULT 0,
    ref_code TEXT UNIQUE NOT NULL,
    is_pro INTEGER DEFAULT 0,
    celengan_balance REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('argo','bensin','parkir','makan','affiliate_buy','celengan','pakai_celengan')),
    amount REAL NOT NULL,
    note TEXT,
    timestamp TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL,
    invited_code TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(inviter_id) REFERENCES users(id)
  );
`);

// ─────────────────────────────────────────────
// SEED DATA — Demo User + 5 Transaksi Tiruan
// ─────────────────────────────────────────────
function seedDemoData() {
  const existing = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (existing) return;

  const refCode = 'RIDER' + crypto.randomBytes(3).toString('hex').toUpperCase();

  db.prepare(`
    INSERT INTO users (id, name, password, motor_brand, motor_year, current_odometer, ref_code, is_pro, celengan_balance)
    VALUES (1, 'Budi Santoso', 'demo123', 'Yamaha Mio M3', 2019, 14850, ?, 0, 18200)
  `).run(refCode);

  const insertTx = db.prepare(`
    INSERT INTO transactions (user_id, type, amount, note, timestamp) VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  insertTx.run(1, 'argo',   85000, 'Pagi — Senen ke Blok M',          `${today} 07:15:00`);
  insertTx.run(1, 'argo',   62000, 'Siang — Mampang ke Kuningan',      `${today} 11:30:00`);
  insertTx.run(1, 'bensin', 25000, 'Isi bensin Pertamina',              `${today} 10:05:00`);
  insertTx.run(1, 'parkir', 2000,  'Parkir warung makan',               `${today} 12:00:00`);
  insertTx.run(1, 'makan',  15000, 'Nasi warteg siang',                 `${today} 12:30:00`);

  console.log(`✅ Seed OK — User: Budi Santoso | Ref: ${refCode}`);
}

seedDemoData();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const KM_COST_PER_KM = 32.5; // Rp32.5/km — Yamaha Mio M3 oli tiap 2000km @Rp65.000

function getTodayRange() {
  const now = new Date();
  const d = now.toISOString().slice(0, 10);
  return { start: `${d} 00:00:00`, end: `${d} 23:59:59` };
}

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

// POST /api/login — validasi nama DAN password (case-insensitive nama)
app.post('/api/login', (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
    if (!password)             return res.status(400).json({ error: 'Password tidak boleh kosong.' });

    const user = db.prepare('SELECT * FROM users WHERE LOWER(name) = LOWER(?)').get(name.trim());
    if (!user) {
      return res.status(404).json({ error: 'Akun tidak ditemukan, silakan daftar dulu.' });
    }
    if (user.password !== password) {
      return res.status(401).json({ error: 'Password salah, coba lagi.' });
    }

    // Jangan kembalikan password ke frontend
    const { password: _pw, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('[/api/login] error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan server internal', detail: err.message });
  }
});

// POST /api/register — daftarkan user baru dengan password
app.post('/api/register', (req, res) => {
  try {
    const { name, password, motor_brand, motor_year, current_odometer } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
    if (!password)             return res.status(400).json({ error: 'Password tidak boleh kosong.' });

    // Cek nama sudah terdaftar
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)').get(name.trim());
    if (existing) return res.status(409).json({ error: 'Nama ini sudah terdaftar. Coba masuk saja.' });

    const refCode = 'RIDER' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const info = db.prepare(`
      INSERT INTO users (name, password, motor_brand, motor_year, current_odometer, ref_code, is_pro, celengan_balance)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `).run(
      name.trim(),
      password,
      motor_brand      || 'Yamaha Mio M3',
      motor_year       || 2020,
      current_odometer || 0,
      refCode,
    );

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const { password: _pw, ...safeUser } = newUser;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('[/api/register] error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan server internal', detail: err.message });
  }
});

// GET /api/user/:id — profil + dashboard summary
app.get('/api/user/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { start, end } = getTodayRange();
  const txs = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC
  `).all(req.params.id, start, end);

  // Kalkulasi dasbor
  let totalArgo = 0, totalBensin = 0, totalParkir = 0, totalMakan = 0, totalCelenganHariIni = 0, totalPakaiCelengan = 0;
  for (const tx of txs) {
    if (tx.type === 'argo')           totalArgo             += tx.amount;
    if (tx.type === 'bensin')         totalBensin           += tx.amount;
    if (tx.type === 'parkir')         totalParkir           += tx.amount;
    if (tx.type === 'makan')          totalMakan            += tx.amount;
    if (tx.type === 'celengan')       totalCelenganHariIni  += tx.amount;
    if (tx.type === 'pakai_celengan') totalPakaiCelengan    += tx.amount;
  }

  const totalOperasional  = totalBensin + totalParkir + totalMakan + totalPakaiCelengan;
  const operasionalBesok  = Math.round(totalOperasional * 0.20);
  const uangBersihDapur   = totalArgo - totalOperasional - totalCelenganHariIni - operasionalBesok;

  const referralCount = db.prepare('SELECT COUNT(*) as c FROM referrals WHERE inviter_id = ?').get(req.params.id).c;

  res.json({
    user,
    dashboard: {
      totalArgo,
      totalBensin,
      totalParkir,
      totalMakan,
      totalOperasional,
      celenganHariIni: totalCelenganHariIni,
      operasionalBesok,
      uangBersihDapur,
    },
    transactions: txs,
    referralCount,
  });
});

// POST /api/transaction — tambah transaksi
app.post('/api/transaction', (req, res) => {
  const { user_id, type, amount, note } = req.body;
  if (!user_id || !type || !amount) return res.status(400).json({ error: 'Data tidak lengkap' });

  const validTypes = ['argo','bensin','parkir','makan','affiliate_buy'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Tipe transaksi tidak valid' });

  const stmt = db.prepare(`
    INSERT INTO transactions (user_id, type, amount, note) VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(user_id, type, amount, note || '');
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);

  res.json({ success: true, transaction: tx });
});

// DELETE /api/transaction/:id — hapus transaksi berdasarkan ID
app.delete('/api/transaction/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ success: true, deleted_id: req.params.id });
});

// POST /api/celengan — hitung & simpan penyusutan km
app.post('/api/celengan', (req, res) => {
  const { user_id, new_odometer } = req.body;
  if (!user_id || !new_odometer) return res.status(400).json({ error: 'Data tidak lengkap' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const selisihKM = new_odometer - user.current_odometer;
  if (selisihKM <= 0) return res.status(400).json({ error: 'Odometer baru harus lebih besar dari sebelumnya' });

  const potongan = Math.round(selisihKM * KM_COST_PER_KM);

  // Simpan transaksi celengan
  db.prepare(`INSERT INTO transactions (user_id, type, amount, note) VALUES (?, 'celengan', ?, ?)`).run(
    user_id, potongan, `Servis: ${selisihKM.toFixed(1)} km x Rp32,5`
  );

  // Update user
  db.prepare(`UPDATE users SET current_odometer = ?, celengan_balance = celengan_balance + ? WHERE id = ?`).run(
    new_odometer, potongan, user_id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);

  res.json({
    success: true,
    selisihKM: selisihKM.toFixed(1),
    potongan,
    celengan_balance: updated.celengan_balance,
  });
});

// POST /api/pakai-servis — gunakan saldo celengan untuk bayar servis
app.post('/api/pakai-servis', (req, res) => {
  try {
    const { user_id, amount } = req.body;
    if (!user_id || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Data tidak lengkap atau nominal tidak valid.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

    if (user.celengan_balance < amount) {
      return res.status(400).json({
        error: `Saldo celengan tidak cukup. Saldo kamu: Rp${Math.round(user.celengan_balance).toLocaleString('id-ID')}`
      });
    }

    // Kurangi celengan_balance
    db.prepare(`UPDATE users SET celengan_balance = celengan_balance - ? WHERE id = ?`).run(amount, user_id);

    // Catat sebagai transaksi pengeluaran
    db.prepare(`INSERT INTO transactions (user_id, type, amount, note) VALUES (?, 'pakai_celengan', ?, ?)`).run(
      user_id, amount, `Bayar servis motor dari celengan`
    );

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    res.json({
      success: true,
      celengan_balance: updated.celengan_balance,
      message: `Rp${Math.round(amount).toLocaleString('id-ID')} berhasil dipakai untuk servis.`,
    });
  } catch (err) {
    console.error('[/api/pakai-servis] error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan server internal', detail: err.message });
  }
});

// POST /api/upgrade-pro — upgrade ke PRO
app.post('/api/upgrade-pro', (req, res) => {
  const { user_id } = req.body;
  db.prepare('UPDATE users SET is_pro = 1 WHERE id = ?').run(user_id);
  res.json({ success: true, message: 'Akun berhasil di-upgrade ke PRO!' });
});

// GET /api/export/:id — export CSV (hanya PRO)
app.get('/api/export/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (!user.is_pro) return res.status(403).json({ error: 'Fitur ini hanya untuk pengguna PRO' });

  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC').all(req.params.id);

  let csv = 'ID,Tipe,Jumlah,Catatan,Waktu\n';
  for (const tx of txs) {
    csv += `${tx.id},${tx.type},${tx.amount},"${tx.note || ''}",${tx.timestamp}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="ridercuan_${req.params.id}.csv"`);
  res.send(csv);
});

// POST /api/referral — daftarkan referral
app.post('/api/referral', (req, res) => {
  const { user_id, invited_code } = req.body;
  if (!user_id || !invited_code) return res.status(400).json({ error: 'Data tidak lengkap' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (invited_code === user.ref_code) return res.status(400).json({ error: 'Tidak bisa pakai kode sendiri' });

  const already = db.prepare('SELECT id FROM referrals WHERE inviter_id = ? AND invited_code = ?').get(user_id, invited_code);
  if (already) return res.status(400).json({ error: 'Kode ini sudah pernah kamu masukkan' });

  db.prepare('INSERT INTO referrals (inviter_id, invited_code, status) VALUES (?, ?, ?)').run(user_id, invited_code, 'pending');

  const count = db.prepare('SELECT COUNT(*) as c FROM referrals WHERE inviter_id = ?').get(user_id).c;
  const reward = count >= 5 ? '🎉 Selamat! Kamu dapat e-Voucher Pertamina Rp10.000!' : `${count}/5 teman berhasil diajak`;

  res.json({ success: true, count, reward });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 RiderCuan berjalan di http://localhost:${PORT}`);
  console.log(`📱 Buka browser dan akses: http://localhost:${PORT}\n`);
});