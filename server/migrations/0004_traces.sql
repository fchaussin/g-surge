-- Les octets de la trace, à part de la ligne qui la résume.
--
-- Une ligne de `runs` fait quelques centaines d'octets et se garde : c'est le
-- palmarès d'une semaine. Une trace fait des dizaines de kilo-octets et ne
-- sert qu'à être regardée, donc elle ne vit que tant que son entrée est au
-- tableau de la semaine en cours. Deux durées de vie, deux tables.
CREATE TABLE IF NOT EXISTS traces (
  run_id INTEGER PRIMARY KEY,
  bytes BLOB NOT NULL
);
