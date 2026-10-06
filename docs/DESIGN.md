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
| Tabby | 29 | custard | 700 | 8 | 0 | 0.66 | the polite reference cat |
| Maine Coon | 37 | cloud | 700 | 9 | 0 | 0.62 | compresses to 78% of its area |
| The Void | 28 | ink | 420 | 5 | 0 | 0.64 | secret; pours into anything |

**Held by the scruff.** Every cat can be picked up, in puzzles, the photo room
and at home alike, and goes where the finger takes it: a pinch of five ring
nodes near the touch is the scruff, picked from skin that faces up (never the
underside, even on a cat squashed into a dent).

The finger's path is read back at each physics step a moment (24 ms) behind
the finger: touches arrive in uneven bunches, not one per step (two in one
frame, none in the next), and read a moment behind, the path is always there
to be read between two touches, so every step moves the hand on as smoothly as
the finger really moved. The path starts where the finger touched down, so a
cat is lifted from there rather than jumping to a finger that has already
moved on. The world moves the hand there in even steps across the frame's
substeps.

The scruff follows the hand the way a hand moves: it has a speed of its own
that keeps pace with the hand's and closes any gap within 0.04 s (never faster
than it could still stop in, nor than 900 units/s, so a cat that comes free
of a snag swoops back to the finger rather than jumping), and that speed
changes at most 16000 units/s², so nothing starts, stops or turns with a jolt.
Each substep the scruff is drawn to where its speed takes it, at most 3 units
per constraint pass (less than the thinnest glass is thick, so nothing is ever
pulled through a wall). The fingers gather the pinched skin in (to 55% of its
spread, over a moment), but never hold it in a fixed pattern: fingers turn
with the cat, so when it swings round or flops over the hand the pinch turns
too (a pinch that kept its layout crossed the skin over itself whenever the
body ended up above the hand). The edges split their corrections by how free
each end is, so a hanging body pulls on its own skin, not the finger.

Once off the ground the body dangles: its rest shape eases into a hanging one
(taller than wide by `hang`, narrow at the pinch, fuller below), which even
shapeless breeds take through a small shape stiffness while held; before that
a held cat keeps its own shape, so lifted off a shelf it comes up in one
piece rather than drawing out into a tube that snaps free. The hanging shape
is built turned to wherever the pinch sits in the cat's own rest shape: most
cats roll freely, so the scruff can be anywhere round them, and easing between
two shapes turned far apart passes through a collapsed, mirrored outline. Its
swing and wobble are damped relative to the pinch, and a dangling cat is
turned gently back to hang straight down from its scruff: carried briskly it
leans 20-40 degrees and swings back once, not like a pendulum on a string.

