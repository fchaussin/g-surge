/**
 * Les origines qui ont le droit d'appeler — et vers lesquelles une connexion
 * peut renvoyer. Le jeu en production, ses préversions, le développement.
 * Une seule liste pour les deux usages : une origine à qui l'on répond est
 * une origine vers qui l'on peut rediriger, et réciproquement.
 */
export const ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?g-surge\.w23\.fr$/,
  /^https:\/\/w23\.fr$/,
  /^https:\/\/([a-z0-9-]+\.)?g-surge\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
];

export const allowedOrigin = (origin: string): boolean => ORIGINS.some((re) => re.test(origin));
