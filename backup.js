'use strict';
/* Makes a dated copy of the database and all uploaded documents.
 * Run:  node backup.js            (copies into ./backups/YYYY-MM-DD)
 * Keep the copy on another disk or computer. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const OUT = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, 'backups'));
const d = new Date();
const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dest = path.join(OUT, stamp);
fs.mkdirSync(dest, { recursive: true });
const dbFile = path.join(DATA, 'rsa.db');
if (!fs.existsSync(dbFile)) { console.error('No database found at ' + dbFile); process.exit(1); }
const target = path.join(dest, 'rsa.db');
if (fs.existsSync(target)) { fs.unlinkSync(target); }
const db = new DatabaseSync(dbFile);
db.exec("PRAGMA busy_timeout = 5000; VACUUM INTO '" + target.replace(/'/g, "''") + "'");
db.close();
const up = path.join(DATA, 'uploads');
if (fs.existsSync(up)) { fs.cpSync(up, path.join(dest, 'uploads'), { recursive: true }); }
console.log('Backup saved to ' + dest);
