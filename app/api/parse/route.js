export const runtime = 'nodejs';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PARSE_PROMPT = `You are a payment acquiring statement parser. Extract structured data from the provided statement content.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "acquirer_name": "string",
  "billing_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "merchant_id": "string or null",
  "total_transaction_volume": number,
  "total_fees_charged": number,
  "effective_rate": number,
  "interchange_fees": number,
  "scheme_fees": number,
  "service_fees": number,
  "other_fees": number,
  "currency": "USD",
  "channel_split": {
    "pos": { "volume": number, "fees": number },
    "cnp": { "volume": number, "fees": number }
  },
  "fee_lines": [
    { "type": "string", "rate": "string", "amount": number, "card_type": "string", "channel": "string", "confidence": "high|medium|low" }
  ],
  "parsing_confidence": "high|medium|low",
  "notes": "string or null"
}

If you cannot determine a value from the content, use 0 for numbers and null for strings. Infer the acquirer name from any branding visible in the content. The effective_rate is total_fees_charged / total_transaction_volume * 100.`;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = String(formData.get('fileName') || '');
    const fileType = String(formData.get('fileType') || '');

    if (!OPENROUTER_API_KEY) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    let content = '';
    let parseMethod = 'llm';

    // Read text content from file
    if (fileType.includes('csv') || fileName.endsWith('.csv') || fileType.includes('text')) {
      const buffer = await file.arrayBuffer();
      content = Buffer.from(buffer).toString('utf-8');
      parseMethod = 'csv_llm';
    } else if (fileType.includes('json')) {
      const buffer = await file.arrayBuffer();
      content = Buffer.from(buffer).toString('utf-8');
      parseMethod = 'json_llm';
    } else {
      // PDF / XLSX: return a signal that demo data should be used
      return Response.json({
        success: false,
        reason: 'binary_format',
        message: 'Binary file format detected. Using demo analysis data.',
      });
    }

    if (!content || content.length < 20) {
      return Response.json({ success: false, reason: 'empty', message: 'File appears to be empty.' });
    }

    // Truncate very large files to avoid token limits
    const truncated = content.length > 12000 ? content.slice(0, 12000) + '\n[...truncated for parsing]' : content;

    const response = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://optismb.com',
        'X-Title': 'OptiSMB Parser',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [
          { role: 'system', content: PARSE_PROMPT },
          {
            role: 'user',
            content: `Parse this payment acquiring statement:\n\nFilename: ${fileName}\n\nContent:\n${truncated}`,
          },
        ],
        max_tokens: 2000,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter parse error:', err);
      return Response.json({ success: false, reason: 'api_error', message: err });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Strip markdown code fences if present
    const jsonStr = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('JSON parse failed:', rawContent);
      return Response.json({ success: false, reason: 'parse_failed', message: 'Could not parse AI response as JSON.' });
    }

    return Response.json({ success: true, data: parsed, method: parseMethod });
  } catch (err) {
    console.error('Parse route error:', err);
    return Response.json({ success: false, reason: 'internal', message: String(err) }, { status: 500 });
  }
}
