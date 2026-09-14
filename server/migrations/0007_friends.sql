-- Les amis, et les défis qu'ils se lancent.
--
-- Avant ceci, courir contre quelqu'un demandait de lui faire parvenir un lien
-- par un moyen que le jeu ne connaît pas. Une amitié est un lien gardé une
-- fois pour toutes, et un défi est un salon qu'un ami tient ouvert pour un
-- autre — sans présence, sans notification : l'invité le trouve en ouvrant le
-- jeu, tant qu'elle n'a pas expiré.

-- Le code d'ami : ce qu'on se dicte. Six caractères contre les vingt-six de
-- l'ULID, qui reste la clé publique du compte et ne sert pas à ça.
ALTER TABLE accounts ADD COLUMN code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_by_code ON accounts (code);

-- Une amitié : `a` a demandé, `b` a reçu. La paire est unique dans ce sens ;
-- la demande inverse est acceptée plutôt que dupliquée.
CREATE TABLE IF NOT EXISTS friends (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS friends_by_b ON friends (b);

-- Un défi : le salon est déjà ouvert quand la ligne est écrite, et il ne vaut
-- que le temps de l'expiration — un salon oublié ne doit pas attendre demain.
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account INTEGER NOT NULL,
  to_account INTEGER NOT NULL,
  room TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_by_to ON challenges (to_account, expires_at);
