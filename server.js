'use strict';
/*
 * RSA & Gulf Consultant - website + backend.
 * No third-party packages. Needs Node 22.13 or newer (built-in SQLite).
 *
 * Public:  GET /            the website
 *          POST /api/apply  a client sends the form + document photos
 * Staff:   GET /admin       password-protected admin page
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/* ---------- settings ---------- */
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_HOURS = 12;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

if (ADMIN_PASSWORD.length < 8) {
  console.error('\nSet a staff password first (at least 8 characters). Example:\n  ADMIN_PASSWORD="your-long-password" node server.js\n');
  process.exit(1);
}

fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
const secretFile = path.join(DATA, '.secret');
if (!fs.existsSync(secretFile)) { fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const STATUS = ['new', 'contacted', 'documents', 'medical', 'visa', 'departed', 'closed'];
const KINDS = ['passport', 'cnic', 'photos', 'cv', 'certificate', 'experience', 'other'];

/* ---------- database ---------- */
const db = new DatabaseSync(path.join(DATA, 'rsa.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    passport TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    docs_declared TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    follow_up TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'website',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_app ON files(application_id);
  CREATE INDEX IF NOT EXISTS idx_hist_app ON history(application_id);
  CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
`);

const q = {
  insertApp: db.prepare('INSERT INTO applications (name, city, address, whatsapp, passport, country, docs_declared, status, follow_up, note, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  setRef: db.prepare('UPDATE applications SET ref = ? WHERE id = ?'),
  insertFile: db.prepare('INSERT INTO files (application_id, kind, original_name, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  insertHist: db.prepare('INSERT INTO history (application_id, at, text) VALUES (?, ?, ?)'),
  getApp: db.prepare('SELECT * FROM applications WHERE id = ?'),
  getFiles: db.prepare('SELECT id, kind, original_name, mime, size, created_at FROM files WHERE application_id = ? ORDER BY id'),
  getFile: db.prepare('SELECT * FROM files WHERE id = ?'),
  getHist: db.prepare('SELECT at, text FROM history WHERE application_id = ? ORDER BY id DESC LIMIT 50'),
  fileNames: db.prepare('SELECT stored_name FROM files WHERE application_id = ?'),
  delFile: db.prepare('DELETE FROM files WHERE id = ?'),
  delApp: db.prepare('DELETE FROM applications WHERE id = ?'),
  touch: db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?'),
  list: db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM files f WHERE f.application_id = a.id) AS file_count
    FROM applications a
    WHERE (? = '' OR a.status = ?)
      AND (? = '' OR instr(lower(a.name || ' ' || a.city || ' ' || a.address || ' ' || a.whatsapp || ' ' || a.passport || ' ' || a.ref || ' ' || a.country), ?) > 0)
    ORDER BY a.id DESC LIMIT 500`),
  counts: db.prepare('SELECT status, COUNT(*) AS n FROM applications GROUP BY status'),
  due: db.prepare("SELECT COUNT(*) AS n FROM applications WHERE follow_up != '' AND follow_up <= ? AND status NOT IN ('departed','closed')"),
  all: db.prepare('SELECT a.*, (SELECT COUNT(*) FROM files f WHERE f.application_id = a.id) AS file_count FROM applications a ORDER BY a.id'),
};
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (x) {} throw e; }
}
const ymd = (d) => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const oneLine = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function clientIp(req) {
  if (TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) { return f; } }
  return req.socket.remoteAddress || '';
}
const hits = new Map();
function limited(bucket, ip, max, windowMs, count) {
  const key = bucket + '|' + ip, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (count) { arr.push(now); }
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) { if (!v.length || now - v[v.length - 1] > 3600e3) { hits.delete(k); } } }, 600e3).unref();

