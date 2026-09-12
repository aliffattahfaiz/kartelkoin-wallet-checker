import { NextRequest, NextResponse } from 'next/server';

const MEM0_API_URL = process.env.MEM0_API_URL || 'http://100.68.105.98:8889';
const MEM0_API_KEY = process.env.MEM0_API_KEY || 'm0sk_b8Swg7LkdBHBPH-UG5h6_-zB0xkxSrfEqDzYDIZdzD8';

function addMem0Memory(text: string, source: string) {
  return fetch(`${MEM0_API_URL}/memories`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MEM0_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      metadata: { source },
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { chain, tokens } = await req.json() as {
      chain: 'solana' | 'ethereum';
      tokens: string[];
    };

    if (!chain || !tokens?.length) {
      return NextResponse.json({ error: 'chain and tokens required' }, { status: 400 });
    }

    // Upsert: store custom tokens in Mem0 as a JSON memory.
    // Format: { customTokens: { solana: [...], ethereum: [...] } }
    const currentRes = await fetch(`${MEM0_API_URL}/memories`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${MEM0_API_KEY}` },
    });

    let existing: { customTokens: Record<string, string[]> } = { customTokens: { solana: [], ethereum: [] } };
    if (currentRes.ok) {
      const data = await currentRes.json();
      const match = data.memories?.find((m: any) => m.metadata?.source === 'custom_tokens');
      if (match) {
        try { existing = JSON.parse(match.text); } catch { /* fall through */ }
      }
    }

    existing.customTokens[chain] = [...new Set([...existing.customTokens[chain], ...tokens])];

    const upsert = await addMem0Memory(
      JSON.stringify(existing),
      'custom_tokens'
    );

    if (!upsert.ok) {
      const errText = await upsert.text();
      console.error('Mem0 upsert error:', upsert.status, errText);
      return NextResponse.json({ error: 'Failed to persist tokens' }, { status: upsert.status });
    }

    return NextResponse.json({ ok: true, customTokens: existing.customTokens });
  } catch (err: any) {
    console.error('Custom tokens error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
