import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neya:neya@localhost:5432/neya_db',
});

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err);
});

export default pool;
