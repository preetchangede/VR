/**
 * Runtime switches read from the URL. They exist for testing in the IWER
 * emulator and for deterministic trailer capture; a player never needs them.
 *
 *   ?fixed=30        advance simulation by exactly 1/30 s per rendered frame
 *   ?beat=giant      jump the guided arc to a named beat
 *   ?debug           on-screen diagnostics
 *   ?nomesh          ignore the room mesh (test plane-only fallback)
 *   ?noplanes        ignore detected planes (test palm-placement fallback)
 *   ?mute            start with audio muted
 *   ?fresh           ignore saved progress
 *   ?cine            hide guidance UI (for trailer shots)
 */
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

const fixedHz = Number(q.get('fixed') || 0);

export const params = {
  fixedDt: fixedHz > 0 ? 1 / fixedHz : 0,
  beat: q.get('beat') || '',
  debug: q.has('debug'),
  noMesh: q.has('nomesh'),
  noPlanes: q.has('noplanes'),
  mute: q.has('mute'),
  fresh: q.has('fresh'),
  cine: q.has('cine'),
};
