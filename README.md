# If It Fits

A cozy, no-fail soft-body puzzle. Nudge, tip and coax squishy cats into teacups,
boots, boxes and sinks until every cat fits and sits. A new room every morning.

> Cats are liquid. Prove it: pour this chonk into a teacup.

Mobile-web first (portrait), plays fine on desktop. No accounts, no network,
no ads: a static site you can host anywhere, upload to itch.io, or hand to a
portal as a single HTML file.

## Play

```bash
npm install
npm run dev          # http://localhost:5173
```

- **Drag** a cat to pick it up and carry it. Every cat can be lifted; heavier
  cats lag behind your finger and stretch on the way.
- Let go over a container (or let a cat **ooze off a shelf**) and it pours in.
  If it fits, it sits.
- **Tap** a cat to boop it: a little hop.
- **Undo** is always free; there's no way to fail.
- Snug fits earn **cozy points**; every nudge is a **paw**; **par** is what the
  solver needed.
- When the last cat settles, the camera pans across the room while the purring
  builds (**Fits & sits**), then you can share a spoiler-free grid of cat faces.

Handy URLs while developing: `?room=1|2|3` (hand-made rooms), `?daily=2026-10-05`
(any morning), `?sandbox` (the photo room).

## What's in the box

| Pitch | Where it lives |
| --- | --- |
| Soft-body cat rig (pressure-spring blob, 24-32 nodes, fixed-step physics) | `src/physics/` |
| Breeds with their own flow: kitten = water, Persian = honey, chonk = pudding, sphynx = jelly, tabby = custard, Maine Coon = cloud, plus a secret cat | `src/physics/breeds.ts` |
| Shared prop library (teacup, mug, boot, box, shoebox, fruit bowl, sink, flower pot, laundry basket, saucepan, vase, bucket, slipper, mixing bowl; shelves, counters, stools, tables, fridges, bookcases...) | `src/game/props.ts`, art in `src/render/propArt.ts` |
| Three hand-made rooms: Sunny Kitchen (the 5-second clip), Bath Time, Midnight Study | `src/game/rooms.ts` |
| Cozy points by snugness, not failures | `src/game/fit.ts` |
| A new room every morning, generated from the prop library, checked by a solver for a fair par | `src/game/generator.ts`, `src/game/solver.ts` |
| Fits & sits reveal: camera pan, purrs swell, cat-face row turns gold | `src/app.ts`, `src/render/renderer.ts` |
| Spoiler-free share grid | `src/game/share.ts` |
| Sandbox photo room: pour any cat into anything, take a polaroid | `src/sandbox.ts` |
| 6 + 1 collection | menu → Cat collection |
| Gouache look, paper grain, round chunky tin-can buttons, Baloo 2 + Nunito | `src/render/`, `src/styles.css` |
| Glorps, clinks, layered purrs, gentle piano and brushed drums (all synthesized) | `src/audio/` |

## How it works

**Cats.** Each cat is a ring of nodes simulated with position-based dynamics at
60 Hz x 8 substeps (two constraint passes each). The skin behaves like a liquid
surface (constant tension, evened-out spacing), an area constraint keeps the
volume, weak shape matching gives each breed its loaf, and viscosity damps only
deformation, so a honey Persian falls as fast as a water kitten but oozes much
more slowly. The skin is solid between nodes and can't pass through itself, so
a cat dragged over a rim drapes over it like a sack instead of letting the
wall slice through. Seated cats get rest damping so they loaf calmly, and a cat that
has rested truly still for a moment falls asleep: it is frozen (no solver
chatter at all) until a finger, a boop, a game nudge, a cat bumping into it or
a moved prop wakes it. The face always floats to the top of the blob, so a cat
poured into a teacup still reads as a loaf with two ears.

**Painting.** Everything is painted in code with one shared kit
(`src/render/paint.ts`): a single warm light from the upper left, painterly
shadow and light colours (shifted toward violet and toward warm yellow rather
than mixed with grey), shading that hugs any outline, and tileable procedural
textures (fur, wood grain, plaster, brush strokes, cardboard, weave) laid over
the flat gouache colour. Cats are repainted every frame from the physics ring:
locks of fur are worked into the silhouette, then coat markings, fur texture,
form shading, occlusion underneath and a rim of light; ears with pink insides,
dot eyes with highlights, whisker pads, little paws, and a slow breath while
resting. Ears follow the top of the head smoothly (eased in the head's frame),
and fur lies flat wherever a cat presses against a wall or glass. Every
container is glass, so you can watch a cat squish into it: the body is painted
under the container's translucent front, its front paws over the rim, and it
sits in a soft shadow on the container's floor. The rooms get plaster walls,
wainscoting, plank floors, deep windows with a painted view, light shafts with
drifting dust, and lamp-lit nights. The room and the props are painted once
into cached layers.

**Fitting.** Containers have a cavity polygon. A cat touching a container makes
a sticky decision: pour in (a damped pull toward the opening plus a gentle
"slurp" on the part already inside), slide off a rim it's balancing on, or, if
it really doesn't fit, just perch. Cozy points come from how full the cavity is
and how much of the cat is in it; a loaf poking out is perfect.

**The finger.** A drag pulls the whole cat (65%) and stretches the touched part
toward your finger (35%). Its strength is a multiple of the cat's weight (3.2x
for the kitten down to 2.5x for the chonk, 80% of it allowed upward), so every
cat can be carried and the heavy ones simply lag, sag and slide further. A
strongly damped spring eases the cat up to the finger without bobbing. Undo
snapshots everything.

**Mornings.** The date seeds an integer RNG. The generator composes the room
from tested vignettes (a shelf over a cup, a counter beside a stool, a cabinet
beside a box, a sill over a boot, a high shelf over a table) and decorates it.
The solver then plays it like a person, dragging one cat at a time and letting
go once the cat is over the opening, and only publishes rooms where every cat
gets seated. The number of nudges it needed is par. The simulation only uses
`+ - * /` and `sqrt` (plus a deterministic sine), so every device builds and
checks the same room. To make mornings load instantly, `npm run precompute`
runs the same generator and solver ahead of time and stores which variant
passed, its par and the solver's plan (used for hints) in
`src/game/daily-index.json` (about 100 bytes a day). Any date outside the index
is generated and solved in a Web Worker on the player's device and cached.
Changing the generator bumps `GENERATOR_VERSION`; re-run the precompute (a test
checks the index still matches).

## Scripts

```bash
npm run dev           # dev server
npm test              # unit tests (physics, scoring, solver, generator, saves)
npm run e2e           # Playwright smoke tests (builds + previews first)
npm run typecheck
npm run build         # static site in dist/
npm run build:single  # one self-contained HTML file in dist-single/ (portals, itch.io)
npm run precompute    # re-solve the next 200 mornings into src/game/daily-index.json
```

For the e2e tests on a machine with a system Chromium:
`PLAYWRIGHT_CHROMIUM=/path/to/chrome npm run e2e`.

## Deploying

`dist/` is a plain static site with relative paths: drop it on any static host
(GitHub Pages, Netlify, itch.io as an HTML game). `dist-single/index.html` is the
same game in one file, for portals that want a single upload.

## Credits

Fonts: [Baloo 2](https://github.com/EkType/Baloo2) and
[Nunito](https://github.com/googlefonts/nunitofont), SIL Open Font License,
bundled via Fontsource. Everything else (art, sound, music) is generated in code.
