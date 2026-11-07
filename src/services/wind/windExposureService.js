const { DEFAULT_OPENNESS } = require('../../domain/wind/streetOpenness');
const { calculateWindExposure } = require('../../domain/wind/windExposure');
const defaultOpenness = require('../../repositories/opennessRepository');
const defaultSegments = require('../../repositories/segmentRepository');
const { httpError } = require('../../utils/httpError');
const { getZaragozaWeather } = require('../weather/weatherService');

async function resolveWind(override, weather) {
  if (override) return { ...override, source: 'request', time: null };
  const current = await weather();
  return {
    speedKmh: current.windSpeed,
    directionDeg: current.windDirection,
    source: 'open-meteo',
    time: current.time
  };
}

/*
 * Wind exposure of one segment (ADR-024), with the openness of the street (ADR-028). Without an
 * override it uses the current Open-Meteo wind of PBI-7, which is cached for five minutes.
 */
async function getSegmentWindExposure(
  segmentId,
  override,
  {
    segments = defaultSegments,
    openness: opennessRepository = defaultOpenness,
    weather = getZaragozaWeather
  } = {}
) {
  const segment = await segments.getSegmentById(segmentId);
  if (!segment) throw httpError(404, 'No existe el tramo indicado.');

  const [wind, pieces, street] = await Promise.all([
    resolveWind(override, weather),
    segments.getSegmentPieces(segmentId),
    opennessRepository.getSegmentOpenness(segmentId)
  ]);
  const openness = street?.openness ?? DEFAULT_OPENNESS;
  return {
    segmentId,
    segmentSourceId: segment.sourceId,
    name: segment.name,
    lengthM: segment.lengthM,
    wind,
    openness,
    street: street && {
      widthM: street.widthM,
      heightM: street.heightM,
      hwRatio: street.hwRatio,
      samples: street.samples
    },
    ...calculateWindExposure(pieces, wind, { openness })
  };
}

module.exports = { getSegmentWindExposure };
