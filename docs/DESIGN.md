# Design notes

Working notes for tuning the house of squishy cats (the page is still called
*If It Fits*, after the puzzle it began as) and its two games. The README
covers the overview.

## Pillars, and how the build keeps them

| Pillar | Mechanism |
| --- | --- |
| Squishy, never gross | Cats are opaque rings with faces that float to the top; containers draw their front over the cat, so pours read as a loaf in a cup, never as goo. No fluid particles, no realistic anatomy. |
| No fail | At home nothing breaks and nothing times out: cats balanced on a rim slide off, cats that can't fit just perch, a cat that tumbles into a funnel pops out downstairs. |
| The home is the sandbox | The page opens in the house, not a menu: every cat can be picked up by the scruff, carried, booped and poured into the vase from the first second, and the games are buttons along the bottom. |
| Your cat feels like yours | The cat maker's squish slider changes the physics, not just the picture: a loaf holds its shape, a puddle spreads out, droops long from the scruff and pours. |

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
| The Void | 28 | ink | 420 | 5 | 0 | 0.64 | pours into anything |
| Yours | 22 to 40 | loaf to puddle | 1.12 to 0.38-0.5 x r² | 11 to 3.5 | 0.006 to 0 | 0.74 to 0.56 | from the cat maker: see "Your own cat" |

**Held by the scruff.** Every cat can be picked up, at home and in the cat
maker alike, and goes where the finger takes it: a pinch of five ring
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
carried cat bumping into it, or any change to the furniture (a perch put up). A
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

## Seating ("if it fits, I sits")

