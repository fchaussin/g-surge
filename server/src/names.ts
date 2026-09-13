/**
 * Le nom d'un joueur, tel que le tableau le montre : deux à seize
 * caractères, lettres et chiffres de toute écriture, espace, tiret, souligné.
 * Un seul domicile pour la règle — le tableau et le profil lisent la même.
 */
export const NAME_RE = /^[\p{L}\p{N} _-]{2,16}$/u;

/** Le nom assaini, ou `PILOT` s'il ne vaut rien. */
export function sanitiseName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return NAME_RE.test(trimmed) ? trimmed : 'PILOT';
}

/** Vrai si le nom est acceptable tel quel — pour refuser plutôt que remplacer. */
export const validName = (name: unknown): name is string =>
  typeof name === 'string' && NAME_RE.test(name.trim());