**The scruff stretches.** The skin at the pinch carries the cat, and it's
drawn up into a tent above the body as far as the load on it: 0.3 r for each g
of pull along the scruff (the cat's weight, less what it stands on, plus the
hand's acceleration, eased over 0.05 s), up to 2.6 times that, easing there at
11 rad/s, critically damped, so it never bounces. A hand lifting fast stretches it tall and
the body comes up after (a chonk's scruff pulls up into a peak while he's
still sitting in his dish), slowing at the top lets it spring back, and a
scruff can't push: thrown up, or set down, the skin goes slack. Let go, it
springs back flat. The tent is laid over the rest shape each substep, centred,
so it draws the skin up and lets the body down rather than shifting the cat,
and narrows the skin in toward the pinch. Held, the ears go out onto the
shoulders, clear of the skin drawn up between them.

**Liquid in the hand.** A held cat is honey-thick whatever its breed: its
deformation is damped at 60/s at least (a kitten's own is 3/s), so a springy
cat lifted, swung or bumped flows into each new shape instead of bouncing
between squashed and stretched. And it's drawn a moment behind its own shape:
the outline it's painted with eases after the real one at 22/s (about 1/20 s
behind), while where it is never lags, so however it's tugged or snagged what
you see flows like something liquid and never flickers. Let go, the drawing
eases back to exact within a fraction of a second; skin that was just
untangled is drawn as it is.

What keeps a held cat from being crushed, or crushing anything:
- **Feeling the push-back.** The world adds up the collision push-outs on a
  held cat each substep (furniture by depth, other cats by twice their depth:
  a squashy cat gives way rather than pushing back, but mustn't be squashed),
  eased over a couple of substeps, and the scruff eases off that way in
  proportion, like a hand feeling the cat catch: a brush past the furniture
  barely slows it; a cat jammed against a wall, stood on a shelf or pressed
  onto another cat stops coming. A cat lying on top of the one being lifted
  doesn't hold it back (it comes too, or rolls off), unless something above
  holds that cat down.
- **The scruff itself** is never driven into what the skin round it has lately
  been pressed against (it slides along instead): driven in, the pinched skin
  pokes through a thin floor or folds over a rim. A cat lying on top of it is
  lifted, but only at 150 units/s, so it comes up as a whole or rolls off
  rather than being speared by the scruff.
- **Stretch limits.** The scruff goes freely up to 1.2 times its dangling
  distance from the body's middle (tent included), fading out by 1.6, so a
  cat that's caught has to come along before the finger can pull any further;
  and it isn't pressed in toward the middle past 0.55, fading in from 0.85.
- **Tethers.** No node may hang further from the pinch than its distance in
  the hanging shape (x1.25, plus a little, plus the tent): a flick of the
  finger swings the whole cat along instead of drawing it out into a strand
  that folds over itself. Tethers pull along whatever the skin is pressed
  against, not into it, and move a node at most 0.6 units a pass, so a cat
  that comes free of a snag flows back under its scruff instead of snapping.
- **Standing.** Standing on furniture just under the scruff, or on another cat
  anywhere below it, the scruff isn't pulled down (eased in and out over a
  frame or two, so it never jerks): a finger pushing down slides the cat to the
  edge of a shelf and it steps off and hangs, and never squashes the cat
  underneath.
- A guard keeps the skin beside the pinch from creasing into a hairpin (while
  held and for a moment after).

Startled when scooped up, a held cat goes calm after a moment held still, like
a real scruffed cat; a few soft folds show the gathered skin. Tests drag cats
of every size into the sides of containers at floor level and check the skin
never folds or passes through; carry every cat round the house, over the
furniture and through the others, with quick shakes, and check no cat ever
ends a frame knotted or inside out; lift cats out from under the cat lying on
them; check the scruff stretches further the harder a cat is lifted and
settles to its resting stretch; and carry every breed along a smooth path,
checking its middle follows without shudder (its third difference per frame)
and that it comes to hang straight.

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
  body while seated) starts over from clean. Cats are drawn between the last
  two physics steps (smooth on fast screens), node by node, so a cat whose
  skin was just untangled is drawn where it is instead: its nodes traded
  places, and blending across that would scramble the outline for a frame.

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
- **Balance.** Soft cats pack and find their twins so well that, with one
  kind of cat per size, the jar settles into an equilibrium: random drops into
  a tall jar kept about ten cats in the bottom third forever (bots, hundreds of
  drops, no game over). Bigger drops don't help (they just make Voids sooner,
  and two Voids vanish), and making cats that had dozed off refuse to melt did
  end games but looked broken: twins touching and not snuggling. What works is
  more kinds of cat. The chain is six sizes (kitten, tabby, Persian, Maine
  Coon, chonk, the Void; there was a sphynx between the kitten and the tabby
  until it was taken out of the game), and each of the three sizes that drop
  also comes in two more coats (the neighbours' cats: Ginger and Cream
  Kittens, Silver and Brown Tabbies, a Turkish Van and a Blue Persian), the
  same size with the same ways, that only snuggle up to a twin in the same
  coat; two of a coat make the next size in that coat, and at the Persian's
  size any pair makes a Maine Coon. They turn up after the first few drops
  and more often as the afternoon wears on (`coatChance`: none for 6 drops,
  then up to 60% by drop 406; the second neighbour from drop 40), so the pile
  slowly grows and where you drop a cat matters more and more. Twins melt
  only after snuggling a moment (`SNUGGLE_FRAMES`), so a passing bump doesn't
  count; a cat left alone dozes off (`dozeFrames`, sooner as the kitchen's
  light warms toward evening) but always wakes when a twin cuddles up. Bots at
  a human pace: random drops fill the jar in ~260 drops (240 to 290), aiming
  for twins in ~310 (210 to 400); with one neighbour's coats it took twice
  that, and with none the jar never fills.
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

