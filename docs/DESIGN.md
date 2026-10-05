# Design notes

Working notes for tuning *If It Fits*. The README covers the overview.

## Pillars, and how the build keeps them

| Pillar | Mechanism |
| --- | --- |
| Squishy, never gross | Cats are opaque rings with faces that float to the top; containers draw their front over the cat, so pours read as a loaf in a cup, never as goo. No fluid particles, no realistic anatomy. |
| No fail | Undo snapshots the whole room and refunds the paw. Cats balanced on a rim slide off; cats that can't fit just perch. Nothing breaks, nothing times out. |
| One room every morning, always fair | Date-seeded generator, solver-checked par, deterministic physics (only `+ - * /`, `sqrt`, and a polynomial sine). |
| A sandbox worth photographing | Photo room with every breed and every container, drag-to-arrange, polaroid export. |

## Breeds

All sizes are in world units (the room is 380 wide, the floor is at y = 560).
Tension is the skin's constant line tension; viscosity damps deformation only.

| Breed | Radius | Flow | Tension | Viscosity | Shape | Hang (w/h) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kitten | 22 | water | 360 | 3 | 0 | 0.70 | zippy |
| Persian | 32 | honey | 680 | 26 | 0 | 0.58 | slow ooze, overflows bowls; drips long when held |
| Chonk | 42 | pudding | 1500 | 12 | 0.0015 | 0.55 | the hero; droops the longest; sleepy z's when idle |
| Sphynx | 28 | jelly | 1100 | 0.8 | 0.012 | 0.78 | holds its shape; resists narrow necks (`slurp` 0.25) |
| Tabby | 29 | custard | 700 | 8 | 0 | 0.66 | the polite reference cat |
| Maine Coon | 37 | cloud | 700 | 9 | 0 | 0.62 | compresses to 78% of its area |
| The Void | 28 | ink | 420 | 5 | 0 | 0.64 | secret; pours into anything |

**Held by the scruff.** Every cat can be picked up, in puzzles, the photo room
and at home alike, and goes where the finger takes it: a pinch of five ring
nodes near the touch is pinned to the finger, picked from skin that faces up
(never the underside, even on a cat squashed into a dent). The world moves the
hand to the finger in even steps across a frame's substeps, so it doesn't
jerk; the pinch moves as one piece, at most 3 units per constraint pass (less
than the thinnest glass is thick, so nothing is ever pulled through a wall).
The pinched skin is only kept gathered, never held in a fixed pattern: fingers
turn with the cat, so when it swings round or flops over the hand the pinch
turns too (a pinch that kept its layout crossed the skin over itself whenever
the body ended up above the hand). The edges split their corrections by how
free each end is, so a hanging body pulls on its own skin, not the finger.

Once off the ground the body dangles: its rest shape eases into a hanging one
(taller than wide by `hang`, narrow at the pinch, fuller below), which even
shapeless breeds take through a small shape stiffness while held. The hanging
shape is built turned to wherever the pinch sits in the cat's own rest shape:
most cats roll freely, so the scruff can be anywhere round them, and easing
between two shapes turned far apart passes through a collapsed, mirrored
outline. Its swing and wobble are damped relative to the pinch, and it drifts
sideways to hang right under the pinch, so a cat dragged off an edge doesn't
stay draped over it.

What keeps a held cat from being crushed, or crushing anything:
- **Tethers.** No node may hang further from the pinch than its distance in
  the hanging shape (x1.25, plus a little): a flick of the finger swings the
  whole cat along instead of drawing it out into a strand that folds over
  itself. Tethers pull along whatever the skin is pressed against, not into it.
- **Snags.** A part caught on something (skin hooked over a rim, a cat wedged
  in a vase) that has been drawn out 1.3 times past its tether holds the pinch
  back: the finger can't pull a cat apart, it oozes out like toothpaste.
