import { NextRequest, NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'aliffattahfaiz/kartelkoin-wallets';
const BASE_API     = `https://api.github.com/repos/${GITHUB_REPO}`;

type CustomTokens = { solana: string[]; ethereum: string[] };

const headers = {
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

async function getSha(path: string): Promise<string | null> {
  const res = await fetch(`${BASE_API}/contents${path}?ref=main`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha;
}

async function putFile(path: string, content: string, sha: string): Promise<void> {
  const res = await fetch(`${BASE_API}/contents${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `chore: update custom tokens`, content: btoa(content), sha, branch: 'main' }),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
}

async function createFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_API}/contents${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `chore: init custom tokens`, content: btoa(content), branch: 'main' }),
  });
  if (!res.ok) throw new Error(`GitHub create ${path}: ${res.status} ${await res.text()}`);
}

function defaultTokens(): CustomTokens { return { solana: [], ethereum: [] }; }
function clean(tokens: string[]) { return tokens.map(t => t.trim().toUpperCase()).filter(Boolean); }

export async function POST(req: NextRequest) {
  // read body once
  let body: { chain: 'solana' | 'ethereum'; tokens: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { chain, tokens } = body;
  if (!chain || (chain !== 'solana' && chain !== 'ethereum'))
    return NextResponse.json({ error: 'chain must be solana or ethereum' }, { status: 400 });
  const cleaned = clean(tokens);
  if (!cleaned.length) return NextResponse.json({ ok: true, customTokens: defaultTokens() });

  const newData: CustomTokens = { solana: [], ethereum: [] };
  if (chain === 'solana') newData.solana = [...cleaned];
  else newData.ethereum = [...cleaned];

  try {
    const sha = await getSha('/custom-tokens.json');
    let existing: CustomTokens = defaultTokens();
    if (sha) {
      const fileRes = await fetch(`${BASE_API}/contents/custom-tokens.json?ref=main`, { headers });
      if (fileRes.ok) {
        const data = await fileRes.json();
        try { existing = JSON.parse(atob(data.content)); } catch { existing = defaultTokens(); }
      }
    }
    existing[chain] = [...new Set([...existing[chain], ...cleaned])];
    const json = JSON.stringify(existing, null, 2);
    if (sha) await putFile('/custom-tokens.json', json, sha);
    else await createFile('/custom-tokens.json', json);
    return NextResponse.json({ ok: true, customTokens: existing });
  } catch (err: any) {
    console.error('Custom tokens error:', err);
    return NextResponse.json({ error: err.message || 'Failed to persist custom tokens' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sha = await getSha('/custom-tokens.json');
    if (!sha) return NextResponse.json(defaultTokens());
    const res = await fetch(`${BASE_API}/contents/custom-tokens.json?ref=main`, { headers });
    if (!res.ok) return NextResponse.json(defaultTokens());
    const data = await res.json();
    let parsed: CustomTokens = defaultTokens();
    try { parsed = JSON.parse(atob(data.content)); } catch { parsed = defaultTokens(); }
    if (!parsed.solana) parsed.solana = [];
    if (!parsed.ethereum) parsed.ethereum = [];
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(defaultTokens());
  }
}
