-- La vitesse de pointe de la partie, pour un tableau classé par catégorie
-- plutôt que par le seul score — voir CATEGORY_ORDER dans arbiter.ts.
ALTER TABLE runs ADD COLUMN speed_peak REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS runs_board_dist ON runs (epoch, difficulty, dist DESC);
CREATE INDEX IF NOT EXISTS runs_board_speed ON runs (epoch, difficulty, speed_peak DESC);
