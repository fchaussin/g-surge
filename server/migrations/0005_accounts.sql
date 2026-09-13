-- Les comptes, et ce qui les nomme.
--
-- Deux champs et rien d'autre, comme le jalon M6 le veut : le sujet opaque
-- que le fournisseur donne, et un nom d'affichage. Pas d'adresse, pas de
-- courriel — moins on garde, moins on doit. `provider` + `subject` est
-- l'identité ; le même humain avec deux fournisseurs est deux comptes, et
-- c'est assumé.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);

-- Les sessions sont des lignes, pas des jetons auto-suffisants : se
-- déconnecter ou supprimer son compte doit invalider ce qui circule encore,
-- et un jeton signé sans ligne ne s'invalide pas.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);

-- Une partie classée porte son compte. Nul pour celles d'avant les comptes.
ALTER TABLE runs ADD COLUMN account_id INTEGER;
CREATE INDEX IF NOT EXISTS runs_by_account ON runs (account_id);
