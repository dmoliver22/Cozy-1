// Polylines: their length, and the point a given distance along one.

/** Length of a polyline. */
export function pathLength(path: readonly [number, number][]): number {
  let L = 0;
  for (let k = 1; k < path.length; k++) L += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  return L;
}

/** The point at arc length s along a polyline (clamped), and the way it runs there. */
export function pointAt(path: readonly [number, number][], s: number): { x: number; y: number; tx: number; ty: number } {
  let rest = Math.max(0, s);
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1];
    const [bx, by] = path[k];
    const len = Math.hypot(bx - ax, by - ay);
    if (rest <= len || k === path.length - 1) {
      const u = len > 0 ? Math.min(1, rest / len) : 0;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, tx: len > 0 ? (bx - ax) / len : 0, ty: len > 0 ? (by - ay) / len : 1 };
    }
    rest -= len;
  }
  const [x, y] = path[path.length - 1];
  return { x, y, tx: 0, ty: 1 };
}
