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
  (sky with clouds over and under its railing, a deck, a railing with
  bunting, a chimney a cat can sit on), the attic (a room-tall loft under the roof's slope: timber
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
- **Outside, the ground is level with the living room floor**
  (`outsideArt.ts`). The house is a tower in its garden: out either side of
  its walls (wide screens, a phone turned on its side) there's a lawn with
  a picket fence at `GROUND_Y` (the living room's floor, its front edge
  level with the floor's), neighbours' houses and trees along the street
  behind, the hills far off, and under the lawn the earth cut through, with
  roots, pebbles, a worm and a buried fish's bones, the basement dug down
  into it. The sky is one gradient fixed to the world, clear up high and
  warming down to the hills, with clouds all the way up; the roof garden
  is up in it, nothing over its railing but sky and clouds (some below the
  deck, peeping over), so it reads as high up. It used to have the
  neighbours' roofs along its railing, which made the roof look like the
  ground. The windows agree: the living room's high one looks down on the
  treetops and a neighbour's roof, with the hills low (`outlook: 'high'`),
  and the basement's, at the level of the lawn outside, has the grass right
  up against it, a daisy and the fence (`outlook: 'ground'`). All of it is
  in the cached tiles, so it costs nothing per frame.
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
  of a ledge, or to where someone is or is on the way to, or anywhere there
  isn't room for it (a cat too big for the vase's neck doesn't hop in: a hop
  into the vase or the basket lands on its opening, to pour in from there).
  And a leap never goes through anything (`leap.ts`): the moment the cat
  would touch the furniture, a perch or another cat on the way, it's back in
  the physics where it was, moving as it was, and comes down from there.
  Landed blind where it was headed, a cat ended up inside the vase's glass,
  or (pouncing on a cat that had moved, bouncing on the cushion) inside the
  other cat.
- **Never in one another, never in the furniture.** A cat that ends up in
  something stays there for good: the solver pushes skin out of things the
  nearest way, so it's left wrapped round a wall or wound round the other
  cat, jagged and quivering. So nothing puts one there:
  - *Putting cats down.* The house builds its cats lowest first, and one
    whose ring (nine tenths of its radius, all of it, so a thin wall through
    its middle counts too) isn't clear of the colliders and of the cats
    already placed goes to the nearest place that is, up or to either side,
    on the same floor and clear of the tubes (`spawn.ts`, `houseSpawnOk`).
    A newcomer in at the window where a cat already is comes in beside it;
    two out of a scrap come out clear of the furniture and of one another
    (`Session.placeClear`); and one coming out of a tube waits at the mouth
    while another sits in its way, which is shooed off with a hop aside.
  - *Thin walls.* A node squeezed past the middle of a thin wall (a vase's
    glass, a basket's side) by what's pressing on it was pushed out the
    nearest way, which is through. Now a node that came into a collider
    through a face this substep goes back out through that face
    (`entryFace` in `world.ts`).
  - *The bouncy cushion* springs up whoever's lying on the cat that landed
    on it too, just as fast. Sprung up alone, the cat underneath was shot up
    into the one on top and came out the other side of it.
  - *Last resorts.* Cats that only touch never have a node inside one
    another or their skins crossing (366,000 frames of cats piled, dropped,
    flung and bounced, without one). Two that do are slid apart a little each
    frame, the smaller further (`World.unmerge`; Cat Jar leaves it off, as it
    packs its pile tight on purpose). Skins crossing counts, not just nodes
    inside: two cats wound round one another have every node pushed out of
    the other and still overlap. How long a pair has been in one another
    counts up while they are and down while they aren't, so two that keep
    coming apart and going back in are still seen to. A cat stuck fast for a
    second (its skin crossed over itself, a few of its nodes deep in
    something, or something inside it: a thin rod slipped between two of its
    nodes, a cushion it's wrapped right round), or in another cat for a
    second that it couldn't be slid out of (the smaller one), is put down
    again in the nearest clear place as a fresh round cat, with a puff and a
    boop (`Session.unstick`); one stuck again soon after gets more room.
    None of it ever touches a cat being carried.
  `tests/stuck.test.ts` builds saves with every one of those clashes, forces
  cats into one another and into the shelf, leaps cats into the vase and
  pounces on a cat that moves, and piles every cat up by hand to check
  nothing is slid or moved that only touches; an end-to-end test runs three
  minutes of the house at full tilt (the cats hopping, pouncing and playing,
  someone dropping and flinging them onto one another and the cushion) and
  checks nothing ever needed the last resorts.
- **Treats.** Every game pays treats, about the same for the time it takes
  (ten or fifteen a minute): Cat Jar a treat per 150 points (~30 for a whole
  jar); Cat Drop a treat per two fish and per 50 m (20 to 60 a run).
  The games report as they go, so a run is paid as it goes too: each report
  carries the run's id and pays what it's earned since the last one
  (`payTreats`), so leaving a game half way loses nothing and nothing is paid
  twice. The cats also leave a present the first time you're home each day
  (10 treats, a little box to tap on the window sill beside Pip: the floor
  along the wall is full, and on a short screen the bar along the bottom
  hides the front of it). It's drawn behind the cats, so one sitting by it
  is in front of it, and a tap on it opens it rather than booping a cat
  beside it.
- **The shop** sells the floors (the basement 80, the attic 110, the roof
  garden 150) and perches (a wall shelf, a beanbag, a cushion ledge, a bouncy
  cushion, a cat bed, a hammock, a wicker pod, a cloud shelf and a cat tree,
  each dearer the more of that kind you have; the bouncy cushion every house
  comes with doesn't count, so the first one you buy is full price, 40).
  A perch you buy goes where you put it: it's drawn live over the room with a
  green or red box while you drag it (floor perches stand on the floor under
  the finger, wall ones go anywhere on a wall clear of the floor, the
  furniture and the tubes, capped or not, and out on the roof only the cloud
  shelf floats), and a long press on a perch picks it up again. Held at
  the top or the bottom of the screen, whatever you're dragging takes the
  view along with it (it stays under the finger), so it can go up or down
  to another floor. A
  perch is a few colliders (a rounded box, a sling of capsules, a bowl) and a
  painted back and front: a cat curled in the hammock, the pod or the bed is
  drawn between the two (`Stage.behindFront`).
- **The house's own things move too** (`THINGS` in `homeRoom.ts`): the long
  shelf, the vase and the glass tub, and once their floors are open the
  attic's crate, cabinet and shelf and the basement's bookcase and shelf. A
  long press picks one up and it's dragged like a perch: anywhere on an open
  floor indoors (the roof is outdoors), a shelf anywhere up a wall (and
  flush with the wall's end when it's nearly there), everything else
  standing on the floor of the storey under the finger, clear of the tubes,
  the perches, the other things and the cats. While it's up it's out of the
  room (`Session.removeProp`: its colliders go, so a cat on it falls, and a
  cat in a jar is in nothing; the cats keep track of containers by their
  place in the list, so those are renumbered), and it goes back in where
  it's put (`addProp`, its uid kept, so a jar's glass looks the same) or
  where it was. The window sill and the two cat steps under the tubes'
  hoods stay put, and a long press on one says why. The save keeps where
  each moved thing is (`moved`: a jar by the middle of its bottom, furniture
  by the middle of its top); one somewhere it can't be any more goes back
  where it always was, and then any moved to where that was (`settleMoved`).
  A cat's favourite spot on a thing goes with it (the Void into the vase
  wherever it is). The jars are painted on whichever floor they're on, and
  the cats' spots on the floors are wherever a floor's clear, so a cat
  leaps to the living room floor once you've cleared some of it.
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
  in that funnel slides back down to the step. And a hood hangs over the
  middle of the roof garden, its pipe going straight up out of sight: a cat
  let go under it goes up and away to the Playground (see there). All are
  there from the start, so you can see where they go:
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
  body of its own, with drag so it rolls to a stop; batted, it shoots off,
  away from the cat that got it and never into a wall (boxed in, straight
  up). Pounced on in a corner (the long shelf's end, against the glass
  tub), with the cat coming down on it, it used to stay pinned there, the
  pounce gone for nothing (about one in twenty times): a moment after it's
  batted, if it hasn't got anywhere, it squirts out up over the cat.
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
  coat). Tap it to poke it into a hop: a little up, and back toward the
  middle of the cushion (a hop with a random sideways kick went one way
  more often than not, and on off the edge). A poke while it's in the air
  only boops it, and one that falls off anyway is dropped back on.
- **Where it's offered.** The welcome card's first button; once to a house
  from before there was a maker (`catAsked`), when nothing else is on screen;
  the cats card (a row of its own, Make or Restyle) and the menu. A new cat
  hops in at the window like any cat moving in; a restyled one is rebuilt
  where it was. Names keep to letters, numbers, spaces and `' . -` (they go
  into the page's cards), 14 at most.
- **In Cat Drop** it's first in the picker once made, and picked if you
  haven't picked another before. A standalone `drop.html` reads it from the
  house's save on the same site.
- **The save** has `cat` (the design, made safe on load: anything out of
  range or unknown goes back to the default) and `catAsked` (v6). A house that
  says your cat lives here but has lost its design drops it from the
  residents.

## Names

Every cat who lives with you is called what you call it; one you haven't
named, and one that hasn't moved in yet, goes by its kind (Kitten, Tabby,
Persian, Maine Coon, Chonk, Void). The welcome card asks what the first two
are called, a new cat's card asks as it moves in (its title says "A Persian
moved in!" until you've named her, then her name), and the cats card has a
box on every resident's row to rename it any time; a ↻ beside a box offers
a name nobody has. A name saves as you type and is used everywhere at once:
the house's cards and toasts, the faces' titles up top and Cat Drop's
picker (`catName` in `breeds.ts`, set from the house's save). Your own cat's
name is its design's. Names keep to the same letters as your cat's. The
save is v7: `names`, a name for each resident you've named (a name the same
as its kind isn't kept); a house from before keeps the names its cats had
(Pip, Mochi, Duchess and so on), and `moved` (see the house's things).

## The Playground

Up in the clouds, a corner of the sky of your own (`src/playground/`): the
same soft cats in a `Session` like the house's, built of the house's
perches (`buildPerch`, their art from `perchArt.ts`) and of tubes ridden
like the house's (`Tubes` takes any path with a mouth at each end). Notes on
the choices:

- **Getting there.** A cloud tin on the home bar asks who's coming (your
  cats as faces to tap: last time's lot, or your own cat, picked to begin
  with) and goes up; and once the roof garden is open, a cat let go under
  the sky tube's hood over the middle of the garden rides up it, out of the
  top of the house, and drops out of the clouds onto the respawn cloud, the
  view following it. Back home, it's on the roof garden under the hood. The
  house waits while you're up there: the Playground has a session of its own
  (the app swaps them: `App.goPlayground`, `leavePlayground`), and the input,
  the loop and the HUD go to whichever is showing.
- **The respawn cloud** sits at the world's origin: a soft slab with a star
  on a wand at one end, where the cats start. Below everything (the lowest
  thing built, plus `FALL`) is a **sea of cloud**: a cat that falls into it
  is put back on the respawn cloud where there's room, with a puff; the
  Respawn tin brings everyone back. The view can't wander off for good
  either: it keeps within a good way of everything there is.
- **The camera is free** (`Stage.camera`): the stage says where the view's
  middle is and how far it's zoomed (0.3 to 2.4 times the house's), and the
  renderer draws from there, painting the back and front live rather than
  from cached tiles. One finger on the sky looks about (and coasts when
  flicked), two pinch (the point between them stays put: `Renderer.camFor`),
  a mouse wheel zooms where it points (a trackpad's pinch too, and its
  two-finger slide looks about). Carry a cat, or drag what you're placing, to
  the screen's edge and the view goes that way. Tap a cat's face in the top
  bar and the view follows it, along at its speed (so even a long fall stays
  in view) and easing onto it; a gold marker bobs over it.
- **Building** is free and unlimited: Build lists every perch and a tube. A
  new one appears in the middle of the view, or the nearest place nothing's
  in the way of (a cat can't have something put on it). Shelves, ledges and
  clouds join: dragged up to the end of another hanging piece at about its
  height (within `JOIN`, 18), one snaps on end to end at exactly its height,
  their tops one long walk (the cats cross the seam without a bump: tested).
  A piece that stands (a beanbag, a bouncy cushion, a bed, a cat tree)
  dragged just over a top stands on it; anywhere else it floats on a little
  cloud of its own. Pieces may overlap: it's a sandbox. Press and hold
  anything built to pick it up (Remove takes it away). The layout is saved
  separately from the house (`cozy-playground:v1`), made safe on load.
- **Tubes are drawn.** A tube is its middle line, a point every 16
  (`TUBE.step`) from one mouth to the other, as long as you like (up to
  12,000) and as bendy: no bend tighter than a radius of 46 (`TUBE.bend`),
  or its glass would pinch. `evenTube` keeps it so after every change:
  points evenly spaced along it (measured out from the end that isn't being
  dragged, so the rest doesn't creep), and any sharper corner eased round,
  each such point nudged toward between its neighbours, a pass at a time.
  Build → Tube starts with nothing: the first finger on the sky draws it,
  the glass following the finger (`extendTube`: the finger's point added at
  the end, evened), and a finger by the screen's edge takes the view along,
  drawing on as it goes, which is how a tube gets really long. Then: drag an
  end to draw on from there (dragged back along itself, within as far as the
  finger's come, it's cut back: shorter), pull it anywhere along it to bend
  it (`bendTube`: that point goes with the finger, the tube round it less
  and less further off, a long tube's pull reaching further), or drag the
  knob beside it halfway along (on a little stem, so the glass itself is
  free to bend) to move the whole of it. Redraw rubs it out. Saves from when
  tubes were straight (`ax, ay, bx, by`) come back as a line of points.
- **Pipes** are tubes laid like real ones: straight runs, each one of eight
  ways (along, up and down, the diagonals), with an elbow at each bend (a
  radius of 48, a quarter or an eighth of a circle: never sharper than a
  right angle) and a brass joint where a run meets an elbow (one in the
  middle of a run too short for two, none by a mouth, whose bell has its
  own). A pipe is saved as its `bends` (its mouths first and last) and its
  middle line is made from them (`pipePath`: straight, round each elbow, a
  point every 16, so it's ridden, collided with and painted like any tube).
  Drawing one (`layPipe`): the first stretch the finger goes sets its way
  (read from where the finger came down, and only then is the start put on
  the grid: read from the grid point, up to 14 off, a run drawn straight
  could set off at 45°); its end follows the finger along that way; when the finger's gone 32 off
  it, an elbow goes in where the finger left, moved along the run to the
  grid (20; the run's line goes through a grid point, so it lands on one),
  and a new run sets off; back over the elbow a run set off from, it's
  taken in. Which way the new run goes (45° or a right angle, never
  sharper) is read from where the finger is against where the end stopped
  following it (12 off the run): the end isn't snapped while it follows,
  or a 45° turn could read as a right angle (tested for every offset along
  a grid square). Every run keeps room for what's at its ends (an elbow's
  share, or a mouth's straight). Dragging a straight run slides it square to itself, in
  grid steps (`slidePipeRun`): the runs either side stretch or shrink to
  meet it, going the way they went, only as far as they all keep their
  room. The Twisty | Pipe switch lays a pipe along a twisty tube as if a
  finger drew it (`straighten`, turning only where it really changes way),
  or frees a pipe to bend anywhere.
- **Changing what's built.** A tap on any piece or tube picks it: the bar
  shows Done and Remove (and for a tube, the switch and Redraw). It stays
  in the sky, cats on it and all, until it's actually changed; the first
  change lifts it out (cats on it drop) to be put back as it's left. A tap
  on something else picks that (what was being changed is done with, put
  back as it was if it can't go where it is); a tap on the sky is Done.
  Remove takes it away with a moment to Undo (the pill over the bar; the
  next thing picked forgets it). A long press still picks a thing straight
  up and carries it on the finger.
- **Riding one.** Each mouth faces out along the glass from its throat, a
  bell's height in; a cat whose middle comes into the reach just in front
  of a mouth, let go there, rides round every bend (the ride follows the
  points: `Tubes` takes any path) and is shot out of the other end at 720
  (about 235 straight up, 470 across at 45°); a long one is ridden faster,
  never more than about four seconds through. Following a cat in a tube,
  the view goes along as far as it's gone each frame. Out of one mouth,
  it's a moment before any mouth can have it again: its own is right there.
  The glass is two walls along every bend, offset either side of the middle
  line and with the points that hardly bend it left out (a long curly tube
  is a few hundred capsules), and the bells' flares (`tubeShapes`), so a
  cat can sit on a tube and only goes in at a mouth.
- **The cats stay put.** They used to hop from piece to piece on their own
  every second or two; they're yours to play with now: carried, flung,
  dropped on a bouncy cushion or let go at a tube's mouth. Bouncy cushions
  and hammocks work as at home.
- **The sky** is a gradient that warms the lower you go, a sun so far off
  it hardly moves, and clouds at two depths drifting past slower than the
  view. They're painted once into sprites and stamped (zoomed out, a view
  takes in a lot of sky). So are the pieces: each kind in three looks, as
  sharp as the zoom needs. A hammock or bouncy cushion is painted live only
  while it's moving. With 40 pieces and 6 tubes a frame paints in about 2.5
  ms in a software-rendered browser, zoomed in or out (it was 8 to 41
  painting everything live). A tube's glass is painted live, a few strokes
  along its line, curved through its points (`paintPipeRun`: quick at any
  length and bend, where the house's glass, built of union outlines, is far
  too slow to paint every frame), only the stretches of it on screen, its
  dashes of light pinned to the glass as more comes into view; its bells
  are one painting, turned each way. A 9,600-long spiral, all on screen,
  paints in 3.5 ms.

