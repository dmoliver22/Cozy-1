# If It Fits

A cozy, no-fail soft-body puzzle. Nudge, tip and coax squishy cats into teacups,
boots, boxes and sinks until every cat fits and sits. A new room every morning.

> Cats are liquid. Prove it: pour this chonk into a teacup.

It lives in a little house with two more games on the same cats: the page
opens in the **living room**, a sunny room twice as tall as the others where
your cats lounge, and everything starts from there: **If It Fits**, **Cat
Jar** and **Cat Drop** are the big buttons along the bottom. Two cats live
here at first; the other four **move in as you play**, each waiting on
something in one of the games. Every game earns **treats**, spent on
**perches** you put wherever you like (all the way up the living room's tall
wall) and on opening up the rest of the house: a **basement** right under the
living room and a **roof garden** up top, joined to it by glass tubes that are
there from the start, capped and padlocked until you open the floor they go
to. Scroll up and down to look round.

Mobile-web first (portrait), plays fine on desktop. No accounts, no network,
no ads: a static site you can host anywhere, upload to itch.io, or hand to a
portal as a single HTML file.

## Play

```bash
npm install
npm run dev          # http://localhost:5173
```

At home, tap one of the big buttons along the bottom to play. Your cats can
be picked up and booped here too (carry one to the top or the bottom of the
screen and the view scrolls along with it), and now and then one hops over to
another spot, up a run of perches if you've built one: they love the perches.
Tap the faces in the top bar for the cats card: who lives here, and what
brings each of the others home. A cat who's earned their place says so at
once, mid-game too, and hops in at the window the next time you're home.

| Cat | Moves in when you... |
| --- | --- |
| Pip (kitten), Mochi (tabby) | live here from the start |
| Duchess (Persian) | finish a room in If It Fits |
| Juniper (Maine Coon) | make a Maine Coon in Cat Jar |
| Biscuit (chonk) | eat 25 fish in one Cat Drop |
| Inkwell (the Void) | finish the Midnight Study in If It Fits (she lives there) |

The house:

- **Scroll** up and down (drag the wall, a mouse wheel, or the pills at the
  top and bottom naming the next stop) between the roof garden, up high in
  the living room, down by its floor, and the basement.
- **Treats** come from every game: a new If It Fits room (more for a cozy one
  in par), every 400 points in Cat Jar, fish and metres in Cat Drop, and a
  little present the cats leave on the rug the first time you're home each
  day. The **Shop** tin shows how many you have.
- **The shop** opens up the basement (the lid comes off the funnel in the
  living room floor, to drop a cat down to it) and the roof garden (the cap
  comes off the suction hood over the cat steps, to whoosh a cat up to it);
  a tap on a capped tube takes you to the shop. It sells perches: a wall
  shelf, a beanbag, a cushion ledge, a hammock, a wicker pod, a cloud shelf
  (it floats, even out in the sky over the roof) and a cat tree. Drag a new
  perch where you'd like it; press and hold one to move it.
- **The tubes**: drop a cat into the funnel, or let one go under a hood, and
  it squeezes through the glass like a sausage and pops out on the other
  floor; the view goes along with it.
- **Their ways**: every cat has a temperament (Pip is playful, Mochi
  easygoing, Duchess dramatic, Juniper a gentle hunter, Biscuit sleepy,
  Inkwell mischievous) and a mood that changes from day to day (sunny,
  grumpy, dozy), both on the cats card. Now and then one plays: it crouches
  low, creeps up, wiggles its back end and pounces, on the ball of yarn on
  the window sill (tap it to bat it about) or on another cat, who plays
  along, pays it no mind, or hisses. Two touchy cats sometimes **scrap**: a
  tumbling dust cloud with paws poking out, scratches and fluff flying. Tap
  the cloud to break it up. Left to it, one of them usually comes out
  **hurt**, with a plaster on and a sad face, and needs fish to feel better:
  tap it to feed it one, a treat each, until it's well (5 to 9).

In If It Fits:

- **Drag** a cat to pick it up by the scruff and carry it. The spot you pinch
  stays right under your finger and glides along smoothly however jumpy the
  touch; the skin there stretches up into a little tent as you lift (lift
  fast and it stretches tall before the cat comes up after it), and the rest
  of the cat dangles, long and droopy (a chonk droops like pudding), sways
  when you move and hangs straight when you hold still. In the hand every cat
  is soft and liquid: it flows into each new shape and never jitters.
- Let go over a container (or let a cat **ooze off a shelf**) and it pours in.
  If it fits, it sits.
- **Tap** a cat to boop it: a little hop.
- **Undo** is always free; there's no way to fail.
- Snug fits earn **cozy points**; every nudge is a **paw**; **par** is what the
  solver needed.
- When the last cat settles, the camera pans across the room while the purring
  builds (**Fits & sits**), then you can share a spoiler-free grid of cat faces.

Handy URLs while developing: `?room=1|2|3` (hand-made rooms), `?daily=2026-10-05`
(any morning), `?sandbox` (the photo room), `?game=fits|jar|drop` (home, then
straight into a game).

## What's in the box