- **The home is an If It Fits room, three floors tall.** It's a `RoomDef`
  like any other, run in sandbox mode (no paws, no "fits & sits"), so the
  cats are the same soft bodies you can pick up, boop and pour into the box
  or the basket. The house stacks three floors in one world: the roof garden
  on top, the living room in the middle (where you start) and the basement
  under it (`layout.ts`). Each floor is laid out in the same local frame as a
  room (ceiling at 0, floor at `FLOOR_Y`) and moved by its `dy`, so the room
  painters and the furniture (`FurniturePlacement.dy`) work on every floor
  unchanged; the session gets the house's own shell (`SessionOptions.shell`:
  side walls top to bottom, a solid slab between floors, a lid on the sky)
  instead of a room's walls, so a cat can only change floors through a tube.
  The renderer takes the house as a `Stage`: it paints it in three cached
  tiles (the one on screen at once, the others a frame each after that), and
  the camera scrolls between the floors (a finger drag with a fling that
  settles on the nearest floor, a mouse wheel, a pill at the top and bottom of
  the view naming the next floor up and down). The house's own art: the roof
  garden (sky, neighbours' roofs, a deck, a railing with bunting, a chimney a
  cat can sit on), the attic between the roof and the living room (Cat Drop's
  hatch opens into it), the ceiling with its hatch and ladder, the little jar
  of cats (the big jar's glass, twine and tag, with a heap of real soft-body
  cats settled inside once and drawn small), and the basement den (warm
  plaster with brick showing, joists and a copper pipe overhead, a high
  window, string lights, the bookcase that used to be upstairs).
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
- **Cats move in as you play.** Four milestones, one early one in each game
  and one that takes a little more, measured with bots rather than guessed: a
  Cat Drop bot steering for the openings falls 400-1,400 m and eats 17-62 fish
  in a run (so "eat 25 fish" is a good run); in Cat Jar even random drops make
  a Maine Coon within 20 drops and the Void within 40, so the Void isn't the
  last milestone: Inkwell, who lives in the Midnight Study, follows you home
  when you finish that room. (Noodle the sphynx, who moved in after a 100 m
  drop, left with the sphynx; an older house's save moves its Cat Jar record
  down a size to match the shorter chain.) The games
  report how a run is *going* (each 10 m and each fish; each new biggest cat),
  not just how it went, so a cat announces itself the moment it's earned, in a
  toast that shows over any game. A new house counts progress made before it
  existed.
- **Arrivals.** An earned cat waits until you're home, then drops in through
  the attic hatch onto the top cat step, with a card. Residents start in their
  favourite spots and after that stay where they were (the house remembers
  where each cat was, on whichever floor); every so often one who's been
  resting hops (a ballistic kick) to a free spot nearby on its floor, up a
  run of perches if there is one (higher spots are favourites), sometimes
  into the box or the basket, where it purrs.
- **Treats.** Every game pays treats, about the same for the time it takes
  (ten or fifteen a minute): a new If It Fits room 25 (5 for a replay), plus 5
  for a cozy one and 5 for par; Cat Jar a treat per 400 points (~100 for a
  whole jar); Cat Drop a treat per two fish and per 50 m (20 to 60 a run).
  The games report as they go, so a run is paid as it goes too: each report
  carries the run's id and pays what it's earned since the last one
  (`payTreats`), so leaving a game half way loses nothing and nothing is paid
  twice. The cats also leave a present the first time you're home each day
  (10 treats, a little box on the rug to tap).
- **The shop** sells the floors (the basement 80, the roof garden 150) and
  perches (a wall shelf, a beanbag, a cushion ledge, a hammock, a wicker pod,
  a cloud shelf and a cat tree, each dearer the more of that kind you have).
  A perch you buy goes where you put it: it's drawn live over the room with a
  green or red box while you drag it (floor perches stand on the floor under
  the finger, wall ones go anywhere on a wall clear of the floor, the
  furniture, the tubes and the ways into the games, and out on the roof only
  the cloud shelf floats), and a long press on a perch picks it up again. A
  perch is a few colliders (a rounded box, a sling of capsules, a bowl) and a
  painted back and front: a cat curled in the hammock or the pod is drawn
  between the two (`Stage.behindFront`).
- **The tubes.** A funnel in the living room floor drops a cat that falls into
  it down a glass pipe to the basement, where it lands on a beanbag; let a cat
  go under the basement's hood and it's sucked back up, popping out of the
  funnel. A suction hood over the top cat step whooshes a cat up through the
  ceiling, the attic and the deck to the roof garden and back. The ride
  (`tubes.ts`) moves the cat's own outline: it stretches into the mouth (the
  ring blended from the cat to a sausage as wide as the bore, with the same
  area, its nodes matched to the nearest outline points so nothing crosses),
  slides through the glass along the tube's path (bending round the curves),
  and pops out round at the far mouth, where it goes back into the physics
  moving the way the mouth points. It's out of the world while it rides, is
  drawn under the glass's front (a cached front layer) and the camera rides
  along with it.
