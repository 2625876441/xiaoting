# 🐣 Monster Slingshot · Physics Slingshot Shooter

A **pure front-end** physics slingshot game: drag the monster backwards, release to launch, knock down the structures and wipe out every target.
Vanilla **Canvas 2D + Matter.js** — no framework, no build step, no bundler. Just double-click `index.html` and play.

> 100 levels · 6 skins (each with passive + active skills) · 5 scene themes · ammo-based star rating

[简体中文](README.md) | **English**

## 🌐 Play Online

**https://monster-slingshot.app.workbuddy.host/**

Runs in any browser on phone, tablet or desktop. No installation required.

## 🎮 How to Play

1. **Aim by dragging** — pull the monster back on the slingshot. A **predicted trajectory** is drawn in real time: it uses the exact same parameters as the real flight (thrust acceleration + air drag + three-wall bouncing + ground bounces), and the red crosshair at the end of the arc is the predicted landing point.
2. **Release to fire** — power comes from the pull distance (max 105px). Initial speed starts at 30 and is boosted up to 35 along the flight direction.
3. **Knock down structures** — wood, ice and stone have different durability, and collapsing structures trigger a physics explosion. Ice shatters on contact; stone is noticeably reinforced in the last 50 levels.
4. **Destroy all targets** — clear every monster on screen to win. Being crushed by a structure, caught in a blast, or hit directly by the bird all count.
5. **Small bombs** (from level 31) — bombs sit on top of structures. If the bird **hits one directly it explodes and you lose**; if it loses support and falls to the ground it disappears harmlessly.
6. **Active skill** — while flying, press `Space` or tap the screen to trigger your current skin's skill.

**Stars are based on ammo left:** ≥2 shots left = ★★★, 1 shot left = ★★☆, and even a last-shot miracle finish is guaranteed ★☆☆.

## 🐍 100 Levels & Smooth Difficulty Curve

Difficulty does not jump in tiers — it **ramps up continuously** from level 1 to level 100:

| Difficulty factor | Level 11 | Level 100 |
|---|---|---|
| Stone ratio | 18% | 88% |
| Tower height | 70px | 94px |
| Second tower floor / pyramid cap / bunker roof chance | 42% / 20% / 15% | 77% / 75% / 70% |
| Chance of 3 structure groups | 25% | 70% |
| Stone HP (linear rise from level 31) | 120 | 168 |
| Bomb spawn rate (from level 31) | 30% | 60% (from level 63: cap 3 + double guarantee) |

Tier labels blend smoothly: 11-35 Advanced → 36-61 Hard → 62-88 Expert → 89-100 Hell.
Levels 1-10 are hand-designed; from level 11 onward layouts are produced by a deterministic RNG (mulberry32) — **the same level always looks the same**.

## 🧬 Skins & Skills

The green frog (simple model) is the starting skin; a new skin is randomly unlocked every 15 levels (15 / 30 / 45 / 60 / 75).

| Skin | Passive | Active (Space / tap) |
|---|---|---|
| 🐸 Frog | Balanced | None |
| 👾 Orange Monster | Stronger split | **Split**: splits into two flying apart in different directions |
| 🐤 Chick | Largest blast radius (230) | **Air burst**: detonates this shot mid-air, no ground explosion afterwards |
| 😈 Flame Demon | High blast power, small radius | **Air burst + remote bomb detonation** (does not count as a loss) |
| 🧊 Ice Blue | Blast directly damages blocks (fragmentation) | **Air burst + fragmentation** (can even blow up stone) |
| 🦄 Unicorn | Armour piercing ×2.5 | **Dash**: speed ×1.5 (capped at 42), once per shot |

## 🌄 5 Scene Themes (rotating every 20 levels)

| Levels | Theme | Highlights |
|---|---|---|
| 1-20 | Dawn Meadow | Sun with rotating rays, trees + small flowers |
| 21-40 | Peach Afternoon | Warm orange tones, trees + flowers + hot-air balloon |
| 41-60 | Mint Valley | Fresh greens, flock of birds + trees + flowers |
| 61-80 | Lavender Dusk | Moon (with phases) + few stars, fireflies |
| 81-100 | Starry Camp | Deep night sky + full starfield, fireflies + campfire |

Decoration placement is generated from the level seed — **different between levels, stable within a level**. Animated elements: drifting clouds, twinkling stars, rotating sun rays, flapping birds, wandering fireflies, flickering campfire.

## ✨ Visual & Interaction Highlights

- 🎨 Fully hand-drawn monsters (no image assets at all): highlights, shading, belly, eye glints, blush, eyebrows, and squash-and-stretch based on speed
- 🌀 Explosion shockwaves, flying particles, wood splinters, floating score text
- 🧭 High-visibility trajectory preview: white-core orange-edge flowing dots, pulsing landing crosshair, faded bounce prediction dots
- 📱 Chip-style HUD (level / ammo / targets / bombs / skill hint), fully canvas-scaled and touch-playable on mobile
- 💾 localStorage saves: per-level stars, unlock progress, last selection, skins and unlock times; **when storage is unavailable (sandbox / incognito) it degrades to an in-memory save and the game still plays fine**

