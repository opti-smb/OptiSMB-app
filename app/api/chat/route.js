export const runtime = 'nodejs';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are OptiSMB's statement Q&A assistant. You answer questions about a specific payment acquiring statement.

STRICT RULES:
1. Answer ONLY using the statement data provided in the context below.
2. Never invent numbers, fees, or comparisons not present in the data.
3. If a question cannot be answered from the statement data, respond EXACTLY with: "This question cannot be answered from your uploaded statement data. Try asking about fees, rates, discrepancies, or savings shown in your report."
4. Always cite the data field(s) your answer is derived from at the end, formatted as: [Source: field_name]
5. Be concise and precise. Use exact dollar amounts and percentages from the data.
6. You may perform arithmetic on the provided numbers (e.g. summing fee lines).`;

export async function POST(request) {
  try {
    const { messages, statementContext } = await request.json();

    if (!OPENROUTER_API_KEY) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    const contextBlock = statementContext
      ? `\n\n## Statement Data (use ONLY this data to answer):\n${JSON.stringify(statementContext, null, 2)}`
      : '';

    const response = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://optismb.com',
        'X-Title': 'OptiSMB Q&A',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + contextBlock },
          ...messages,
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return Response.json({ error: 'AI service error', detail: err }, { status: 502 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'No response received.';

    return Response.json({ content });
  } catch (err) {
    console.error('Chat route error:', err);
    return Response.json({ error: 'Internal error', detail: String(err) }, { status: 500 });
  }
}
