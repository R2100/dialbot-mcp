export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function gaussian(random = Math.random) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
}
export function logPause(median, low, high, random = Math.random) {
  return clamp(Math.exp(Math.log(Math.max(1, median)) + 0.4 * gaussian(random)), low, high);
}
export function strokeSegments(points, duration, random = Math.random) {
  const weights = Array.from({length: 3}, () => 0.5 + random());
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const times = [0, duration * weights[0] / sum, duration * (weights[0] + weights[1]) / sum, duration];
  const timeAt = progress => {
    const phase = Math.min(2, Math.floor(progress * 3));
    return times[phase] + (times[phase + 1] - times[phase]) * (progress * 3 - phase);
  };
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
  const distance = lengths.reduce((total, length) => total + length, 0);
  const segments = [];
  let travelled = 0, start = 0;
  for (let i = 1; i < points.length; i++) {
    travelled += lengths[i - 1];
    const end = distance ? travelled / distance : i / (points.length - 1);
    const cuts = [1 / 3, 2 / 3].filter(cut => cut > start && cut < end);
    cuts.push(end);
    let previous = start;
    for (const cut of cuts) {
      const fraction = (cut - start) / (end - start);
      const point = cut === end ? points[i] : {x: points[i - 1].x + (points[i].x - points[i - 1].x) * fraction, y: points[i - 1].y + (points[i].y - points[i - 1].y) * fraction};
      segments.push({point, duration: timeAt(cut) - timeAt(previous)});
      previous = cut;
    }
    start = end;
  }
  return segments;
}
const ease = t => t * t * t * (10 + t * (-15 + t * 6));
export function trajectory(from, to, bounds, {human = true, duration = 300, minSteps = 1, stepMs = 20, random = Math.random} = {}) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(minSteps, Math.ceil(duration / stepMs));
  const overshoot = human && distance > 30 ? Math.min(10, distance * 0.04) : 0;
  const ux = (to.x - from.x) / (distance || 1), uy = (to.y - from.y) / (distance || 1);
  const beyond = {x: clamp(to.x + ux * overshoot, 0, bounds.width - 1), y: clamp(to.y + uy * overshoot, 0, bounds.height - 1)};
  let nx = 0, ny = 0;
  const path = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const correction = overshoot > 0 && t > 0.8;
    const p = ease(correction ? (t - 0.8) / 0.2 : t / (overshoot > 0 ? 0.8 : 1));
    const start = correction ? beyond : from, end = correction ? to : beyond;
    nx = 0.75 * nx + 0.25 * gaussian(random);
    ny = 0.75 * ny + 0.25 * gaussian(random);
    const envelope = human ? Math.sin(Math.PI * t) * Math.min(3, distance * 0.02) : 0;
    path.push({x: clamp(start.x + (end.x - start.x) * p + nx * envelope, 0, bounds.width - 1), y: clamp(start.y + (end.y - start.y) * p + ny * envelope, 0, bounds.height - 1), delay: duration / steps});
  }
  path[path.length - 1] = {...to, delay: duration / steps};
  return path;
}
