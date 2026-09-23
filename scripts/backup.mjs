import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH || './data/bookings.sqlite');
const target = process.argv[2] && resolve(process.argv[2]);
if (!target || target === source || existsSync(target) || !existsSync(source)) {
  console.error('Usage: node scripts/backup.mjs /path/to/NEW-backup.sqlite (source must exist; destination must not exist)');
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); console.log('Backup completed.'); }
finally { db.close(); }
