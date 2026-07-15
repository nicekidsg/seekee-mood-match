export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scopeAllows(values, actual, wildcard) {
  return !values?.length || values.includes(wildcard) || values.includes(actual);
}

export function candidateAllowed(candidate, context) {
  return candidate.available !== false
    && scopeAllows(candidate.countries, context.country, "*")
    && scopeAllows(candidate.languages, context.language, "*")
    && scopeAllows(candidate.timeRanges, context.timeRange, "all");
}

function stableWeightedOrder(candidates, seed) {
  return [...candidates]
    .map(item => {
      const unit = (hashString(`${seed}:${item.id}`) + 1) / 4294967297;
      const weight = Math.max(1, Number(item.weight) || 1);
      return { item, order: -Math.log(unit) / weight };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);
}

export function buildCandidateQueue(intent, context, sessionId) {
  const primary = stableWeightedOrder(
    intent.playlistPool.filter(item => candidateAllowed(item, context)),
    `${sessionId}:${intent.id}:primary`,
  ).map(item => ({ ...item, candidateSource: "primary" }));

  const fallback = stableWeightedOrder(
    intent.fallbackPool.filter(item => candidateAllowed(item, context)),
    `${sessionId}:${intent.id}:fallback`,
  ).map(item => ({ ...item, candidateSource: "fallback" }));

  return [...primary, ...fallback].map((item, index) => ({
    ...item,
    candidateRank: index + 1,
  }));
}

export function resolveAssistantIntent(moment, energy) {
  if (moment === "bedtime") return "sleep";
  if (energy === "emotional") return "release";
  if (moment === "party") return "party";
  if (moment === "workout" || energy === "high") return "energy";
  if (energy === "focus" || moment === "study") return "focus";
  if (energy === "happy" && moment === "drive") return "energy";
  return "relax";
}

export function validateModuleConfig(config) {
  const errors = [];
  const expected = ["focus", "relax", "energy", "party", "release", "sleep"];
  const actual = config.intents.map(intent => intent.id);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("Intent order must be focus, relax, energy, party, release, sleep.");
  }

  for (const intent of config.intents) {
    const primaryIds = intent.playlistPool.map(item => item.id);
    const fallbackIds = intent.fallbackPool.map(item => item.id);
    const allIds = [...primaryIds, ...fallbackIds];

    if (primaryIds.length < 1 || fallbackIds.length < 1) {
      errors.push(`${intent.id} needs a primary and fallback playlist.`);
    }
    if (new Set(allIds).size !== allIds.length) {
      errors.push(`${intent.id} repeats a playlist between primary and fallback pools.`);
    }
    for (const language of ["es", "pt", "en"]) {
      if (!intent.labels[language]) errors.push(`${intent.id} is missing a ${language} label.`);
    }
    if (intent.refineOptions.length > 3) {
      errors.push(`${intent.id} has more than three refine options.`);
    }
  }

  return errors;
}

export function analyticsEvent(event, base, properties = {}) {
  return {
    event,
    ...base,
    ...properties,
    timestamp: new Date().toISOString(),
  };
}
