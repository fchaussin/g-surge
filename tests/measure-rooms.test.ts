/**
 * Mesure, pas test : ce qu'un salon coûte en messages, par cadence. Ne tourne
 * qu'avec `MEASURE=1` — `npm run measure:rooms` — et ne vérifie rien, elle
 * imprime.
 *
 * C'est ce que le jalon M7 demande **avant** de fixer la cadence, et la seule
 * partie qui ne dépende de personne. Deux flux à chiffrer, par joueur :
 *
 * - **ce qu'il envoie** : sa trace en morceaux, les plages accumulées depuis
 *   le morceau précédent, empaquetées comme `packTrace` empaquette une trace
 *   entière — c'est le même encodage, deux octets par braquage sur la grille
 *   du 1/1024 ;
 * - **ce qu'il reçoit** : l'état des autres, relayé par l'objet. `NETWORK.md`
 *   fixe ce qui circule et rien d'autre — distance, décalage latéral, saut,
 *   lacet, barreau de poussée, épave — soit onze octets par vaisseau et par
 *   tour avec un encodage serré, plus l'en-tête du message.
 *
 * Cloudflare facture vingt messages WebSocket pour une requête d'objet. C'est
 * ce rapport, et non les octets, qui décide de la cadence : le plan gratuit
 * donne 100 000 requêtes d'objet par jour.
 */
import { describe, it } from 'vitest';
import { DT, packTrace, quantiseSteer, Sim, type Trace } from '../src/sim/index.js';

/** Ce que `NETWORK.md` chiffre : plan gratuit, requêtes d'objet par jour. */
const FREE_OBJECT_REQUESTS = 100_000;
/** Messages WebSocket facturés pour une requête. */
const MESSAGES_PER_REQUEST = 20;
/** Taille d'un salon, à confirmer par l'auteur — quatre dans la proposition. */
const ROOM = 4;

/**
 * L'état relayé d'un vaisseau, en octets, avec un encodage serré :
 * `dist` en uint32 de centimètres, `lat` et `hop` en int16 de centimètres,
 * `yaw` en int16 de milliradians, le barreau et l'épave dans un octet, plus
 * un octet d'identifiant. Rien de tout cela n'est écrit : c'est le compte que
 * la mesure suppose, et il est ici pour être contredit par le code du jour où
 * il existera.
 */
const RELAY_BYTES_PER_SHIP = 4 + 2 + 2 + 2 + 1 + 1;

/** Un manche posé, 120 Hz, quantifié comme `input.ts` le fait. */
function stickRun(seconds: number): Trace {
  const sim = new Sim({ seed: 'room', difficulty: 'easy' });
  sim.reset('room');
  const steps = Math.round(seconds / DT);
  const perFrame = 6;
  let held = 0;
  let target = 0;
  let steer = 0;
  for (let i = 0; i < steps; i++) {
    if (i % perFrame === 0) {
      const f = i / perFrame;
      if (f % 48 === 0) target = Math.sin(f * 0.031) * 0.85;
      held += (target - held) * 0.12;
      steer = quantiseSteer(held);
    }
    sim.step({ steer, brake: false, boost: i % 2000 < 1400 }, DT);
  }
  return sim.trace();
}

/** Les plages d'une fenêtre de pas, sous la forme d'une trace à empaqueter. */
function window(t: Trace, fromStep: number, toStep: number): Trace {
  const keep: number[] = [];
  for (let i = 0; i < t.from.length; i++) {
    const at = t.from[i]!;
    if (at >= fromStep && at < toStep) keep.push(i);
  }
  return {
    // graine et difficulté ne voyagent pas dans un morceau : le salon les a.
    seed: '',
    difficulty: t.difficulty,
    steps: toStep - fromStep,
    from: keep.map((i) => t.from[i]! - fromStep),
    steer: keep.map((i) => t.steer[i]!),
    flags: keep.map((i) => t.flags[i]!),
    truncated: false,
  };
}

describe.skipIf(!process.env.MEASURE)('what a room costs, per cadence', () => {
  it('prints the message budget against the free plan', () => {
    const minutes = 3;
    const trace = stickRun(minutes * 60);
    const rows: string[] = [];

    for (const hz of [4, 10, 20]) {
      const stepsPerChunk = Math.round(1 / (hz * DT));
      let bytes = 0;
      let chunks = 0;
      let spans = 0;
      let biggest = 0;
      for (let at = 0; at < trace.steps; at += stepsPerChunk) {
        const w = window(trace, at, Math.min(at + stepsPerChunk, trace.steps));
        // un morceau vide ne s'envoie pas : le manche n'a pas bougé
        if (!w.from.length) continue;
        const size = packTrace(w).length;
        bytes += size;
        biggest = Math.max(biggest, size);
        spans += w.from.length;
        chunks++;
      }
      const perHour = (chunks / (minutes * 60)) * 3600;
      // ce qu'un joueur reçoit : un relais par tour, les autres vaisseaux
      const relay = RELAY_BYTES_PER_SHIP * (ROOM - 1) + 2;
      const messagesPerHour = perHour * 2; // le sien envoyé, le relais reçu
      const requestsPerHour = messagesPerHour / MESSAGES_PER_REQUEST;
      rows.push(
        `  ${String(hz).padStart(2)} Hz: ${chunks} morceaux en ${minutes} min ` +
          `(${(bytes / chunks).toFixed(1)} o en moyenne, ${biggest} au pire, ` +
          `${(spans / chunks).toFixed(1)} plages)\n` +
          `        ${Math.round(perHour)} envois/h, relais ${relay} o à ${ROOM} joueurs, ` +
          `${Math.round(messagesPerHour)} messages/h = ${Math.round(requestsPerHour)} requêtes/h\n` +
          `        montant : ${((bytes / (minutes * 60)) * 3600).toFixed(0)} o/h envoyés par joueur, ` +
          `plafond gratuit atteint à ${Math.floor(FREE_OBJECT_REQUESTS / requestsPerHour)} heures-joueur/jour`,
      );
    }

    console.log(
      `\nbudget d'un salon de ${ROOM}, manche posé, ${minutes} min de partie\n` +
        rows.join('\n') +
        '\n',
    );
  }, 120_000);
});
