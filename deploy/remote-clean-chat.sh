#!/usr/bin/env bash
set -e
cd /opt/neya-erp
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db <<'SQL'
DELETE FROM tasks WHERE created_at > NOW() - INTERVAL '15 minutes';
DELETE FROM assistant_messages;
SQL
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node <<'NODE'
(async () => {
  const login = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@neya.local', password: 'neyha31250' }),
  });
  const { token } = await login.json();
  const f = new FormData();
  f.append('message', 'Bonjour, qui es-tu en une phrase ?');
  const res = await fetch('http://localhost:4000/api/assistant/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: f,
  });
  console.log(await res.text());
})().catch((e) => { console.error(e); process.exit(1); });
NODE
