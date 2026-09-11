/**
 * Le bout observateur de l'union d'événements, joué contre des doublures.
 *
 * `Feedback` ne touche au DOM et au son que par ses dépendances, donc des
 * objets qui se contentent de compter suffisent. Ce qui compte ici est
 * l'hystérésis de la réserve pleine : elle a été un événement de simulation,
 * elle tirait dix-huit fois là où trois étaient voulues parce qu'un frottement
 * de mur rogne 0,036 et que la réserve resature trois pas plus tard, et le test
 * qui l'avait pris a disparu quand la logique a quitté main.ts. Le voici.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/index.js';
import { Feedback, type FeedbackDeps } from '../src/client/feedback.js';

function doubles() {
  const calls = { boostReady: 0, pops: [] as string[], wrecks: 0, snaps: 0, buzzes: 0 };
  const deps = {
    audio: { play: () => undefined, boostReady: () => void calls.boostReady++ },
    haptics: { buzz: () => void calls.buzzes++ },
    hud: { showPop: (text: string) => void calls.pops.push(text) },
    camera: { driftExitSnap: () => void calls.snaps++ },
    ship: { setHalo: () => undefined },
    onWreck: () => void calls.wrecks++,
  } as unknown as FeedbackDeps;
  return { calls, feedback: new Feedback(deps) };
}

describe('the boost-ready hysteresis', () => {
  it('announces a refill once, after the reserve dipped under the arming level', () => {
    const { calls, feedback } = doubles();
    const sim = new Sim({ seed: 'ready' });
    sim.reset('ready');
    const tick = () => feedback.update(1 / 60, sim.state, sim.tuning, true);

    sim.state.energy = 100;
    for (let i = 0; i < 10; i++) tick();
    expect(calls.boostReady).toBe(0); // plein depuis le départ : rien à annoncer

    sim.state.energy = 60;
    tick();
    sim.state.energy = 100;
    for (let i = 0; i < 10; i++) tick();
    expect(calls.boostReady).toBe(1);
  });

  it('ignores a wall scrape shaving a few hundredths off a full reserve', () => {
    const { calls, feedback } = doubles();
    const sim = new Sim({ seed: 'ready' });
    sim.reset('ready');
    const tick = () => feedback.update(1 / 60, sim.state, sim.tuning, true);

    sim.state.energy = 60;
    tick();
    sim.state.energy = 100;
    tick();
    expect(calls.boostReady).toBe(1);

    // Dix-huit frottements, chacun suivi d'une resaturation : c'est le cas qui
    // faisait tirer l'ancien événement dix-huit fois.
    for (let i = 0; i < 18; i++) {
      sim.state.energy = 100 - 0.036;
      tick();
      sim.state.energy = 100;
      tick();
    }
    expect(calls.boostReady).toBe(1);
  });

  it('stays silent outside a run', () => {
    const { calls, feedback } = doubles();
    const sim = new Sim({ seed: 'ready' });
    sim.reset('ready');
    sim.state.energy = 60;
    feedback.update(1 / 60, sim.state, sim.tuning, false);
    sim.state.energy = 100;
    feedback.update(1 / 60, sim.state, sim.tuning, false);
    expect(calls.boostReady).toBe(0);
  });
});

describe('the event consumer', () => {
  it('ends the run on a wreck, and nowhere else', () => {
    const { calls, feedback } = doubles();
    feedback.consume([{ type: 'land' }, { type: 'scrape' }, { type: 'wreck' }]);
    expect(calls.wrecks).toBe(1);
  });

  it('gives a found and an earned super boost the same shockwave', () => {
    const { calls, feedback } = doubles();
    feedback.consume([{ type: 'pickup', kind: 'sup' }]);
    feedback.consume([{ type: 'supEarned' }]);
    expect(calls.pops).toEqual(['SUPER BOOST', 'SUPER BOOST']);
  });

  it('recentres the camera only after a drift long enough to have moved it', () => {
    const { calls, feedback } = doubles();
    feedback.consume([{ type: 'driftEnd', held: 0.05 }]);
    expect(calls.snaps).toBe(0);
    feedback.consume([{ type: 'driftEnd', held: 0.5 }]);
    expect(calls.snaps).toBe(1);
  });
});
