/** Host-neutral write lifecycle. No credentials, connector or implicit retry. */
export async function performVerifiedWrite({ authorize, write, readback, matches, onState = () => {} }) {
  if (![authorize, write, readback, matches, onState].every(x => typeof x === 'function')) throw new TypeError('Explicit lifecycle callbacks required');
  // UI observers must never alter a write outcome or cause a second request.
  const emit = state => { try { onState(state); } catch {} return state; };
  emit('awaiting-permission');
  let permission;
  try { permission = await authorize(); } catch { return emit('permission-failed'); }
  if (permission !== true) return emit('cancelled');
  emit('saving');
  let receipt;
  try { receipt = await write(); } catch { return emit('outcome-unknown'); }
  emit('checking');
  let actual;
  try { actual = await readback(receipt); } catch { return emit('readback-unavailable'); }
  let matched;
  try { matched = await matches(actual, receipt); } catch { return emit('verification-failed'); }
  return emit(matched === true ? 'verified' : 'conflict');
}

/** Decorations are gated by the actual lifecycle's readback result. */
export function feedbackClass(state) {
  return ({verified:'k-motion-confirmed',review:'k-motion-review',welcome:'k-motion-welcome'})[state] || '';
}

export const motionTokens = Object.freeze({fast:120,normal:180,enter:240,celebrate:420});
