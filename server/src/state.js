import { readFileSync } from 'node:fs';

// Order and seed IDs are taken from the user's original Node-RED flow.
export const REGIONS = JSON.parse(readFileSync(new URL('../data/regions.json', import.meta.url), 'utf8'));
export const CLEAR = 0;
export const RED = 1;
export const YELLOW = 2;
export const MIXED = 3;
export const PARTIAL_RED = 4;
export const PARTIAL_YELLOW = 5;
export const STATE_LEVELS = ['Clear', 'Red', 'Yellow', 'Mixed', 'PartialRed', 'PartialYellow'];

export class UnknownRegionError extends Error {
  constructor(id) {
    super(`Unmapped active AIR region: ${id}`);
    this.code = 'UNKNOWN_REGION';
  }
}

function regionId(value) {
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) {
    throw new Error('Invalid regionId');
  }
  const id = String(value);
  if (!/^\d+$/.test(id)) throw new Error('Invalid regionId');
  return id;
}

export function buildRegionIndex(tree) {
  const index = new Map();
  function assign(id, position) {
    if (index.has(id) && index.get(id) !== position) throw new Error(`Conflicting region ID: ${id}`);
    index.set(id, position);
  }
  REGIONS.forEach((region, position) => region.ids.forEach(id => assign(regionId(id), position)));
  if (tree === undefined) return index;
  if (!tree || !Array.isArray(tree.states) || !tree.states.length) throw new Error('Invalid regions response');
  const seen = new Set();
  function visit(node, parentPosition) {
    const id = regionId(node?.regionId);
    if (seen.has(id)) throw new Error(`Duplicate region in tree: ${id}`);
    seen.add(id);
    const position = parentPosition ?? index.get(id);
    if (position !== undefined) assign(id, position);
    const children = node.regionChildIds ?? [];
    if (!Array.isArray(children)) throw new Error('Invalid regionChildIds');
    for (const child of children) visit(child, position);
  }
  for (const state of tree.states) visit(state);
  return index;
}

function alertColors(alert) {
  const levels = alert.activeAlertLevels;
  // Older responses may contain an active AIR record without the new field.
  // Preserve the active alarm as red; never interpret missing data as all-clear.
  if (levels == null) return { red: true, yellow: false };
  if (!Array.isArray(levels)) throw new Error('Invalid activeAlertLevels');
  const colors = { red: false, yellow: false };
  for (const level of levels) {
    if (level?.alertLevel === 'Red') colors.red = true;
    else if (level?.alertLevel === 'Yellow') colors.yellow = true;
    else throw new Error('Unknown AIR alert level');
  }
  return colors;
}

export function aggregateAlerts(payload, regionIndex) {
  if (!Array.isArray(payload)) throw new Error('Alerts response must be an array');
  const coverage = REGIONS.map(() => ({ red: false, yellow: false, wholeRed: false, wholeYellow: false }));
  for (const container of payload) {
    if (!container || !Array.isArray(container.activeAlerts)) throw new Error('Invalid activeAlerts');
    for (const alert of container.activeAlerts) {
      if (!alert || typeof alert.type !== 'string') throw new Error('Invalid alert type');
      if (alert.type !== 'AIR') continue;
      const colors = alertColors(alert);
      if (!colors.red && !colors.yellow) continue;
      // An alert's ID describes its scope; the enclosing object can be a parent.
      const id = regionId(alert.regionId ?? container.regionId);
      const position = regionIndex.get(id);
      if (position === undefined) throw new UnknownRegionError(id);
      const area = coverage[position];
      // Only the oblast's own scope is whole. Kyiv city shares the map slot,
      // but its State record must not turn a city-only alert into oblast coverage.
      const whole = id === REGIONS[position].stateId;
      area.red ||= colors.red;
      area.yellow ||= colors.yellow;
      area.wholeRed ||= whole && colors.red;
      area.wholeYellow ||= whole && colors.yellow;
    }
  }
  return coverage.map(area => {
    // Any coexistence is mixed, even when both colors are only partial.
    if (area.red && area.yellow) return MIXED;
    if (area.red) return area.wholeRed ? RED : PARTIAL_RED;
    if (area.yellow) return area.wholeYellow ? YELLOW : PARTIAL_YELLOW;
    return CLEAR;
  });
}

export function legacyStates(states) {
  return states.map(state => state === CLEAR ? 0 : 1);
}
