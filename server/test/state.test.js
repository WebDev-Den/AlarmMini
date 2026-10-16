import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAlerts, buildRegionIndex, legacyStates, REGIONS, UnknownRegionError } from '../src/state.js';

const index = buildRegionIndex();
const record = (id, levels, extra = {}) => ({
  regionId: id, regionType: 'Community',
  activeAlerts: [{ type: 'AIR', activeAlertLevels: levels.map(alertLevel => ({ alertLevel })), ...extra }],
});

test('keeps the exact 25-position firmware order and combines Kyiv with its oblast', () => {
  assert.equal(REGIONS.length, 25);
  assert.equal(index.size, 1605);
  const ids = ['4','8','9','28','10','11','12','13','14','15','16','27','17','18','19','5','20','21','22','23','3','24','26','25','9999'];
  ids.forEach((id, i) => {
    assert.equal(index.get(id), i);
    assert.equal(REGIONS[i].stateId, id);
  });
  assert.equal(index.get('31'), 8);
  const states = aggregateAlerts([record('31', ['Yellow']), record('14', ['Red'])], index);
  assert.equal(states[8], 3);
  assert.equal(states.filter(Boolean).length, 1);
});

test('distinguishes whole-oblast AIR from partial AIR for every map position', () => {
  for (const [position, region] of REGIONS.entries()) {
    for (const [color, whole, partial] of [['Red', 1, 4], ['Yellow', 2, 5]]) {
      assert.equal(aggregateAlerts([{...record(region.stateId, [color]), regionType:'State'}], index)[position], whole);
      const childId = region.ids.find(id => id !== region.stateId);
      if (childId) assert.equal(aggregateAlerts([record(childId, [color])], index)[position], partial);
    }
  }
});

test('any mix wins across scopes and within one alert, independent of order or duplicates', () => {
  for (const levels of [['Yellow', 'Red'], ['Red', 'Yellow'], ['Red', 'Red', 'Yellow']]) {
    for (const id of ['711', '73', '14']) {
      assert.equal(aggregateAlerts([record(id, levels)], index)[8], 3);
    }
  }
  for (const redId of ['14', '73', '711', '31']) {
    for (const yellowId of ['14', '73', '711', '31']) {
      const payload = [record(redId, ['Red']), record(yellowId, ['Yellow'])];
      assert.equal(aggregateAlerts(payload, index)[8], 3);
      assert.equal(aggregateAlerts([...payload].reverse(), index)[8], 3);
      assert.equal(aggregateAlerts([...payload, ...payload], index)[8], 3);
    }
  }
});

test('same-color descendants stay partial until the oblast itself has that color', () => {
  for (const [color, full, partial] of [['Red', 1, 4], ['Yellow', 2, 5]]) {
    const descendants = REGIONS[8].ids.filter(id => id !== '14').map(id => record(id, [color]));
    assert.equal(aggregateAlerts(descendants, index)[8], partial);
    assert.equal(aggregateAlerts([...descendants, record('14', [color])], index)[8], full);
    assert.equal(aggregateAlerts([record('14', [color]), ...descendants], index)[8], full);
    assert.equal(aggregateAlerts([...descendants, record('14', [])], index)[8], partial);
  }
});

test('Kyiv city alone is partial, while Kyiv oblast has whole-oblast scope', () => {
  assert.equal(aggregateAlerts([{...record('31', ['Red']), regionType:'State'}], index)[8], 4);
  assert.equal(aggregateAlerts([{...record('31', ['Yellow']), regionType:'State'}], index)[8], 5);
  assert.equal(aggregateAlerts([record('14', ['Red'])], index)[8], 1);
  assert.equal(aggregateAlerts([record('14', ['Yellow'])], index)[8], 2);
});

test('complete snapshots recompute mixed, whole, partial and clear without latching previous levels', () => {
  assert.equal(aggregateAlerts([record('711', ['Yellow']), record('14', ['Red'])], index)[8], 3);
  assert.equal(aggregateAlerts([record('711', []), record('14', ['Red'])], index)[8], 1);
  assert.equal(aggregateAlerts([record('14', []), record('73', ['Red'])], index)[8], 4);
  assert.equal(aggregateAlerts([record('14', ['Yellow']), record('73', [])], index)[8], 2);
  assert.equal(aggregateAlerts([record('711', ['Yellow']), record('73', [])], index)[8], 5);
  assert.equal(aggregateAlerts([record('711', []), record('73', [])], index)[8], 0);
  assert.deepEqual(aggregateAlerts([], index), Array(25).fill(0));
});

test('uses AIR only and the individual alert scope, including CityOrVillage records', () => {
  const payload = [
    { ...record('31', ['Red']), regionType: 'CityOrVillage' },
    record('4', ['Red'], { type: 'ARTILLERY' }),
    { ...record('14', ['Red'], { regionId: '711', regionType:'Community' }), regionType:'State' },
  ];
  const states = aggregateAlerts(payload, index);
  assert.equal(states[8], 4);
  assert.equal(states[0], 0);
  assert.equal(aggregateAlerts([record('711', ['Yellow'], {regionId:'14', regionType:'State'})], index)[8], 2);
  assert.deepEqual(legacyStates([0, 1, 2, 3, 4, 5]), [0, 1, 1, 1, 1, 1]);
});

test('missing new level field remains an active red alarm; malformed data never becomes clear', () => {
  for (const activeAlertLevels of [undefined, null]) {
    assert.equal(aggregateAlerts([record('14', [], { activeAlertLevels })], index)[8], 1);
    assert.equal(aggregateAlerts([record('711', [], { activeAlertLevels })], index)[8], 4);
    assert.equal(aggregateAlerts([record('711', [], { activeAlertLevels }), record('14', ['Yellow'])], index)[8], 3);
  }
  for (const payload of [{error: 'failure'}, [null], [{regionId:'14'}], [record('14', ['Blue'])], [record('14', ['Red', 'Yellow', 'Blue'])]]) {
    assert.throws(() => aggregateAlerts(payload, index));
  }
  assert.throws(() => aggregateAlerts([record('900001', ['Yellow'])], index), UnknownRegionError);
});

test('live regions catalogue discovers new descendants and rejects ambiguous assignments', () => {
  const tree = { states: [{ regionId: '14', regionChildIds: [
    { regionId: '73', regionChildIds: [{ regionId: 900001, regionChildIds: [] }] },
  ] }] };
  const updated = buildRegionIndex(tree);
  assert.equal(aggregateAlerts([record('900001', ['Yellow'])], updated)[8], 5);
  assert.equal(updated.get('31'), 8);
  assert.throws(() => buildRegionIndex({ states: [{ regionId:'4', regionChildIds:[{regionId:'14'}] }] }));
  assert.throws(() => buildRegionIndex({ states: [] }));
});
