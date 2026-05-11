/**
 * Stable finalize entry: runs core repairs then one scalar sync so POS/e‑comm headline fields match Channel tab.
 */

import { finalizeParsedForClientCore } from './currencyConversion.js';
import { syncParsedDataVolumeScalars } from './statementVolumeSync.js';
import { applyFormatCompatibilityLayer } from './statementFormatValidation.js';

/**
 * @param {object | null | undefined} parsed
 */
export function finalizeParsedForClient(parsed) {
  const core = finalizeParsedForClientCore(parsed);
  let out = syncParsedDataVolumeScalars(core);
  out = applyFormatCompatibilityLayer(out);
  if (process.env.NODE_ENV === 'development') {
    const cs = out?.channel_split;
    console.log('FINAL STATE:', {
      pos_volume: out?.pos_volume,
      ecomm_volume: out?.ecomm_volume,
      total_transaction_volume: out?.total_transaction_volume,
      channel_split_keys:
        cs && typeof cs === 'object' && !Array.isArray(cs) ? Object.keys(cs) : [],
    });
  }
  return out;
}
