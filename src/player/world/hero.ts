/**
 * The figure you move, and the rules it moves under.
 *
 * Pure and frame-rate independent: `step()` takes a state, an input and a
 * duration, and returns a state. Nothing here reads the clock, the DOM or the
 * canvas, so `tests/unit/world.test.ts` can walk the hero into a tower and
 * assert what happens without a browser.
 *
 * **The hero moves in atlas coordinates.** Not in a scaled copy, not in a world
 * built to feel good — ADR-0032 §3.3 measured that node spacing is the
 * invariant across repos (a median 12–19 units on four repos of wildly
 * different size) and concluded that the body is sized to the world rather than
 * the world to the body. So one atlas unit is one world unit, and the numbers
 * below are the ones that make a stride read correctly against that spacing.
 */

export interface Hero {
  readonly x: number;
  readonly y: number;
  /** Radians, the same convention as `Eye.yaw`: 0 faces −Y, north on the map. */
  readonly facing: number;
}

export interface Walk {
  /** −1 back, +1 forward. */
  readonly forward: number;
  /** −1 left, +1 right. Strafe, not turn. */
  readonly strafe: number;
  /** −1 left, +1 right. Turn, not strafe. */
  readonly turn: number;
  readonly running: boolean;
}

export const STILL: Walk = { forward: 0, strafe: 0, turn: 0, running: false };

/**
 * World units per second.
 *
 * A median nearest-neighbour gap is 12–19 units, so at 46 u/s a walk between
 * neighbouring files takes about a third of a second — brisk enough that a
 * street is a street rather than a trek, slow enough that the gap is felt.
 * Running doubles it, and django's 1,517-unit diagonal is then about 17
 * seconds, against the 132 the design's own figure implies at Promptasy's pace.
 */
export const WALK_SPEED = 46;
export const RUN_MULTIPLIER = 2.1;
/** Radians per second at full turn. A little over half a turn a second. */
export const TURN_SPEED = 2.0;

/**
 * How wide the body is for collision, and how tall it is drawn.
 *
 * **These are the numbers the first render got wrong, and the error is worth
 * keeping written down**: the hero was 11 units tall in a world whose median
 * nearest-neighbour gap is 12–19 and whose elevation-0 building is 4.5, so a
 * person was taller than most of the city and about as wide as the street. The
 * picture read as a giant standing in a model.
 *
 * At 1.9 units a building at elevation 0 is about two and a half times your
 * height and the median gap is ten times it — an ordinary street — and the
 * tallest file on this repo stands at roughly sixty. Ark's layout is dense
 * (ADR-0032 §3.1), so it is a dense city; the fix was to stop pretending the
 * body was the size of a block.
 */
export const HERO_RADIUS = 1.2;
/**
 * How tall the figure is **drawn**. Not the collision radius, and not a claim.
 *
 * 1.9 was a person against a building, and at the rig's 46-unit boom that is
 * about 26 pixels — a smudge at the foot of a tower, which is not something you
 * can find on screen. Nothing in this product asserts human scale; the figure
 * is a marker for *where you are standing*, and it has to be findable at a
 * glance. The collision radius is unchanged, so what you can walk through is
 * exactly what it was.
 */
export const HERO_HEIGHT = 4.4;

export interface Obstacle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * Advance the hero.
 *
 * Collision **slides** rather than stopping: a body that halts dead on contact
 * makes a dense quarter unwalkable, and ark's dense quarters are exactly where
 * the interesting files are. The resolution is the standard one — push the body
 * back out along the line from the obstacle's centre — applied once per
 * overlapping obstacle in ascending distance, which converges because each push
 * is along a different normal.
 *
 * `obstacles` is expected to be pre-filtered to the hero's neighbourhood by the
 * caller. Testing every tower every frame is the O(n) trap that a 3,035-node
 * repo would find for us.
 */
export function step(hero: Hero, walk: Walk, seconds: number, obstacles: readonly Obstacle[]): Hero {
  const facing = hero.facing + walk.turn * TURN_SPEED * seconds;
  const speed = WALK_SPEED * (walk.running ? RUN_MULTIPLIER : 1) * seconds;

  // Forward is −Y at facing 0; right is +X. Same basis as the camera, because
  // two bases for one heading is how a walk ends up drifting off its own view.
  const fx = Math.sin(facing);
  const fy = -Math.cos(facing);
  const rx = Math.cos(facing);
  const ry = Math.sin(facing);

  let dx = (fx * walk.forward + rx * walk.strafe) * speed;
  let dy = (fy * walk.forward + ry * walk.strafe) * speed;
  // Diagonal input must not be faster than straight input.
  const magnitude = Math.hypot(walk.forward, walk.strafe);
  if (magnitude > 1) {
    dx /= magnitude;
    dy /= magnitude;
  }

  let x = hero.x + dx;
  let y = hero.y + dy;

  for (const obstacle of obstacles) {
    const ox = x - obstacle.x;
    const oy = y - obstacle.y;
    const keepOut = obstacle.radius + HERO_RADIUS;
    const distance = Math.hypot(ox, oy);
    if (distance >= keepOut) continue;
    if (distance < 1e-6) {
      // Dead centre. Any direction is as good as any other, and a deterministic
      // one beats a random one — push north, which is the arrival heading.
      y = obstacle.y - keepOut;
      continue;
    }
    x = obstacle.x + (ox / distance) * keepOut;
    y = obstacle.y + (oy / distance) * keepOut;
  }

  return { x, y, facing };
}

/** Normalise to (−π, π]. Only for display; `step` does not need it. */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  let value = radians % turn;
  if (value > Math.PI) value -= turn;
  if (value <= -Math.PI) value += turn;
  return value;
}
