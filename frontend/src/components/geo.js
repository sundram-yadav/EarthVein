const R = 6371;
export const rad = (d) => (d * Math.PI) / 180;
export function km(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Point that is `dist` km along a polyline.
export function pointAlong(points, dist) {
  let left = dist;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = km(points[i], points[i + 1]);
    if (left <= seg) {
      const f = seg === 0 ? 0 : left / seg;
      return { pos: [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f], done: false };
    }
    left -= seg;
  }
  return { pos: points[points.length - 1], done: true };
}
export function length(points) {
  let t = 0;
  for (let i = 0; i < points.length - 1; i++) t += km(points[i], points[i + 1]);
  return t;
}
