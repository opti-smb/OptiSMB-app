/**
 * Some parsers return `{ parsedData: { ...canonical fields } }` while the UI expects a flat object.
 * Unwrap so `fee_lines`, `pos_settlement_batches`, etc. sit at the top level before finalize / xlsx augment.
 */
export function unwrapParserPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const inner = data.parsedData ?? data.statement_data ?? null;
  if (inner && typeof inner === 'object') {
    const { parsedData: _pd, statement_data: _sd, ...rest } = data;
    return { ...rest, ...inner };
  }
  return data;
}