- **Pushing.** Moving the pinch into the cat moves the whole cat, pinch and
  all (skin can't be pushed in through a body), unless something blocks it
  that way. No part of the cat is pushed into furniture it's pressed against
  (it slides along instead), and the pinch eases off to a creep while the skin
  round it is pressed, so the skin can slide round a rim instead of folding.
- **Standing.** Standing on furniture under the pinch, or resting on another
  cat anywhere, the pinch won't descend: a finger pushing down slides the cat
  to the edge of a shelf and it steps off and hangs, and never squashes the
  cat underneath. Another cat it bumps into gets pushed, but not by its head.
- Skin right at the pinch resting on a rim lifts the pinch over it, and a
  guard keeps the skin beside the pinch from creasing into a hairpin (while
  held and for a moment after).

Startled when scooped up, a held cat goes calm after a moment held still, like
a real scruffed cat; a few soft folds show the gathered skin. A test drags
cats of every size into the sides of containers at floor level and checks the
skin never folds or passes through; another carries every cat round the house,
over the furniture and through the others, with quick shakes, and checks no
cat ever ends a frame knotted or inside out.

The solver carries cats the same way, holding them so their dangling bottom
clears the rim, and steps a cat off its own perch, down, then in under it.

## Painting and layering

Draw order each frame: cached back layer (room, furniture, decor, the far
wall of every glass container, paper grain) → cat shadows → bodies of cats
that are in a container, each in a soft shadow on the container floor →
container fronts (cached, translucent glass) → those cats' front paws on the
rim → free cats (the one in your hand last) → effects. A cat counts as "in" a
container once 2% of it is inside the cavity (or it is seated). Cats have no
tails (they glitched through rims). Ears sit where the top of the outline
crosses either side of the head and are eased in the head's frame, so they
never hop from node to node. Fur locks are left out wherever a node touches a
wall, so a cat pressed against the glass looks squished flat.

Night rooms multiply the finished frame by a light map painted once per room
(indigo ambient, darker corners, warm pools under pendant lamps, moonlight by
night windows) and add a small glow round each bulb. A daytime room never shows
the night view through a window; it gets golden hour instead.

All paint shares one light (`LIGHT`, upper left). Shadows use `shadowOf` (darker,
nudged toward violet), lights use `lightOf` (lighter, nudged toward yellow),
lines use `lineOf`. Textures are mid-grey tiles blended with `overlay` /
`soft-light`, so they modulate any colour without shifting its hue.

## Resting and sleeping

A cat that is touching something, has nothing pulling on it (finger, slurp,
nudge), whose smoothed centre speed is under 1.5 units/s (2.5 when seated or
perched) and whose nodes each move under 0.5 units (1.2 when seated or perched)
over two 20-frame windows falls asleep: its nodes are frozen and skipped by the
solver. It wakes on a grab, a boop, a game nudge over 40 units/s², a moving or
carried cat bumping into it, or any change to the furniture (sandbox). A
sleeping cat is an immovable cushion for a neighbour settling gently against
it. Seated cats get no more nudging at all, and a cat balanced on a rim it
doesn't fit slides off on a slippery rim with a push that builds over 1/3 s,
instead of teetering. The tabby and the Maine Coon have no shape matching (it
made them slowly "unroll" across the floor after a tumble).

## Skin contact

Collision used to be node-only, which looked fine behind opaque containers but
not through glass: a cat pulled hard over a thin wall could let the rim slip
between two nodes (a cheese wire) and then fold through itself into a figure 8
with the wall inside it. The skin is now solid between nodes too:

- **Corners vs skin.** For a convex shape the skin can only come too close at
  one of the shape's corners, so each corner pushes the stretch of skin nearest
  to it back out (or, if the corner has slipped inside the cat, decided by the
  whole outline, back out over it). It only engages when the skin cuts into a
  corner (keeps `radius + 0.5 * NODE_RADIUS`), not when skin is merely wrapped
  snugly round a rim (fighting the tension there made cats quiver), and it is
  frictionless, so skin slides over a rim like syrup over a spoon.
- **Self-contact.** Every node keeps a skin's width (`2 * NODE_RADIUS`) from the
  ring two or more nodes away, once per substep. That stops pinched necks from
  passing through each other and creases from folding into hairpins.
- **Untangling.** Squeezed harder than the solver keeps up with (a cat crushed
  into a corner, dragged hard over a rim, a pile in Cat Jar), skin can still
  cross over itself, and nothing above undoes a crossing once it's made: the
  self-contact only keeps skin apart and can't tell which side is out, so it
  holds a knot in place for good. So every frame each ring is checked, and a
  stretch of skin between two crossing edges is turned the right way round
  (its nodes trade places end for end, a 2-opt move): always the loop that is
  wound inside out, and a ring wound backwards all over is traced the other
  way. The outline goes through the very same points, so nothing jumps; it
  just no longer crosses. A held cat is then eased back toward its rest shape
  for a few frames. A rest shape that crept into a knot (copying a knotted
  body while seated) starts over from clean.

`tests/physics.test.ts` drags cats hard into a shoebox, a saucepan and the
crevice under a teacup and checks every frame for crossed edges and skin inside
a wall.

Nothing that is painted behind the cats has a body. The glass box's open side
panes used to be walls jutting out over the floor beside the box; a big cat
that slumped under one could not be lifted (the finger pulled it straight into
the overhang). Another test drops every breed beside every container, on both
sides, and checks it can be lifted straight up.

## Seating and cozy points

- A cat touching a container commits to an intent: **in** (damped pull toward the
  opening, "slurp" on the part already inside), **out** (it is balanced on a rim:
  slide off the way it leans), or **perch** (tried for 2.5 s, really doesn't fit).
- Seated = settled (smoothed motion) and either 20% of the cat is inside or the
  cavity is 55% full. One cat per container; the bigger overlap wins a tie.
- `fill` = share of the cavity covered (sampled on a 4-unit grid, eroded 3 units
  from the walls). `spill` = share of the cat outside.
- Score = `(0.2 + 0.8 * smoothstep(0.3, 0.86, fill)) * spillFactor`, where the
  spill factor is 1 up to 68% spill, then falls to 0.55. Labels: Snug! >= 92,
  Cozy >= 78, Comfy >= 60, else Roomy / Overflowing.

## Daily generator

Vignettes (built perch-left, mirrored by the composer): `dropShelf` (shelf over a
floor container), `counterStool` (the hero layout), `cabinetFloor` (cabinet,
crate, bookcase or fridge beside a floor container), `sillFloor` (window sill
over a floor container), `shelfTable` (high shelf over a table container).
Containers are picked to suit each cat's volume (ratio ~1 to 2.4 preferred) and
the theme. Three-cat mornings that don't fit side by side add a kitten on a high
shelf with a container in a free stretch of floor. Two-cat mornings often get a
spare container, which makes the morning a choice.

## Solver

For each cat (lowest perch first, then the reverse order if that fails), try the
intended container, then any other free container, then accept wherever the cat
happily ends up. Gestures: drags with different targets and tolerances, two-leg
drags that slide off the perch edge first when the container is tucked under it,
and a boop. A drag lets go once the cat is over the opening and off its perch.
Par is the number of gestures in the first full solution.

## Known limits / next steps

- Three-cat rooms rely on the carried kitten; a wider vignette set (stacked
  shelves, ramps) would allow three big cats.
- Tipping containers (pouring a cat out of a cup) isn't in the first playable.
- Purrs, glorps and music are synthesized; recorded purrs would sell the reveal
  even more.

## Cat Jar (prototype)

A Suika game on the same soft cats (`src/proto/jar/`). Notes on why the rules
are what they are:

- **Taps never drop.** A tap boops the cat nearest the finger (no time limit,
  ~30 px of reach past the outline); dropping takes a sideways drag and
  release, or a tap on the waiting cat itself. A boop on a buried cat heaves
  up everything piled on it, or the sleeping cats on top hold it down.
- **The tall jar** is about two screens tall. The next cat hangs `DROP_GAP`
  over the top of the pile (so every drop falls about as far, and the view can
  stay on the pile); the camera follows that line and the player can look
  around (drag, wheel, the gauge).
- **Balance.** Soft cats pack and find their twins so well that the jar settles
  into an equilibrium: random drops into a tall jar kept about ten cats in the
  bottom third forever (bots, hundreds of drops, no game over). Bigger drops
  don't help (they just make Voids sooner, and two Voids vanish). What does:
  twins melt only after snuggling a moment (`SNUGGLE_FRAMES`), so a passing
  bump doesn't count, and cats that lie still doze off and won't melt until
  woken (`dozeFrames`, shorter as the game goes on, shown by the kitchen's
  light warming toward evening). The bottom of the jar slowly fills with
  sleepers, faster for loose play; careful play and well-spent boops last
  longer. Bots at a human pace: random drops fill the jar in ~240 drops (the
  old short jar: ~80); aiming and booping sleepers awake lasts past 800.
- **Performance.** A cat that's been truly still for 3/4 s is put to sleep in
  the physics (deep in a pile the engine's own test never fires), pictures of
  still cats are reused until their shape drifts, and off-screen cats aren't
  drawn: a frame with ~25 cats costs a few ms.
- **Breeds** differ through physics numbers (`TIERS` in `config.ts`) plus two
  behaviours in `game.ts`: kittens hop and scoot to a twin; a chonk pops small
  cats up when it arrives or lands. The Little Void is a wildcard drop.

## The house

One page, three games, and a home room in between (`src/house/`). Notes on
the choices:

- **The home is an If It Fits room.** It's a `RoomDef` like any other, run in
  sandbox mode (no paws, no "fits & sits"), so the cats are the same soft
  bodies you can pick up, boop and pour into the box or the basket. Two
  pieces of art are its own, painted into the renderer's cached back layer
  through `paintExtra`: the ceiling with the attic hatch and its ladder, and
  the little jar of cats (the big jar's glass, twine and tag, with a heap of
  real soft-body cats settled inside once and drawn small).
- **The ways in are things in the room**: the glass box (If It Fits: if it
  fits, I sits), the jar of cats (Cat Jar) and the ladder up to the attic
  (Cat Drop starts in the attic). Each has a label, a tap on the thing works
  (a cat under the finger gets the tap first), and the bar of three tins along
  the bottom says the same thing plainly, with the face of the next cat you
  can meet in that game peeking over its lid.
- **Mounting.** Cat Jar and Cat Drop mount over the page and unmount again
  (`src/proto/shell.ts`). Their stylesheets and the page's share names (`.card`,
  `.btn`, `body`), so the page's stylesheet is attached from JS (`?inline`) and
  steps aside while a game is up; a tiny inline style keeps the page hidden
  until it arrives. They share the page's AudioEngine and settings, so music
  carries on from room to game.
- **Cats move in as you play.** Five milestones, one early one in each game
  and two that take a little more, measured with bots rather than guessed: a
  Cat Drop bot steering for the openings falls 400-1,400 m and eats 17-62 fish
  in a run (so "drop 100 m" and "eat 25 fish" are a first run and a good
  run); in Cat Jar even random drops make a Maine Coon within 20 drops and the
  Void within 40, so the Void isn't the last milestone: Inkwell, who lives in
  the Midnight Study, follows you home when you finish that room. The games
  report how a run is *going* (each 10 m and each fish; each new biggest cat),
  not just how it went, so a cat announces itself the moment it's earned, in a
  toast that shows over any game. A new house counts progress made before it
  existed.
- **Arrivals.** An earned cat waits until you're home, then drops in through
  the attic hatch onto the top cat step, with a card. Residents start in their
  favourite spots; every so often one who's been resting hops (a ballistic
  kick) to a free perch nearby, sometimes into the box or the basket, where it
  purrs.
