/**
 * La semaine du tableau : lundi 00:00 UTC, une clé ISO 8601 (`AAAA-Wss`).
 *
 * Une clé plutôt qu'une date : deux parties dans la même semaine calendaire
 * partagent la même clé, et le calcul ne dépend d'aucun fuseau — tout est en
 * UTC, `this.now(req)` de l'arbitre est la seule horloge qui compte.
 */
export function epoch(now: number): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Le prochain lundi 00:00 UTC strictement après `now`, en millisecondes. */
export function nextReset(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const add = (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.getTime();
}
