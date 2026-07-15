import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PLAYLISTS } from "../src/catalog.mjs";
import { MODULE_CONFIG, QUICK_CATEGORIES } from "../src/config.mjs";
import {
  buildCandidateQueue,
  buildQuickQueue,
  candidateAllowed,
  resolveAssistantIntent,
  stableSample,
  validateModuleConfig,
} from "../src/core.mjs";

test("the PRD intent order and configuration are valid", () => {
  assert.deepEqual(validateModuleConfig(MODULE_CONFIG), []);
  assert.deepEqual(
    MODULE_CONFIG.intents.map(intent => intent.id),
    ["focus", "relax", "energy", "party", "release", "sleep"],
  );
});

test("every intent has two primary candidates, one fallback, and at most three refinements", () => {
  for (const intent of MODULE_CONFIG.intents) {
    assert.equal(intent.playlistPool.length, 2);
    assert.equal(intent.fallbackPool.length, 1);
    assert.ok(intent.refineOptions.length <= 3);
    const ids = [...intent.playlistPool, ...intent.fallbackPool].map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("candidate queues are stable and always put fallbacks after primary candidates", () => {
  const intent = MODULE_CONFIG.intents.find(item => item.id === "focus");
  const context = { country: "MX", language: "es", timeRange: "day" };
  const first = buildCandidateQueue(intent, context, "stable-session");
  const second = buildCandidateQueue(intent, context, "stable-session");

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(item => item.candidateSource), ["primary", "primary", "fallback"]);
  assert.deepEqual(first.map(item => item.candidateRank), [1, 2, 3]);
});

test("unavailable and out-of-scope candidates are excluded", () => {
  const context = { country: "MX", language: "es", timeRange: "day" };
  assert.equal(candidateAllowed({ available: false }, context), false);
  assert.equal(candidateAllowed({ available: true, countries: ["BR"] }, context), false);
  assert.equal(candidateAllowed({ available: true, countries: ["*"] }, context), true);
  assert.equal(candidateAllowed({ available: true, languages: ["pt"] }, context), false);
  assert.equal(candidateAllowed({ available: true, timeRanges: ["night"] }, context), false);
});

test("the assistant resolves after exactly moment and desired-energy choices", () => {
  assert.equal(resolveAssistantIntent("bedtime", "happy"), "sleep");
  assert.equal(resolveAssistantIntent("study", "focus"), "focus");
  assert.equal(resolveAssistantIntent("workout", "high"), "energy");
  assert.equal(resolveAssistantIntent("party", "happy"), "party");
  assert.equal(resolveAssistantIntent("rest", "emotional"), "release");
  assert.equal(resolveAssistantIntent("rest", "calm"), "relax");
});

test("the original catalog is complete and contains unique playlist IDs", () => {
  assert.equal(ALL_PLAYLISTS.length, 622);
  assert.equal(new Set(ALL_PLAYLISTS.map(item => item.id)).size, 622);
});

test("one-tap categories are sampled stably from a larger pool", () => {
  assert.ok(QUICK_CATEGORIES.length > 6);
  const first = stableSample(QUICK_CATEGORIES, 6, "session-a");
  const second = stableSample(QUICK_CATEGORIES, 6, "session-a");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(item => item.id)).size, 6);
});

test("every randomized one-tap category produces two primary playlists and one fallback", () => {
  for (const category of QUICK_CATEGORIES) {
    const queue = buildQuickQueue(category, ALL_PLAYLISTS, "stable-session");
    assert.equal(queue.length, 3);
    assert.deepEqual(queue.map(item => item.candidateSource), ["primary", "primary", "fallback"]);
    assert.equal(new Set(queue.map(item => item.id)).size, 3);
  }
});
