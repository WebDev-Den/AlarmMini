import { REGIONS } from './state.js';

// Observations only: a restart or a gap cannot establish when an alarm began.
export function createAlertStats(staleMs, limit = 80) {
  let previous = null, firstAt = null, gaps = 0, changes = 0, peakActive = 0;
  const regions = REGIONS.map(({key, name}) => ({key, name, starts:0, clears:0, changes:0, lastChangedAt:null}));
  const events = [];
  function observe(states, at) {
    firstAt ??= new Date(at).toISOString();
    peakActive = Math.max(peakActive, states.filter(state => state !== 0).length);
    if (previous && at - previous.at < staleMs && at >= previous.at) {
      let changed = false;
      states.forEach((state, i) => {
        const from = previous.states[i];
        if (state === from) return;
        changed = true;
        const region = regions[i];
        region.changes++;
        if (from === 0) region.starts++;
        if (state === 0) region.clears++;
        region.lastChangedAt = new Date(at).toISOString();
        events.push({key:region.key, name:region.name, from, to:state, at:region.lastChangedAt});
        if (events.length > limit) events.shift();
      });
      if (changed) changes++;
    } else if (previous) gaps++;
    previous = {states:[...states], at};
  }
  function view() {
    return {firstAt, gaps, changes, peakActive, regions:regions.map(r => ({...r})),
      events:events.slice().reverse().map(e => ({...e})), limit};
  }
  return {observe, view};
}
