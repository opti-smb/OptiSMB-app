import { File } from 'node:buffer';

export const runtime = 'nodejs';

/** Large statements can take >60s locally; Vercel may cap lower unless configured. */
export const maxDuration = 120;

/**
 * Uploads are parsed only by the Python FastAPI service (`python/app.py`).
 * Extraction + fee/volume math run in `statement_engine.py` before the response is returned.
 *
 * Set STATEMENT_PARSER_URL or default http://127.0.0.1:8000
 */

const PARSER_BASE =
  process.env.STATEMENT_PARSER_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8000';

function parserUrlLooksLocalhost(base) {
  try {
    const h = new URL(base).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return true;
  }
}

function parserUnreachableMessage(base, errDetail) {
  const tail = errDetail ? ` ${errDetail}` : '';
  if (parserUrlLooksLocalhost(base)) {
    return `Python parser at ${base} is not reachable.${tail} For local dev: run npm run parser (or uvicorn on port 8000).`;
  }
  return `Cannot reach statement parser at ${base}.${tail} Set STATEMENT_PARSER_URL in Vercel (or your host) to the public HTTPS URL of the FastAPI service, and ensure it is running.`;
}

/** Node multipart forwarding: use File from node:buffer (more reliable than Blob in some runtimes). */
async function forwardToPythonParser(fileBuffer, uploadName, mimeType, currency) {
  const out = new FormData();
  const pyFile = new File([fileBuffer], uploadName || 'upload', {
    type: mimeType || 'application/octet-stream',
  });
  out.append('file', pyFile);
  out.append('currency', currency);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${PARSER_BASE}/parse`, {
      method: 'POST',
      body: out,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: res.status,
        body: { success: false, reason: 'parser_bad_json', message: text.slice(0, 500) },
      };
    }
    if (!res.ok) {
      const detail = json?.detail ?? json?.message ?? text;
      let message = 'Request failed';
      let reason = 'parser_error';
      if (typeof detail === 'string') {
        message = detail;
        reason = res.status === 422 ? 'parse_rejected' : 'parser_error';
      } else if (detail && typeof detail === 'object') {
        message = detail.message ?? detail.msg ?? JSON.stringify(detail);
        if (detail.code === 'not_statement') reason = 'not_statement';
        else if (detail.code === 'unsupported_type') reason = 'unsupported_type';
        else if (res.status === 422) reason = 'parse_rejected';
      }
      return {
        ok: false,
        status: res.status,
        body: {
          success: false,
          reason,
          message,
          code: typeof detail === 'object' ? detail.code : undefined,
        },
      };
    }
    return { ok: true, body: json };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Parser request timed out.' : String(e);
    return {
      ok: false,
      status: 503,
      body: {
        success: false,
        reason: 'parser_unreachable',
        message: parserUnreachableMessage(PARSER_BASE, msg),
      },
    };
  } finally {
    clearTimeout(t);
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = String(formData.get('fileName') || '');
    const currency = String(formData.get('currency') || 'AUTO');

    if (!file || typeof file.arrayBuffer !== 'function') {
      return Response.json({ success: false, reason: 'missing_file', message: 'No file uploaded.' }, { status: 400 });
    }

    // Buffer once and send as Blob — forwarding the browser File stream through Node fetch is unreliable.
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const uploadName = fileName || (typeof file.name === 'string' ? file.name : 'upload');
    const mimeType = typeof file.type === 'string' ? file.type : '';

    const py = await forwardToPythonParser(fileBuffer, uploadName, mimeType, currency);

    if (py.ok && py.body?.success && py.body?.data) {
      return Response.json({
        success: true,
        data: py.body.data,
        method: py.body.method || 'python',
        file_type: py.body.file_type,
        extraction_ratio: py.body.extraction_ratio,
        parser: 'fastapi',
      });
    }

    const status = py.status >= 400 ? py.status : 503;
    return Response.json(
      py.body || {
        success: false,
        reason: 'parser_error',
        message: 'Statement parsing failed.',
      },
      { status },
    );
  } catch (err) {
    console.error('Parse route error:', err);
    const msg =
      err instanceof Error && err.message
        ? `${err.name}: ${err.message}`
        : String(err);
    const hint = parserUrlLooksLocalhost(PARSER_BASE)
      ? 'Check the terminal running `next dev` and ensure the Python parser is running (`npm run parser`).'
      : 'Confirm STATEMENT_PARSER_URL points to your deployed parser and the service is healthy.';
    return Response.json(
      {
        success: false,
        reason: 'internal',
        message: msg || `Unexpected error in /api/parse. ${hint}`,
      },
      { status: 500 },
    );
  }
}
