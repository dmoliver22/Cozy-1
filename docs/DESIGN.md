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

| Breed | Radius | Flow | Tension | Viscosity | Shape | Pull (x weight) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kitten | 22 | water | 360 | 3 | 0 | 2.3 | the only cat light enough to carry |
| Persian | 32 | honey | 680 | 26 | 0 | 1.35 | slow ooze, overflows bowls |
| Chonk | 42 | pudding | 1500 | 12 | 0.0015 | 1.05 | the hero; sleepy z's when idle |
| Sphynx | 28 | jelly | 1100 | 0.8 | 0.012 | 1.6 | holds its shape; resists narrow necks (`slurp` 0.25) |
| Tabby | 29 | custard | 700 | 8 | 0.0004 | 1.6 | the polite reference cat |
| Maine Coon | 37 | cloud | 700 | 9 | 0.0003 | 1.7 | compresses to 78% of its area |
| The Void | 28 | ink | 420 | 5 | 0 | 2.05 | secret; pours into anything |

Lift is capped at 55% of the finger's force, so only cats with `pull * 0.55 > 1`
can be lifted off a surface.

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
