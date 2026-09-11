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
| patch | a fix, a refactor, a visual or audio touch that does not change how the game plays | splitting `main.ts`; the HUD coming loose in a surge |
| minor | a new feature, or a rebalance — any commit that regenerates a `physics-*.json` fixture is at least a minor | the G-SURGE; `supFactor` 1.08 → 1.22 |
| major | a break — leaderboard or preference format, controls, a removed feature | a new scoring key that abandons the old board |

A rebalance is not a break, in this repository's reading of semver: the player
keeps everything, the numbers under them moved.

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
