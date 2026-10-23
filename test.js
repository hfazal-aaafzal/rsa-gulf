'use strict';
/* Self-test: starts the server on a temporary folder and checks the main paths.  Run: node test.js */
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsa-test-'));
const PW = 'test-password-123';
const base = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const body = (extra) => Object.assign({ name: 'Muhammad Ali', city: 'Rawalpindi', address: 'House 5, Saddar', whatsapp: '0300 1234567', passport: 'AB1234567', docs: ['Passport'], files: [{ kind: 'passport', name: 'pass.png', data: png.toString('base64') }, { kind: 'cv', name: 'cv.pdf', data: pdf.toString('base64') }] }, extra || {});
const post = (p, b, h) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h || {}), body: JSON.stringify(b) });

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, ADMIN_PASSWORD: PW, HOST: '127.0.0.1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false; srv.stdout.on('data', (d) => { if (/running/.test(String(d))) { started = true; } });
  srv.stderr.on('data', () => {});
  for (let i = 0; i < 50 && !started; i++) { await new Promise((r) => setTimeout(r, 100)); }
  ok('server starts', started);
  try {
    const hl = await (await fetch(base + '/api/health')).json(); ok('health', hl.ok && hl.app === 'rsa-gulf');
    const home = await fetch(base + '/'); ok('site served', home.status === 200 && /RSA/.test(await home.text()));
    ok('csp header on site', /default-src 'self'/.test(home.headers.get('content-security-policy') || ''));
    ok('admin page served', (await fetch(base + '/admin')).status === 200);
    ok('data folder not reachable', (await fetch(base + '/data/rsa.db')).status === 404 && (await fetch(base + '/..%2fserver.js')).status === 404 && (await fetch(base + '/server.js')).status === 404);

    // public apply
    let r = await post('/api/apply', body()); let j = await r.json();
    ok('apply ok + reference', r.status === 200 && /^RSA-\d{4}-0001$/.test(j.ref), j);
    r = await post('/api/apply', body({ name: 'A' })); ok('short name rejected', r.status === 400);
    r = await post('/api/apply', body({ passport: 'BAD' })); ok('bad passport rejected', r.status === 400);
    r = await post('/api/apply', body({ passport: '', noPassport: true })); ok('no-passport accepted', r.status === 200);
    r = await post('/api/apply', body({ files: [{ kind: 'cv', name: 'x.exe', data: Buffer.from('MZ-not-an-image').toString('base64') }] })); ok('non-image file rejected', r.status === 400);
    r = await post('/api/apply', body({ files: Array(9).fill({ kind: 'cv', name: 'a.png', data: png.toString('base64') }) })); ok('too many files rejected', r.status === 400);
    r = await post('/api/apply', body({ website: 'http://spam' })); j = await r.json(); ok('honeypot silently dropped', r.status === 200 && j.ref === 'RSA-0000');

    // staff area is closed
    ok('list needs login', (await fetch(base + '/api/admin/applications')).status === 401);
    ok('file needs login', (await fetch(base + '/api/admin/files/1')).status === 401);
    ok('csv needs login', (await fetch(base + '/api/admin/export.csv')).status === 401);
    ok('backup needs login', (await fetch(base + '/api/admin/backup')).status === 401);
    r = await post('/api/login', { password: 'wrong-password' }); ok('wrong password refused', r.status === 401);
    r = await post('/api/login', { password: PW }); ok('login works', r.status === 200);
    const sc = r.headers.get('set-cookie') || ''; ok('cookie flags', /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc));
    const cookie = sc.split(';')[0], H = { Cookie: cookie, 'X-Requested-With': 'rsa' };
    ok('forged cookie refused', (await fetch(base + '/api/admin/applications', { headers: { Cookie: 'rsa_sid=abc.def' } })).status === 401);

    let list = await (await fetch(base + '/api/admin/applications', { headers: H })).json();
    ok('2 applications saved', list.rows.length === 2 && list.counts.new === 2, list.counts);
    const first = list.rows.find((x) => x.ref === 'RSA-' + new Date().getFullYear() + '-0001');
    ok('fields stored', first && first.name === 'Muhammad Ali' && first.city === 'Rawalpindi' && first.passport === 'AB1234567' && first.whatsapp === '03001234567' && first.file_count === 2, first);
    let d = await (await fetch(base + '/api/admin/applications/' + first.id, { headers: H })).json();
    ok('detail has files + history', d.files.length === 2 && d.history.length >= 2);
    const fr = await fetch(base + '/api/admin/files/' + d.files[0].id, { headers: H });
    const fb = Buffer.from(await fr.arrayBuffer());
    ok('file downloads intact', fr.status === 200 && fb.equals(png) && fr.headers.get('content-type') === 'image/png' && /sandbox/.test(fr.headers.get('content-security-policy')));
    ok('files stored on disk with random names', fs.readdirSync(path.join(DIR, 'uploads')).length === 4 && !fs.readdirSync(path.join(DIR, 'uploads')).some((n) => /pass|cv/.test(n)));

    // staff changes
    r = await fetch(base + '/api/admin/applications/' + first.id, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ status: 'contacted', follow_up: '2026-10-25', note: 'Called, will bring passport' }) });
    ok('patch ok', r.status === 200);
    d = await (await fetch(base + '/api/admin/applications/' + first.id, { headers: H })).json();
    ok('patch saved + history', d.status === 'contacted' && d.follow_up === '2026-10-25' && d.note.startsWith('Called') && d.history.some((x) => /Status: new to contacted/.test(x.text)));
    r = await fetch(base + '/api/admin/applications/' + first.id, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ status: 'hacked' }) }); ok('bad status refused', r.status === 400);
    r = await fetch(base + '/api/admin/applications/' + first.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status: 'visa' }) }); ok('CSRF header required for writes', r.status === 403);
    let s = await (await fetch(base + '/api/admin/applications?q=rawalpindi', { headers: H })).json(); ok('search by city', s.rows.length === 2);
    s = await (await fetch(base + '/api/admin/applications?q=ab1234567', { headers: H })).json(); ok('search by passport', s.rows.length === 1);
    s = await (await fetch(base + '/api/admin/applications?status=contacted', { headers: H })).json(); ok('filter by status', s.rows.length === 1);
    r = await post('/api/admin/applications', { name: 'Walk In', whatsapp: '03211234567', city: 'Attock' }, H); j = await r.json(); ok('staff can add applicant', r.status === 200 && /^RSA-/.test(j.ref));
    r = await post('/api/admin/applications/' + first.id + '/files', { files: [{ kind: 'cnic', name: 'cnic.png', data: png.toString('base64') }] }, H); ok('staff can attach file', r.status === 200);

    const csv = await (await fetch(base + '/api/admin/export.csv', { headers: H })).text();
    ok('csv export', /Ref,Name,City/.test(csv.replace(/"/g, '')) && /Muhammad Ali/.test(csv) && /Rawalpindi/.test(csv));
    r = await post('/api/apply', body({ name: '=HYPERLINK("x")' })); await r.text();
    const csv2 = await (await fetch(base + '/api/admin/export.csv', { headers: H })).text(); ok('csv formula guard', /"'=HYPERLINK/.test(csv2));

    const bk = await fetch(base + '/api/admin/backup', { headers: H }); const bb = Buffer.from(await bk.arrayBuffer());
    ok('backup is an SQLite file', bk.status === 200 && bb.slice(0, 15).toString() === 'SQLite format 3');
    await new Promise((r) => setTimeout(r, 300));
    ok('backup temp file removed', !fs.readdirSync(DIR).some((n) => /^backup-/.test(n)));

    // delete
    const before = fs.readdirSync(path.join(DIR, 'uploads')).length;
    const fid = d.files[0].id;
    r = await fetch(base + '/api/admin/files/' + fid, { method: 'DELETE', headers: H }); ok('delete one file', r.status === 200 && fs.readdirSync(path.join(DIR, 'uploads')).length === before - 1);
    const beforeApp = fs.readdirSync(path.join(DIR, 'uploads')).length;
    r = await fetch(base + '/api/admin/applications/' + first.id, { method: 'DELETE', headers: H }); ok('delete applicant', r.status === 200);
    ok('files removed from disk with applicant', fs.readdirSync(path.join(DIR, 'uploads')).length === beforeApp - 2, [beforeApp, fs.readdirSync(path.join(DIR, 'uploads')).length]);
    list = await (await fetch(base + '/api/admin/applications', { headers: H })).json(); ok('record gone', !list.rows.some((x) => x.id === first.id));

    // rate limit on login
    for (let i = 0; i < 9; i++) { await post('/api/login', { password: 'nope-nope-' + i }); }
    r = await post('/api/login', { password: PW }); ok('login rate limit', r.status === 429);
    // survives restart: data persists
  } catch (e) { fail++; console.log('FAIL  exception', e); }
  srv.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  // restart check
  const srv2 = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, ADMIN_PASSWORD: PW, HOST: '127.0.0.1' }), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const r = await post('/api/login', { password: PW }); const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    const l = await (await fetch(base + '/api/admin/applications', { headers: { Cookie: cookie } })).json();
    ok('data survives a restart', l.rows.length >= 3, l.rows.length);
  } catch (e) { fail++; console.log('FAIL restart', e); }
  srv2.kill('SIGTERM');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