| Pitch | Where it lives |
| --- | --- |
| Soft-body cat rig (pressure-spring blob, 24-32 nodes, fixed-step physics) | `src/physics/` |
| Breeds with their own flow: kitten = water, Persian = honey, chonk = pudding, tabby = custard, Maine Coon = cloud, plus a secret cat | `src/physics/breeds.ts` |
| Shared prop library (teacup, mug, boot, box, shoebox, fruit bowl, sink, flower pot, laundry basket, saucepan, vase, bucket, slipper, mixing bowl; shelves, counters, stools, tables, fridges, bookcases...) | `src/game/props.ts`, art in `src/render/propArt.ts` |
| Three hand-made rooms: Sunny Kitchen (the 5-second clip), Bath Time, Midnight Study | `src/game/rooms.ts` |
| Cozy points by snugness, not failures | `src/game/fit.ts` |
| A new room every morning, generated from the prop library, checked by a solver for a fair par | `src/game/generator.ts`, `src/game/solver.ts` |
| Fits & sits reveal: camera pan, purrs swell, cat-face row turns gold | `src/app.ts`, `src/render/renderer.ts` |
| Spoiler-free share grid | `src/game/share.ts` |
| Sandbox photo room: pour any cat into anything, take a polaroid | `src/sandbox.ts` |
| The house: three floors you scroll through (the living room twice as tall), cats moving in, treats, the shop, perches you place, glass tubes between the floors | `src/house/` |
| Cats with ways of their own at home: temperaments and moods, stalk, wiggle and pounce, a ball of yarn, scraps in a dust cloud, a hurt cat nursed back with fish | `src/house/antics.ts`, art in `src/house/anticsArt.ts` |
| 5 + 1 collection | menu → Cat collection |
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

**The finger.** A drag picks the cat up by the scruff: a pinch of five ring
nodes near the touch (from skin that faces up, so you never dangle a cat by
its tummy). The finger's path is read back at each physics step a moment
behind it, so uneven touch timing never shakes the cat, and the scruff
follows it like a hand would: with a speed of its own that keeps pace and
closes any gap but only changes so fast, a few units per constraint pass at
most, so it slides along glass instead of being pulled through it, turning
with the cat as it swings. The skin there stretches up into a tent as tall as
the load on it (the cat's weight plus the pull of the hand's acceleration) and
eases back. A held cat is honey-thick (its wobble is damped hard) and is
drawn a moment behind its own shape, so it flows rather than jitters. The
rest of the cat hangs from the pinch and takes a dangling
shape (each breed has its own droop, `hang`), with its swing damped and eased
back to hanging straight, and can't be drawn out much past it: a flick swings
the whole cat. Nothing gets squashed: the scruff eases off whatever pushes
back on the cat (furniture, a shelf it stands on, a cat underneath), a cat
lying on top is gently lifted or rolls off instead, and any skin that still
ends up crossed over itself is turned the right way round the same frame (see
docs/DESIGN.md). Undo snapshots everything.

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

## Cat Jar and Cat Drop

Two more games built on the same cats, physics and paint. In the house they're
mounted over the page (`mountJar`, `mountDrop`: the page's stylesheet steps
aside while one is up, and they share its sound and settings, a way home and
run reports); each also still has a page of its own:

- **Cat Jar** (`jar.html`, `src/proto/jar/`): drag sideways to aim, let go
  to drop cats into a tall glass jar. The next cat hangs a set height over the
  pile and the view follows the pile up; swipe up and down (or tap the gauge
  by the jar) to look around. Two of the same kind that snuggle up for a
  moment melt into the next (kitten, tabby, Persian, Maine Coon, chonk, the
  Void; cats that only brush past each other don't), and each breed has its
  ways: kittens hop about before they settle, a tabby is steady, a Persian
  oozes into gaps, a Maine Coon squashes down to fit, and a chonk pops small
  cats up. The neighbours' cats come round too: Ginger and Cream Kittens,
  Silver and Brown Tabbies, a Turkish Van and a Blue Persian, the same sizes
  and ways as the first three but only twins in the same coat snuggle, and
  more of them turn up as the afternoon wears on (the kitchen's light warms
  toward evening), so the jar slowly fills. Now and then a Little Void
  drops: it melts into any cat and makes it one size bigger. A cat left lying
  still dozes off (zzz) until something wakes it, and twins that touch always
  snuggle. Tap a cat to boop it (a few boops per game; a buried cat heaves up
  the ones on top of it). A tap never drops a cat. The game ends when the pile stays above the dashed line
  by the rim. Free play and a daily jar.
- **Cat Drop** (`drop.html`, `src/proto/drop/`): an endless fall through a
  cozy house. Drag to steer, tap to hop; squeeze through glass tubes, bounce on
  cushions, drop into the funnel of a long glass slide now and then (it
  corkscrews round and shoots you twenty-odd metres down in about a second), eat
  fish to get chonkier (more points, slower squeezing), and stay
  ahead of bath time: a few hundred simulated soap bubbles pouring down the
  house after you, drizzling as they come. Get caught and the foam fills the
  screen, then clears to your cat sitting soaked in a clawfoot bubble bath, with
  your stats. Five breeds, plus a daily drop.

They share `src/proto/kit.ts` (canvas, fixed-step loop with interpolation,
tap/drag input, a cat painter) and `src/proto/shell.ts` (how a game sits in
the house), and run on their own on the dev server at `/jar.html` and
`/drop.html`. `npm run build:protos` makes one self-contained HTML file per
game in `dist-proto/`.

## Scripts

```bash
npm run dev           # dev server
npm test              # unit tests (physics, scoring, solver, generator, saves, the house)
npm run e2e           # Playwright smoke tests (builds + previews first)
npm run typecheck
npm run build         # static site in dist/
npm run build:single  # the whole house in one self-contained HTML file in dist-single/
npm run build:protos  # Cat Jar and Cat Drop on their own, one HTML file each, in dist-proto/
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
