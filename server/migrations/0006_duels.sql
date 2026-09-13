-- Un compteur de duels par joueur, clé ULID.
--
-- L'identifiant entier des comptes reste la clé interne ; l'ULID est la clé
-- publique, celle par laquelle un joueur se désigne hors de la base — triable
-- par date de création, sans rien dire du nombre de comptes. Généré à la
-- création du compte, et posé après coup sur ceux qui n'en avaient pas.
ALTER TABLE accounts ADD COLUMN ulid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_by_ulid ON accounts (ulid);

-- Un duel n'entre pas au tableau ; il compte. Trois entiers par joueur, que
-- l'objet salon incrémente au classement, et rien d'autre n'est gardé d'une
-- course — ni trace, ni adversaire, ni temps.
CREATE TABLE IF NOT EXISTS duels (
  ulid TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0
);
