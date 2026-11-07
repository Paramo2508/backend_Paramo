// Street openness from its height/width ratio (PBI-8.3, ADR-028). Oke (1988): below 0.3 the
// buildings barely interact with the wind (open space); above 0.65 the street is a canyon that
// only lets the wind through along it.
const OPEN_HW_RATIO = 0.3;
const CANYON_HW_RATIO = 0.65;
// The part of the wind across the street only reaches it in open spaces, and from the side it
// bothers less than in the face.
const CROSSWIND_FACTOR = 0.5;
// A segment whose openness has not been computed counts as open.
const DEFAULT_OPENNESS = 1;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const toRadians = (degrees) => (degrees * Math.PI) / 180;

// 1 in an open space, 0 in a canyon, linear in between.
function opennessFromRatio(hwRatio) {
  if (!Number.isFinite(hwRatio) || hwRatio <= 0) return 1;
  return clamp((CANYON_HW_RATIO - hwRatio) / (CANYON_HW_RATIO - OPEN_HW_RATIO), 0, 1);
}

/*
 * The wind is split into the part along the street (alongAlignment, PBI-8.1 and PBI-8.2), which
 * the street channels whatever its buildings, and the part across it, |sin θ|, which only reaches
 * open streets: alongAlignment + openness × CROSSWIND_FACTOR × |sin θ|, at most 1.
 */
function withCrosswind(alongAlignment, angleDeg, openness) {
  const open = Number.isFinite(openness) ? clamp(openness, 0, 1) : 0;
  return Math.min(
    1,
    alongAlignment + open * CROSSWIND_FACTOR * Math.abs(Math.sin(toRadians(angleDeg)))
  );
}

module.exports = {
  CANYON_HW_RATIO,
  CROSSWIND_FACTOR,
  DEFAULT_OPENNESS,
  OPEN_HW_RATIO,
  opennessFromRatio,
  withCrosswind
};
