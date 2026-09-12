-- La semaine du tableau, le nom envoyé avec la partie, et la réclamation du
-- client à côté de l'issue que le serveur a rejouée : un écart entre les deux
-- est un signal de triche ou de dérive, jamais un motif de refus.
ALTER TABLE runs ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN epoch TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN claim TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN mismatch INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS runs_board ON runs (epoch, difficulty, score DESC);
