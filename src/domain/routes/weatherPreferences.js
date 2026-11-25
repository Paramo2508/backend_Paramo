/*
 * «Según el tiempo de hoy» (PBI-21, ADR-037): the recommendation of PBI-9.1 (ADR-029, the same rule
 * and thresholds) turned into the answers of the questions of PBI-18, with the reason in plain words.
 * Shade with heat, sun with cold and avoid the wind with strong wind; with mild weather, at night or
 * with a low Sun every answer is indifferent, which is the fastest route. «Por parques» is never
 * marked: it is a personal choice, not a consequence of the weather, so the answers leave it out.
 * Pure: the recommendation comes in, nothing is read or saved here.
 */

const MARKED_NAMES = { shade: '«Sombra»', sun: '«Sol»', wind: '«Evitar el viento»' };

function answersFromRecommendation(weights) {
  let sunShade = 'any';
  if (weights.shade > 0) sunShade = 'shade';
  else if (weights.sun > 0) sunShade = 'sun';
  return { sunShade, avoidWind: weights.wind > 0 };
}

const joinNames = (names) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0];

/**
 * @param {{ criterion, cause, weights }} recommendation as returned by recommendRoute (ADR-029).
 * @returns {{ status: 'available'|'unavailable', criterion, answers: { sunShade, avoidWind }|null,
 *   message }} Without weather the answers are null: the preferences are not changed.
 */
function suggestPreferences(recommendation) {
  if (recommendation.criterion === 'weather_unavailable') {
    return {
      status: 'unavailable',
      criterion: recommendation.criterion,
      answers: null,
      message: `${recommendation.cause}: tus preferencias se quedan como estaban.`
    };
  }
  const answers = answersFromRecommendation(recommendation.weights);
  const marked = [
    answers.sunShade !== 'any' && MARKED_NAMES[answers.sunShade],
    answers.avoidWind && MARKED_NAMES.wind
  ].filter(Boolean);
  const proposal = marked.length
    ? `he marcado ${joinNames(marked)}`
    : 'no hace falta desviarse, así que te propongo la ruta más rápida';
  return {
    status: 'available',
    criterion: recommendation.criterion,
    answers,
    message: `${recommendation.cause}: ${proposal}.`
  };
}

module.exports = { suggestPreferences };
