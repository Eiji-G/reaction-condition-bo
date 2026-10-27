const SQRT2 = Math.sqrt(2);
const SQRT2PI = Math.sqrt(2 * Math.PI);

export function normalizeNames(text) {
  return [...new Set(String(text).split(/[\n,，]/).map(x => x.trim()).filter(Boolean))];
}

export function wavelengthValues(min, max, step) {
  min = Number(min); max = Number(max); step = Number(step);
  if (![min, max, step].every(Number.isFinite) || min <= 0 || max < min || step <= 0) {
    throw new Error("Check the minimum, maximum, and step for the saved wavelength range.");
  }
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  if (count > 1000) throw new Error("Too many wavelength candidates in the saved range.");
  return Array.from({length: count}, (_, i) => Number((min + i * step).toFixed(8)));
}

export function configuredWavelengths(config) {
  const custom = String(config.wavelengthList || '').trim();
  if (!custom) throw new Error('Enter at least one wavelength candidate.');
  const values = [...new Set(custom.split(/[\s,，]+/).filter(Boolean).map(Number))];
  if (!values.length || values.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new Error('Enter wavelength candidates as positive numbers.');
  }
  if (values.length > 1000) throw new Error('Too many wavelength candidates.');
  return values.sort((a, b) => a - b);
}

export function makeCandidates(config) {
  const catalysts = normalizeNames(config.catalysts);
  const bases = normalizeNames(config.bases);
  const solvents = normalizeNames(config.solvents);
  if (![catalysts, bases, solvents].every(x => x.length)) {
    throw new Error("Enter at least one catalyst, base, and solvent candidate.");
  }
  const wavelengths = configuredWavelengths(config);
  const total = catalysts.length * bases.length * solvents.length * wavelengths.length;
  if (total > 30000) throw new Error(`The search space has ${total.toLocaleString('en-US')} conditions. Reduce it to 30,000 or fewer.`);
  const out = [];
  for (const catalyst of catalysts) for (const base of bases) for (const solvent of solvents) {
    for (const wavelength of wavelengths) out.push({catalyst, base, solvent, wavelength});
  }
  return out;
}

export function conditionKey(x) {
  return JSON.stringify([x.catalyst, x.base, x.solvent, Number(x.wavelength)]);
}

function distance(a, b, span) {
  const mismatch = Number(a.catalyst !== b.catalyst) + Number(a.base !== b.base) + Number(a.solvent !== b.solvent);
  const wave = Math.abs(a.wavelength - b.wavelength) / Math.max(span, 1);
  return Math.sqrt(mismatch / 3 + wave * wave);
}

function kernel(a, b, span) {
  const mismatch = Number(a.catalyst !== b.catalyst) + Number(a.base !== b.base) + Number(a.solvent !== b.solvent);
  const length = Math.max(span * 0.3, 1);
  const d = (a.wavelength - b.wavelength) / length;
  return Math.pow(0.3, mismatch) * Math.exp(-0.5 * d * d);
}

function cholesky(matrix) {
  const n = matrix.length, lower = Array.from({length: n}, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let sum = matrix[i][j];
    for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
    if (i === j) {
      if (sum <= 0 || !Number.isFinite(sum)) throw new Error("The model could not be calculated. Check the experiment data.");
      lower[i][j] = Math.sqrt(sum);
    } else lower[i][j] = sum / lower[j][j];
  }
  return lower;
}

function solveLower(lower, b) {
  const x = [];
  for (let i = 0; i < b.length; i++) {
    let v = b[i];
    for (let j = 0; j < i; j++) v -= lower[i][j] * x[j];
    x.push(v / lower[i][i]);
  }
  return x;
}

function solveUpperFromLower(lower, b) {
  const n = b.length, x = Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = b[i];
    for (let j = i + 1; j < n; j++) v -= lower[j][i] * x[j];
    x[i] = v / lower[i][i];
  }
  return x;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function cdf(z) { return 0.5 * (1 + erf(z / SQRT2)); }
function pdf(z) { return Math.exp(-0.5 * z * z) / SQRT2PI; }

export function suggest(config, history) {
  const candidates = makeCandidates(config);
  const candidateKeys = new Set(candidates.map(conditionKey));
  const valid = history.filter(x => candidateKeys.has(conditionKey(x))
    && Number.isFinite(Number(x.yield)) && Number(x.yield) >= 0 && Number(x.yield) <= 100);
  const used = new Set(valid.map(conditionKey));
  const available = candidates.filter(x => !used.has(conditionKey(x)));
  if (!available.length) throw new Error("All conditions have already been measured.");
  const wavelengths = configuredWavelengths(config);
  const span = Math.max(...wavelengths) - Math.min(...wavelengths);
  const target = Number(config.target);
  if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error("Enter a target yield between 0% and 100%.");

  // Use a space-filling design until enough outcomes exist for a useful GP fit.
  if (valid.length < 3) {
    const anchors = valid.length ? valid : [candidates[0]];
    let best = available[0], bestDistance = -1;
    for (const x of available) {
      const nearest = Math.min(...anchors.map(a => distance(x, a, span)));
      if (nearest > bestDistance) { best = x; bestDistance = nearest; }
    }
    return {condition: best, phase: "Initial exploration", observedCount: valid.length, excludedCount: history.length - valid.length, prediction: null};
  }

  const y = valid.map(x => Number(x.yield));
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const sd = Math.max(10, Math.sqrt(y.reduce((s, v) => s + (v - mean) ** 2, 0) / y.length));
  const k = valid.map((a, i) => valid.map((b, j) => kernel(a, b, span) + (i === j ? 0.02 : 0)));
  const lower = cholesky(k);
  const alpha = solveUpperFromLower(lower, solveLower(lower, y.map(v => (v - mean) / sd)));
  const bestObserved = Math.max(...y);
  let best = null, bestScore = -Infinity;
  for (const x of available) {
    const kv = valid.map(a => kernel(x, a, span));
    const standardizedMean = kv.reduce((s, v, i) => s + v * alpha[i], 0);
    const v = solveLower(lower, kv);
    const variance = Math.max(1e-8, 1 - v.reduce((s, z) => s + z * z, 0));
    const predictedMean = mean + sd * standardizedMean;
    const predictedSd = sd * Math.sqrt(variance);
    const z = (predictedMean - bestObserved) / predictedSd;
    const improvement = (predictedMean - bestObserved) * cdf(z) + predictedSd * pdf(z);
    if (improvement > bestScore) {
      bestScore = improvement;
      best = {condition: x, phase: "Bayesian optimization", observedCount: valid.length,
        excludedCount: history.length - valid.length,
        prediction: {mean: predictedMean, sd: predictedSd, probabilityAtTarget: cdf((predictedMean - target) / predictedSd), expectedImprovement: improvement}};
    }
  }
  return best;
}
