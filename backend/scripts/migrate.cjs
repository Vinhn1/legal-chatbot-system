/* Chạy migration có checksum và khóa chung; không ghi cấu hình kết nối ra log. */
const { Client } = require('pg');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function migrate() {
  const client = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(26102407)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT NOW())');
    const directory = path.resolve(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d{8}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) throw new Error('Migration đã áp dụng bị sửa đổi.');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
        console.log(`Đã áp dụng ${name}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.log('Migration hoàn tất.');
  } finally { await client.query('SELECT pg_advisory_unlock(26102407)').catch(() => {}); await client.end(); }
}
migrate().catch(() => { console.error('Migration thất bại. Kiểm tra schema, quyền truy cập và checksum; không tự sửa dữ liệu.'); process.exitCode = 1; });