## 🐛 Bugs We Hit (and Fixed)

1. **Could not launch**: Matter.js `setStatic` does not restore mass after `isStatic: true` → `setStatic(false)` leaves mass `Infinity` and the position becomes `NaN`.
   Fix: during aiming, only record `aimPos` in plain JS (no body created); the dynamic body is created **at the moment of launch** with `setVelocity`.
2. **"Play again" auto-completed the level**: the previous round's 700ms win timer still fired after restarting.
   Fix: `roundId` round counter + timer handle + state guards in `win()/lose()`.
3. **Crash from level 11 on**: `LEVELS[idx]` was hard-coded, and generated levels don't exist in that array.
   Fix: `LEVELS[idx] || getLevel(idx)`, verified by building all 100 levels.
4. **Stuck after clearing level 10**: when the level count went from 10 to 100, three places still used `LEVELS.length` (unlock check / button visibility / jump cap).
   Fix: use `TOTAL_LEVELS` everywhere + save self-healing (derive unlock progress from existing stars, take the `max`).
5. **Static walls lost their bounce**: in Matter 0.19/0.20 a static wall's `restitution` had no measurable effect (bounce factor stuck at ~0.33).
   Fix: manually mirror-reflect using the **pre-solve velocity** inside the `collisionStart` callback (reverse the normal component ×0.95).
6. **Thrust eaten by air drag**: with `BOOST_RATE = 0.07` the speed stalled around 30 (drag is about 0.18 per frame).
   Fix: raised it to 0.28, giving the intended 30 → 35 acceleration feel.
7. **Trajectory preview "looked right but wasn't"**: the preview only accounted for initial speed + gravity, while the real flight also has thrust, drag and bouncing — the error grew along the arc (up to 1272px for a full-power wall bounce).
   Fix: the preview now simulates **the exact same parameters** frame by frame, cutting the error to 13–67px, plus a landing marker and bounce prediction.
8. **False-positive tests**: earlier tests drove the loop with large time steps (250ms), which jumped past every timing threshold and hid defects such as a wrong accumulator making bodies stand still. All tests now use **real 60fps fine frames (16.7ms/frame)**.

## 🚀 Running Locally

Just double-click `index.html` — no dependencies, no server needed (the physics engine is bundled in `vendor/`).
To force the CDN build instead, delete `vendor/matter.min.js`; `index.html` falls back automatically.

## ✅ Tests

Zero-dependency smoke test using only Node built-ins:

```
node test_smoke.js
```

It uses `vm` plus a hand-written DOM stub to load `script.js` (with the bundled Matter.js) in a browserless environment, **deliberately throwing a `SecurityError` from `localStorage`** to reproduce a sandbox, and verifies 53 assertions:

- Syntax and file-reference integrity; the script loads without crashing in a sandbox
- `load` boot flow: the menu renders 100 level tiles and the skin cards
- All 90 generated levels are structurally valid (nothing out of bounds, body count within limits, no bombs before level 31) and stone ratio rises with level
- Stone HP ramp (≈120 at level 31 → ≈168 at level 100)
- Scene themes rotate by level segment; all 5 theme objects are complete
- Stars = ammo left (0 / 1 / ≥2 shots → 1 / 2 / 3 stars)
- Launch chain: press to grab → drag → release → real physics flight (fine-frame driven, per-frame trajectory sampling, NaN checks, zero error frames)
- Active skill triggers split on Space, and cannot fire twice for the same shot
- Win/lose resolution (delayed win, loss on out of ammo, state guards preventing duplicate resolution, restart works)

> When no browser is available in an isolated environment, this is the cheapest possible insurance that the game really is playable.

## ☁️ Deployment

A pure static site — any static host works:

**Option 1 · Vercel (recommended)**

```bash
git init
git add .
git commit -m "feat: monster slingshot"
git branch -M main
git remote add origin https://github.com/<your-name>/monster-slingshot.git
git push -u origin main
```

Open [vercel.com](https://vercel.com) → sign in with GitHub → **Add New Project** → import the repo → Framework Preset `Other` → Deploy.

**Option 2 · GitHub Pages**: repo Settings → Pages → Source = `main` branch root.

## 📁 Project Structure

```
monster-slingshot/
├── index.html        # Page structure: canvas / HUD / menu / result overlay (loads style.css + script.js)
├── style.css         # Page skeleton, HUD, overlays, skin cards, level tiles
├── script.js         # All gameplay: level generation / physics structures / slingshot / explosions / skin skills / scene themes / saves / rendering
├── test_smoke.js     # Zero-dependency smoke test (node test_smoke.js)
├── vendor/
│   └── matter.min.js # Matter.js 0.19.0 (bundled, works offline; falls back to CDN when missing)
├── README.md         # 简体中文说明
├── README.en.md      # This file
└── LICENSE           # MIT
```

## 📄 License

[MIT](LICENSE). Matter.js is distributed under its own MIT license.