function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeToken() { const p = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url'); return p + '.' + sign(p); }
function validToken(t) {
  if (!t || t.indexOf('.') < 0) { return false; }
  const [p, s] = t.split('.');
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) { return false; }
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
}
function cookie(req, name) {
  const m = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function isHttps(req) { return !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'); }
function samePassword(a) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(x, y);
}
function requireStaff(req) {
  if (!validToken(cookie(req, 'rsa_sid'))) { throw new HttpError(401, 'Please sign in.'); }
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'rsa') { throw new HttpError(403, 'Blocked.'); }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Too large.')); req.destroy(); } else { chunks.push(c); } });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const buf = await readBody(req, limit || 1024 * 1024);
  if (!buf.length) { return {}; }
  try { const v = JSON.parse(buf.toString('utf8')); if (v && typeof v === 'object') { return v; } } catch (e) {}
  throw new HttpError(400, 'Bad request.');
}
function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {});
  res.writeHead(status, h); res.end(body);
}
function json(res, status, obj, extra) { send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {})); }

/* ---------- applicant + file validation ---------- */
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) { return { mime: 'image/jpeg', ext: 'jpg' }; }
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { return { mime: 'image/png', ext: 'png' }; }
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') { return { mime: 'image/webp', ext: 'webp' }; }
  if (buf.length > 12 && buf.slice(0, 5).toString('latin1') === '%PDF-') { return { mime: 'application/pdf', ext: 'pdf' }; }
  return null;
}
function parseFiles(list) {
  if (list == null) { return []; }
  if (!Array.isArray(list) || list.length > MAX_FILES) { throw new HttpError(400, 'Too many files (limit ' + MAX_FILES + ').'); }
  let total = 0;
  return list.map((f) => {
    if (!f || typeof f.data !== 'string') { throw new HttpError(400, 'Bad file.'); }
    const buf = Buffer.from(f.data, 'base64');
    if (!buf.length) { throw new HttpError(400, 'Empty file.'); }
    if (buf.length > MAX_FILE_BYTES) { throw new HttpError(413, 'A file is too large (limit 6 MB). Use a smaller photo.'); }
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) { throw new HttpError(413, 'Files are too large in total.'); }
    const t = sniff(buf);
    if (!t) { throw new HttpError(400, 'Use JPG, PNG, WEBP or PDF files only.'); }
    const kind = KINDS.indexOf(f.kind) >= 0 ? f.kind : 'other';
    const base = oneLine(String(f.name || 'file').split(/[\\/]/).pop(), 80).replace(/[^\w .\-()]/g, '_') || 'file';
    return { kind, name: base, buf, mime: t.mime, ext: t.ext };
  });
}
function cleanApplicant(b, strict) {
  const a = {
    name: oneLine(b.name, 60), city: oneLine(b.city, 40), address: oneLine(b.address, 120),
    whatsapp: String(b.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 16),
    passport: String(b.passport || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
    country: oneLine(b.country, 30),
  };
  if (strict) {
    if (a.name.length < 3) { throw new HttpError(400, 'Name is required.'); }
    if (a.city.length < 2) { throw new HttpError(400, 'City is required.'); }
    if (a.address.length < 5) { throw new HttpError(400, 'Address is required.'); }
    if (a.whatsapp.replace(/\D/g, '').length < 10) { throw new HttpError(400, 'WhatsApp number is required.'); }
    if (!b.noPassport && !/^[A-Z0-9]{7,9}$/.test(a.passport)) { throw new HttpError(400, 'Passport number is not correct.'); }
    if (b.noPassport) { a.passport = ''; }
  } else if (!a.name && a.whatsapp.replace(/\D/g, '').length < 7) { throw new HttpError(400, 'Enter a name or a phone number.'); }
  return a;
}
function saveApplication(a, extra, files, source, note) {
  const written = [];
  try {
    return tx(() => {
      const now = Date.now();
      const r = q.insertApp.run(a.name, a.city, a.address, a.whatsapp, a.passport, a.country, extra.docs, 'new', extra.follow_up || '', note || '', source, now, now);
      const id = Number(r.lastInsertRowid);
      const ref = 'RSA-' + new Date().getFullYear() + '-' + String(id).padStart(4, '0');
      q.setRef.run(ref, id);
      q.insertHist.run(id, now, source === 'website' ? 'Application received from the website' : 'Record created by staff');
      addFiles(id, files, written);
      return { id, ref };
    });
  } catch (e) { written.forEach((p) => { try { fs.unlinkSync(p); } catch (x) {} }); throw e; }
}
function addFiles(id, files, written) {
  const now = Date.now();
  files.forEach((f) => {
    const stored = crypto.randomBytes(16).toString('hex') + '.' + f.ext;
    const p = path.join(DATA, 'uploads', stored);
    fs.writeFileSync(p, f.buf, { mode: 0o600 }); if (written) { written.push(p); }
    q.insertFile.run(id, f.kind, f.name, stored, f.mime, f.buf.length, now);
  });
  if (files.length) { q.insertHist.run(id, now, 'Files added: ' + files.map((f) => f.kind).join(', ')); }
}
function removeStored(names) { names.forEach((n) => { try { fs.unlinkSync(path.join(DATA, 'uploads', path.basename(n))); } catch (e) {} }); }
function shape(a) {
  return { id: a.id, ref: a.ref, name: a.name, city: a.city, address: a.address, whatsapp: a.whatsapp, passport: a.passport, country: a.country, docs_declared: a.docs_declared, status: a.status, follow_up: a.follow_up, note: a.note, source: a.source, created_at: a.created_at, updated_at: a.updated_at, file_count: a.file_count };
}

/* ---------- CSV ---------- */
function cell(v) { let s = String(v == null ? '' : v); if (/^(=|@|\+|-|\t|\r)/.test(s) && !/^[+-]?\d[\d\s-]*$/.test(s)) { s = "'" + s; } return '"' + s.replace(/"/g, '""') + '"'; }
function csv() {
  const head = ['Ref', 'Name', 'City', 'Address', 'WhatsApp', 'Passport', 'Country', 'Documents (client said)', 'Files', 'Status', 'Follow-up', 'Note', 'Received'];
  const lines = q.all.all().map((a) => [a.ref, a.name, a.city, a.address, a.whatsapp, a.passport, a.country, a.docs_declared, a.file_count, a.status, a.follow_up, a.note, new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ')].map(cell).join(','));
  return '﻿' + [head.map(cell).join(',')].concat(lines).join('\r\n');
}

/* ---------- routes ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/health' && m === 'GET') { return json(res, 200, { ok: true, app: 'rsa-gulf' }); }
  if (p === '/api/session' && m === 'GET') { return json(res, 200, { ok: true, staff: validToken(cookie(req, 'rsa_sid')) }); }

  if (p === '/api/apply' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('apply', ip, 8, 3600e3, false)) { throw new HttpError(429, 'Too many tries. Please call us or try again later.'); }
    const b = await readJson(req, MAX_BODY_BYTES);
    if (b.website) { return json(res, 200, { ok: true, ref: 'RSA-0000' }); } /* hidden trap field: bots fill it */
    const a = cleanApplicant(b, true);
    const files = parseFiles(b.files);
    const docs = (Array.isArray(b.docs) ? b.docs : []).map((d) => oneLine(d, 30)).filter(Boolean).slice(0, 10).join(', ');
    limited('apply', ip, 8, 3600e3, true);
    const r = saveApplication(a, { docs }, files, 'website', '');
    return json(res, 200, { ok: true, ref: r.ref });
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = clientIp(req);
    if (limited('login', ip, 8, 900e3, false)) { throw new HttpError(429, 'Too many wrong tries. Wait 15 minutes.'); }
    const b = await readJson(req, 4096);
    if (!samePassword(b.password || '')) { limited('login', ip, 8, 900e3, true); throw new HttpError(401, 'Wrong password.'); }
    const flags = 'HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_HOURS * 3600 + (isHttps(req) ? '; Secure' : '');
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'rsa_sid=' + makeToken() + '; ' + flags });
  }
  if (p === '/api/logout' && m === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'rsa_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!p.startsWith('/api/admin/')) { throw new HttpError(404, 'Not found.'); }
  requireStaff(req);
  const rest = p.slice('/api/admin/'.length).split('/');

  if (rest[0] === 'applications' && rest.length === 1) {
    if (m === 'GET') {
      const status = STATUS.indexOf(url.searchParams.get('status')) >= 0 ? url.searchParams.get('status') : '';
      const text = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
      const rows = q.list.all(status, status, text, text).map(shape);
      const counts = {}; q.counts.all().forEach((r) => { counts[r.status] = r.n; });
      return json(res, 200, { rows, counts, due: q.due.get(ymd()).n });
    }
    if (m === 'POST') {
      const b = await readJson(req, MAX_BODY_BYTES);
      const a = cleanApplicant(b, false);
      const r = saveApplication(a, { docs: '', follow_up: /^\d{4}-\d{2}-\d{2}$/.test(b.follow_up || '') ? b.follow_up : '' }, parseFiles(b.files), 'office', oneLine(b.note, 1000));
      return json(res, 200, { ok: true, id: r.id, ref: r.ref });
    }
  }
  if (rest[0] === 'applications' && /^\d+$/.test(rest[1] || '')) {
    const id = Number(rest[1]);
    const a = q.getApp.get(id);
    if (!a) { throw new HttpError(404, 'Not found.'); }
    if (rest.length === 2 && m === 'GET') { return json(res, 200, Object.assign(shape(a), { files: q.getFiles.all(id), history: q.getHist.all(id) })); }
    if (rest.length === 2 && m === 'PATCH') {
      const b = await readJson(req, 64 * 1024);
      const sets = [], vals = [], notes = [];
      const text = { name: 60, city: 40, address: 120, country: 30 };
      Object.keys(text).forEach((k) => { if (k in b) { const v = oneLine(b[k], text[k]); if (v !== a[k]) { sets.push(k + ' = ?'); vals.push(v); notes.push('Edited ' + k); } } });
      if ('whatsapp' in b) { const v = String(b.whatsapp).replace(/[^\d+]/g, '').slice(0, 16); if (v !== a.whatsapp) { sets.push('whatsapp = ?'); vals.push(v); notes.push('Edited WhatsApp number'); } }
      if ('passport' in b) { const v = String(b.passport).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); if (v !== a.passport) { sets.push('passport = ?'); vals.push(v); notes.push('Edited passport number'); } }
      if ('status' in b) {
        if (STATUS.indexOf(b.status) < 0) { throw new HttpError(400, 'Bad status.'); }
        if (b.status !== a.status) { sets.push('status = ?'); vals.push(b.status); notes.push('Status: ' + a.status + ' to ' + b.status); }
      }
      if ('follow_up' in b) {
        const v = String(b.follow_up || ''); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { throw new HttpError(400, 'Bad date.'); }
        if (v !== a.follow_up) { sets.push('follow_up = ?'); vals.push(v); notes.push(v ? 'Follow-up set for ' + v : 'Follow-up cleared'); }
      }
      if ('note' in b) { const v = String(b.note || '').replace(/\u0000/g, '').slice(0, 1000); if (v !== a.note) { sets.push('note = ?'); vals.push(v); notes.push('Note edited'); } }
      if (sets.length) {
        tx(() => {
          const now = Date.now();
          db.prepare('UPDATE applications SET ' + sets.join(', ') + ', updated_at = ? WHERE id = ?').run(...vals, now, id);
          notes.forEach((t) => q.insertHist.run(id, now, t));
        });
      }
      return json(res, 200, { ok: true });
    }
    if (rest.length === 2 && m === 'DELETE') {
      const names = q.fileNames.all(id).map((r) => r.stored_name);
      tx(() => { q.delApp.run(id); });
      removeStored(names);
      return json(res, 200, { ok: true });
    }
    if (rest[2] === 'files' && rest.length === 3 && m === 'POST') {
      const b = await readJson(req, MAX_BODY_BYTES);
      const files = parseFiles(b.files);
      if (!files.length) { throw new HttpError(400, 'No file.'); }
      const written = [];
      try { tx(() => { addFiles(id, files, written); q.touch.run(Date.now(), id); }); }
      catch (e) { written.forEach((x) => { try { fs.unlinkSync(x); } catch (y) {} }); throw e; }
      return json(res, 200, { ok: true });
    }
  }
  if (rest[0] === 'files' && /^\d+$/.test(rest[1] || '')) {
    const f = q.getFile.get(Number(rest[1]));
    if (!f) { throw new HttpError(404, 'Not found.'); }
    if (m === 'GET') {
      const fp = path.join(DATA, 'uploads', path.basename(f.stored_name));
      if (!fs.existsSync(fp)) { throw new HttpError(404, 'File is missing on disk.'); }
      const safeName = f.original_name.replace(/[^\w .\-()]/g, '_');
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': fs.statSync(fp).size, 'Content-Disposition': 'inline; filename="' + safeName + '"', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'" });
      return fs.createReadStream(fp).pipe(res);
    }
    if (m === 'DELETE') {
      tx(() => { q.delFile.run(f.id); q.insertHist.run(f.application_id, Date.now(), 'File removed: ' + f.kind); q.touch.run(Date.now(), f.application_id); });
      removeStored([f.stored_name]);
      return json(res, 200, { ok: true });
    }
  }
  if (rest[0] === 'export.csv' && m === 'GET') {
    return send(res, 200, csv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rsa-applicants-' + ymd() + '.csv"', 'Cache-Control': 'no-store' });
  }
  if (rest[0] === 'backup' && m === 'GET') {
    const tmp = path.join(DATA, 'backup-' + crypto.randomBytes(6).toString('hex') + '.db');
    db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
    const size = fs.statSync(tmp).size;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Content-Disposition': 'attachment; filename="rsa-database-' + ymd() + '.db"', 'Cache-Control': 'no-store' });
    const s = fs.createReadStream(tmp); s.pipe(res);
    const done = () => { try { fs.unlinkSync(tmp); } catch (e) {} };
    s.on('close', done); res.on('close', done);
    return;
  }
  throw new HttpError(404, 'Not found.');
}

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SITE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const ADMIN_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function serveStatic(req, res, url) {
  let name = decodeURIComponent(url.pathname);
  if (name === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (name === '/') { name = '/index.html'; }
  if (name === '/admin') { name = '/admin.html'; }
  const fp = path.join(PUBLIC, path.normalize(name).replace(/^(\.\.[\/\\])+/, ''));
  if (!fp.startsWith(PUBLIC + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { throw new HttpError(404, 'Not found.'); }
  const ext = path.extname(fp).toLowerCase();
  if (!TYPES[ext]) { throw new HttpError(404, 'Not found.'); }
  const body = fs.readFileSync(fp);
  const isAdmin = name === '/admin.html';
  send(res, 200, body, { 'Content-Type': TYPES[ext], 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400', 'Content-Security-Policy': isAdmin ? ADMIN_CSP : SITE_CSP });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (isHttps(req)) { res.setHeader('Strict-Transport-Security', 'max-age=31536000'); }
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) { await api(req, res, url); }
    else if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, url); }
    else { throw new HttpError(405, 'Not allowed.'); }
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch (x) {} return; }
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError)) { console.error(new Date().toISOString(), e); }
    json(res, status, { ok: false, error: e instanceof HttpError ? e.message : 'Something went wrong. Please try again.' });
  }
});
server.requestTimeout = 120e3;
server.listen(PORT, HOST, () => { console.log('RSA & Gulf server running on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '\nData folder: ' + DATA); });
for (const sig of ['SIGINT', 'SIGTERM']) { process.on(sig, () => { server.close(() => { try { db.close(); } catch (e) {} process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); }); }