- A cat touching a container commits to an intent: **in** (damped pull toward the
  opening, "slurp" on the part already inside), **out** (it is balanced on a rim:
  slide off the way it leans), or **perch** (tried for 2.5 s, really doesn't fit).
- Seated = settled (smoothed motion) and either 20% of the cat is inside or the
  cavity is 55% full. One cat per container; the bigger overlap wins a tie.
- `fill` = share of the cavity covered (sampled on a 4-unit grid, eroded 3 units
  from the walls). `spill` = share of the cat outside.
- How snug = `(0.2 + 0.8 * smoothstep(0.3, 0.86, fill)) * spillFactor`, where
  the spill factor is 1 up to 68% spill, then falls to 0.55. A snug cat (78 and
  up) looks happy, a roomy one content; either way it purrs.

## Known limits / next steps

- Tipping containers (pouring a cat out of a cup) isn't in.
- Purrs, glorps and music are synthesized; recorded purrs would sell the cozy
  moments even more.
- The cat maker has no accessories yet (hats, bows, collars): a natural thing
  for treats to buy.

## Cat Jar (prototype)

A Suika game on the same soft cats (`src/proto/jar/`). Notes on why the rules
are what they are:

- **Taps never drop.** A tap boops the cat nearest the finger (no time limit,
  ~30 px of reach past the outline); dropping takes a sideways drag and
  release, or a tap on the waiting cat itself. A boop on a buried cat heaves
  up everything piled on it (harder the more there is: a kitten at the
  bottom of the whole jar still visibly hops), or the sleeping cats on top
  would hold it down.
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
  size any pair makes a Maine Coon. Every drop comes in any of its three
  coats, each as likely, from the first drop (`pickCoat`). (They used to come
  round as the afternoon wore on, none for the first 6 drops and up to 60% by
  drop 406, and the start was too easy: plenty of twins, and a pile that
  stayed low for a long time.) Twins melt only after snuggling a moment
  (`SNUGGLE_FRAMES`), so a passing bump doesn't count; a cat left alone dozes
  off (`dozeFrames`, sooner as the kitchen's light warms toward evening) but
  always wakes when a twin cuddles up. Bots at a human pace: random drops
  fill the jar in ~105 drops (95 to 120), and aiming for twins doesn't do
  much better (87 to 135): it takes planning, and boops. (With the neighbours
  coming round gradually it was ~260 and ~310; with one neighbour's coats
  twice that, and with none the jar never filled.)
- **Performance.** A cat that's been truly still for 3/4 s is put to sleep in
  the physics (deep in a pile the engine's own test never fires), pictures of
  still cats are reused until their shape drifts, and off-screen cats aren't
  drawn: a frame with ~25 cats costs a few ms.
- **Breeds** differ through physics numbers (`TIERS` in `config.ts`) plus two
  behaviours in `game.ts`: kittens hop and scoot to a twin; a chonk pops small
  cats up when it arrives or lands. The Little Void is a wildcard drop.

## The house

One page: a home room, where the page opens and you can play with the cats
straight away, and two games reached from it (`src/house/`). If It Fits, the
puzzle the house grew out of (nudge the cats into teacups and sinks, a new
room every morning), went: it was the first thing a new player met, and the
least fun of the three, so the house became the sandbox and the way in.
Notes on the choices:

- **The home is a room, four floors tall.** It's a `RoomDef` like any other,
  so the cats are the same soft bodies you can pick up, boop and pour into
  the vase or the basket. The house stacks four floors in one world: the roof garden
  on top, the attic under it, the living room (where you start) and the
  basement under that (`layout.ts`). Each floor is laid out in the same local frame as a
  room (the top of a room's wall at 0, floor at `FLOOR_Y`) and moved by its
  `dy`, so the room painters and the furniture (`FurniturePlacement.dy`) work
  on every floor unchanged. The living room is twice as tall: its wall goes
  on up to a ceiling at `-FLOOR_Y`, a whole screen of wall over the room you
  start in, for perches (the room painters take the ceiling's height, so the
  shade under it goes there). The session gets the house's own shell
  (`SessionOptions.shell`: side walls top to bottom, a solid slab between
  floors, a lid on the sky) instead of a room's walls, so a cat can only
  change floors through a tube. The renderer takes the house as a `Stage`: it
  paints it in five cached tiles (the one on screen at once, the others a
  frame each after that), and the camera scrolls between five stops: the
  roof, the attic, up high in the living room, down by its floor, the
  basement (a finger
  drag with a fling that settles on the nearest stop, a mouse wheel, a pill
  at the top and bottom of the view naming the next stop up and down; and a
  cat carried to the top or the bottom of the screen takes the view along
  with it, up and down the tall wall). The house's own art: the roof garden
  (sky, neighbours' roofs, a deck, a railing with bunting, a chimney a cat
  can sit on), the attic (a room-tall loft under the roof's slope: timber
  rafters into the top corners, a round window, string lights, a pendant
  lamp, a rug, an old crate, a cabinet and a shelf; while it's shut, dust
  sheets over everything and a shade over the lot), the living room's tall
  wall (a high window, pictures, bunting under the ceiling, the lamp on a
  long cord) and its ceiling with the tubes' pipes going up through it, and
  the basement den (warm plaster with brick showing, joists and a copper
  pipe overhead, a high window, string lights, the bookcase that used to be
  upstairs). A house saved before the living room grew, or before the attic
  went in under the roof, has its roof garden's perches and cats moved up
  with the roof, and a perch that's where a tube now always is goes back in
  the cupboard.
- **The living room's floor**: the funnel, a tall thin glass vase (where
  Inkwell starts, poured in), a bouncy cushion and the laundry basket. It had
  a big glass box as well as the basket, two of a kind: the vase took over
  from the box, thinner, and leaves room for the cushion. The long shelf over them
  stops short of the cushion, so a cat dropped on it from up the wall gets
  there.
- **The ways in are the big buttons along the bottom**: a tin for each game,
  with the face of the next cat you can meet in it peeking over its lid, and
  the shop's. (Labels on things in the room said the same again,
  and a little jar of cats on a shelf and a hatch up to the attic were more
  things on the wall where perches go: they went.)
- **Mounting.** Cat Jar and Cat Drop mount over the page and unmount again
  (`src/proto/shell.ts`). Their stylesheets and the page's share names (`.card`,
  `.btn`, `body`), so the page's stylesheet is attached from JS (`?inline`) and
  steps aside while a game is up; a tiny inline style keeps the page hidden
  until it arrives. They share the page's AudioEngine and settings, so music
  carries on from room to game.
- **Cats move in as you play.** Four milestones, two in each game, an early
  one and one that takes a little more, measured with bots rather than
  guessed: Duchess for a Persian in Cat Jar (two tabbies snuggled up) and
  Juniper for a Maine Coon; Biscuit for 25 fish in one Cat Drop and Inkwell,
  a small night that wandered in, for a 750 m fall (a bot steering for the
  openings falls 400-1,300 m and eats 17-62 fish a run, so both are good
  runs, and the fall the better one). Duchess and Inkwell used to come from
  If It Fits rooms: a house that has them keeps them, and one that hasn't
  gets them for the new milestones (met already, they're on the way at
  once). (Noodle the sphynx, who moved in after a 100 m drop, left with the
  sphynx; an older house's save moves its Cat Jar record down a size to match
  the shorter chain.) The games
  report how a run is *going* (each 10 m and each fish; each new biggest cat),
  not just how it went, so a cat announces itself the moment it's earned, in a
  toast that shows over any game. A new house counts progress made before it
  existed.
- **Arrivals.** An earned cat waits until you're home, then hops in at the
  window and leaps from there to the nearest free spot, with a card once
  it's landed. Residents start in their favourite spots and after that stay
  where they were (the house remembers where each cat was, on whichever
  floor); every so often one who's been resting leaps to a free spot nearby
  on its floor, up a run of perches if there is one (higher spots are
  favourites, and the perches you've put up most of all), sometimes into the
  vase or the basket, where it purrs (a dozy cat makes for a cat bed, a
  playful one for a bouncy cushion). A leap is guided: the cat is out of the
  physics while it flies a gravity arc high enough to clear the edge it's
  landing on, stretching a little along the way it's going, and lands with
  the speed it's falling at (a ballistic kick fell short: a soft body pushing
  off loses much of its spring). Nobody leaps straight up into the underside
  of a ledge, or to where someone is or is on the way to.
- **Treats.** Every game pays treats, about the same for the time it takes
  (ten or fifteen a minute): Cat Jar a treat per 150 points (~30 for a whole
  jar); Cat Drop a treat per two fish and per 50 m (20 to 60 a run).
  The games report as they go, so a run is paid as it goes too: each report
  carries the run's id and pays what it's earned since the last one
  (`payTreats`), so leaving a game half way loses nothing and nothing is paid
  twice. The cats also leave a present the first time you're home each day
  (10 treats, a little box on the rug to tap).
- **The shop** sells the floors (the basement 80, the attic 110, the roof
  garden 150) and perches (a wall shelf, a beanbag, a cushion ledge, a bouncy
  cushion, a cat bed, a hammock, a wicker pod, a cloud shelf and a cat tree,
  each dearer the more of that kind you have; the bouncy cushion every house
  comes with doesn't count, so the first one you buy is full price, 40).
  A perch you buy goes where you put it: it's drawn live over the room with a
  green or red box while you drag it (floor perches stand on the floor under
  the finger, wall ones go anywhere on a wall clear of the floor, the
  furniture and the tubes, capped or not, and out on the roof only the cloud
  shelf floats), and a long press on a perch picks it up again. A
  perch is a few colliders (a rounded box, a sling of capsules, a bowl) and a
  painted back and front: a cat curled in the hammock, the pod or the bed is
  drawn between the two (`Stage.behindFront`).
- **Perches that move** (`springs.ts`). The hammock is a simulated sling:
  nine points on springs between the two pegs, stepped in fourteen substeps a
  frame, its links the colliders (moved in place each frame, so a cat rides
  them). The cats in it weigh on it: a cat touching it shares its mass over
  the points under it (by how far along it is and how close to its outline,
  with a few frames of grace so a flickering contact doesn't make it jitter),
  and the cloth pushes back on the cat only part of the way (all of it rang:
  the cat and the cloth bounced each other into a buzz). It's stiff past its
  rest length and slack short of it, so it dips as a cat lands, swings, and
  settles cradling it, deeper for a chonk (about 13 units) than a kitten
  (10); empty, it springs back to how it hung. The bouncy cushion squashes on
  a spring: a cat that lands on it from higher than about its own height
  sinks it, and a few frames later it's thrown back up, centred over the
  cushion (thrown as it came, it shot off the rounded edge), at 86% of the
  speed it came down at, so each bounce is lower until it just sits. While a
  cat's bouncing, the pull towards a container's opening is off: the
  vase next door sucked a bouncing kitten in. Both are painted live, every
  frame (`Stage.liveFront`), the rest of the perches in the cached tiles.
- **The tubes.** A funnel in the living room floor drops a cat that falls into
  it down a glass pipe to the basement, where it lands on a beanbag; let a cat
  go under the basement's hood and it's sucked back up, popping out of the
  funnel. A suction hood over the top cat step whooshes a cat up a pipe on
  the wall, through the ceiling, the attic and the deck to the roof garden
  and back. The attic's tube is the basement's the other way up: a hood high
  on the living room's left wall, over a little step, whooshes a cat up to
  the attic, where it pops out of a funnel in the floor, and a cat dropped
  in that funnel slides back down to the step. Both are there from the start, so you can see where they go:
  until the floor a tube goes to is open it's capped, a wooden lid on the
  funnel and a steel cap on each hood, padlocked (colliders too: a cat can
  sit on the funnel's lid and can't get into a hood), and a tap on a capped
  tube opens the shop. The ride
  (`tubes.ts`) moves the cat's own outline: it stretches into the mouth (the
  ring blended from the cat to a sausage as wide as the bore, with the same
  area, its nodes matched to the nearest outline points so nothing crosses),
  slides through the glass along the tube's path (bending round the curves),
  and pops out round at the far mouth, where it goes back into the physics
  moving the way the mouth points. It's out of the world while it rides, is
  drawn under the glass's front (a cached front layer) and the camera rides
  along with it. The ride doesn't know about houses (it's generic over who
  rides and what tube, with a tube's own speed and an optional whoosh that
  speeds up all the way), so Cat Drop's boost slides use it too: now and
  then (about one chunk in eighteen, never in the attic) a funnel narrows
  into a glass slide that corkscrews twice and then runs straight down, 17
  to 24 m in all, ridden at up to 2,300 units a second (a fall tops out at
  720), and the cat shoots out of the bottom still going fast. The funnel's
  mouth is the only way down past it, and a tap mid-ride does nothing.
- **The cat steps** up the living room wall were three shelves; the middle
  one went, as with it there wasn't room to get a cat past between them (a
  cat saved sitting on it comes down to a free spot).
