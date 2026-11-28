CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  country TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT NOT NULL,
  device TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
CREATE INDEX IF NOT EXISTS idx_visits_country_ip ON visits(country, ip_hash);
CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip_hash);
