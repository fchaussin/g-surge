-- Chaque partie rejouée par l'arbitre, avec l'issue qu'il a calculée.
-- Les tableaux (hebdomadaire, mondial) viendront par-dessus ; ceci est le
-- journal brut, et la trace elle-même n'y est pas encore.
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  core TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  seed TEXT NOT NULL,
  steps INTEGER NOT NULL,
  score REAL NOT NULL,
  dist REAL NOT NULL,
  time REAL NOT NULL,
  coins INTEGER NOT NULL,
  mult REAL NOT NULL,
  wrecked INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_by_board ON runs (core, difficulty, score DESC);
