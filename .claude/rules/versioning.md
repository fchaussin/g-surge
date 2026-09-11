# Versioning

The version in `package.json` is what the splash and the menu stamp show,
`V1.1.0 · <commit>`. It therefore moves with the code, as work lands, not at
some release moment nobody schedules.

## When to bump

- **Every push that changes the deployed bundle carries a bump.** Either in the
  commit that makes the change, or in a `Version x.y.z` commit right after it,
  before pushing. A bundle change that leaves the version where it was is a
  mistake to fix before `git push`.
- **Documentation, tests and tooling alone do not bump.** They change nothing
  the player receives. Nor does a comment-only edit in `src/`: when in doubt,
  `npm run build` before and after and compare the hashed name under
  `public/assets/` — the same name is the same bundle, measured rather than
  assumed.
- **Several changes pushed together share one bump**, at the highest level any
  of them warrants.

## Which level

| Level | What landed | Example |
|---|---|---|
| patch | a fix, a refactor, a visual or audio touch that does not change how the game plays — and a retune that corrects a value found wrong in play, even when a `physics-*.json` fixture moves with it | splitting `main.ts`; the HUD coming loose in a surge; the dry tank capping the cruise |
| minor | a new feature, or a rebalance that changes the design rather than corrects a value | the G-SURGE; `supFactor` 1.08 → 1.22 |
| major | a break — leaderboard or preference format, controls, a removed feature | a new scoring key that abandons the old board |

A rebalance is not a break, in this repository's reading of semver: the player
keeps everything, the numbers under them moved. And a retune is not a feature:
the author's word for the 1.15.x series was "fixes, not features", and the
version says so — the rule above was reworded on 11 September 2026 to match.

## How

```
npm version patch --no-git-tag-version     # or minor, major
```

It rewrites `package.json` and `package-lock.json` together, and nothing else.
No git tag: the stamp already carries the commit, and the 1.1.0 bump set the
precedent of tagging nothing. The menu's visual reference does not move on a
bump, because it freezes the stamp's text rather than masking it.

The commit message says what the bump covers and why it is the level it is —
see `git show 61954a8` for the shape.