- **Ways of their own** (`antics.ts`). Each cat has a temperament (how
  playful, how touchy, how lazy, how keen on the yarn) and a mood for the
  day, hashed from the breed and the date so it holds all day (sunny,
  grumpy, dozy, or nothing in particular), which nudges those. When a
  resting cat's turn comes it may play instead of hopping somewhere: stalk
  the yarn or a cat on its floor. A stalk is four beats: a crouch (the soft
  body's rest shape flattened and lengthened, area kept, so the physics
  crouches), a creep along the floor if it's far, a wiggle of the back end,
  and a low guided leap onto the yarn or the other cat's back. The wiggle
  is painted, not simulated (`CatPose.wiggle` bends the drawn outline):
  shape matching ironed a physics wiggle flat. The yarn is a little soft
  body of its own, with drag so it rolls to a stop; batted, it shoots off.
  A pounced-on cat plays along (chases, or pounces back), takes no notice,
  or hisses (ears flat, fangs) and the pouncer runs off; both are cross for
  a while. Two touchy cats, or cross ones, now and then scrap instead
  (`scrapChance`, and at most one scrap in three minutes): both leave the
  physics and tumble inside a dust cloud painted over them, paws and ears
  poking out (never downwards, where they'd show through the shelf), with
  scratches, stars, and fluff that floats down and settles. A tap breaks it
  up. Left to it, one of them (more likely the smaller) usually comes out
  hurt: a plaster, a sad face and a fish badge counting down the fish it
  needs (5 to 9, a treat each, fed one per tap; hearts when it's well), and
  a hurt cat stays put more. The save keeps who's hurt and where the yarn
  is. None of it goes near a tube's mouth or over the open funnel: nobody
  plays or hops out over it, a cat popping out of a scrap is flung where it
  lands safely (if it would sail off the end of a ledge, the landing on the
  floor below is checked too), and yarn that comes to rest down there
  bounces back out. A cat knocked off something still falls in now and
  then (it's what the funnel is for): one that tumbles in by itself goes
  down without taking the view with it, and a note says where it went.

## Your own cat

The cat maker (`src/house/catMaker.ts`) makes a design (`CatDesign` in
`src/physics/mycat.ts`: a name, a coat, a pattern, eyes, fur, size, squish
and a personality) and the design becomes a breed of its own, `'mine'`, which
`setMyCat` puts in `BREEDS`. Everything else (the house, its bookkeeping by
breed, the faces, the portraits, Cat Drop) then treats it like any other cat.
Its name, temperament and favourite spot (the bouncy cushion) sit beside the
six cats' (`applyMyCat`); its pictures are cached under a key that changes
with each restyle (`lookKey`).

- **Looks.** Ten coats (the six cats' and the Cat Jar neighbours' palettes,
  plus chocolate and white) and five patterns: plain (a paler tummy; a black
  coat keeps the Void's velvet sheen), stripes (the tabby's mackerel stripes),
  tuxedo (a crisp white shirt front, socks and a blaze, whatever the coat),
  patches (a white cat with patches of the coat's colour: a cap over the head
  and ears parted by a white blaze, a saddle and a spot; a black one is a
  little cow) and points (a Siamese: pale all over, the coat's colour, made
  deep enough to show on a pale coat, in a mask round the nose and on the
  ears and paws). Eyes are the house's little dark dots or a colour, painted
  as an iris with a pupil and, on a light coat, a dark rim; a black cat's dots
  turn gold, or they wouldn't show. Fur goes from sleek to a fluffy outline
  with a bib under the chin past halfway and lynx tips at the very end.
  Personality picks the face (playful big-eyed, dramatic with lashes, sleepy
  and dozing) and how it gets on at home (the antics' play, touchiness,
  laziness and love of the yarn).
- **Size** sets the radius, 22 (a kitten) to 40 (nearly a chonk), and with it
  the ring's nodes, the weight, how high a boop hops and the voice and purr.
- **Squish** is one slider from **Loaf** to **Puddle**, and it's physics:
  skin tension from 1.12 r² down to 0.38 r² (0.5 r² for the biggest: a big
  puddle spread flat struggled through Cat Drop's gaps), a little shape
  memory at the loaf end and none past custard, a stretch limit from 2.15 to
  2.6, a hang from the scruff from 0.74 (holds up) to 0.56 (drips long),
  viscosity 11 to 3.5, plastic creep and the settled loaf's width rising
  together. The middle is the tabby's custard. Settled on an empty floor, a
  loaf stands about 1.25 times as wide as tall at any size, custard 1.45 to
  1.5, a puddle 1.8 to 2.1 (measured: the tests check it at both ends of the
  size range). The readout names it as the breeds are named: firm as a loaf,
  wobbles like jelly, pours like custard, pours like honey, pours like a
  puddle.
- **The extremes hold together.** Carried round the house with shakes and
  dropped, the four corners (tiny and chonky, loaf and puddle) never knot,
  and in Cat Drop each gets a fair way down with a simple bot (tiny loaf
  970-1,260 m, chonky puddle 360-570 m, about the Persian's).
- **The preview** is a little world of its own: a cushion, walls and a
  ceiling at the edges of the view, and your cat as a soft body built from
  the draft (`SoftBody` takes a breed's physics and look as overrides, so the
  real `'mine'` isn't touched until you save). A new size or squish drops a
  fresh cat onto the cushion, so you see how it lands; a new coat repaints the
  same cat where it is (its state is snapshotted into a body in the new
  coat). Tap it to poke it into a hop.
- **Where it's offered.** The welcome card's first button; once to a house
  from before there was a maker (`catAsked`), when nothing else is on screen;
  the cats card (a row of its own, Make or Restyle) and the menu. A new cat
  hops in at the window like any cat moving in; a restyled one is rebuilt
  where it was. Names keep to letters, numbers, spaces and `' . -` (they go
  into the page's cards), 14 at most.
- **In Cat Drop** it's first in the picker once made, and picked if you
  haven't picked another before. A standalone `drop.html` reads it from the
  house's save on the same site.
- **The save** is v6: `cat` (the design, made safe on load: anything out of
  range or unknown goes back to the default) and `catAsked`. A house that
  says your cat lives here but has lost its design drops it from the
  residents.

