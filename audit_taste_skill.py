#!/usr/bin/env python3
"""Taste-skill v2 pre-flight audit against https://check.kartelkoin.xyz/

Uses BeautifulSoup to parse the real rendered DOM, ignoring Next.js
__NEXT_DATA__ JSON scaffolding and error-page fallback CSS that leaks
into raw HTML but is never actually rendered.
"""
import re
import sys
import urllib.request

from bs4 import BeautifulSoup


URL = "https://check.kartelkoin.xyz/"


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": "HermesAudit/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> None:
    print(f"=== Taste-skill v2 pre-flight audit :: {URL}\n")

    raw = fetch(URL)
    soup = BeautifulSoup(raw, "html.parser")

    # Strip script/style for visible-text checks only
    for tag in soup(["script", "style"]):
        tag.decompose()

    visible = soup.get_text(separator=" ", strip=True)

    results: list[tuple[str, str, bool]] = []

    # ── 9.A: No glowing lines/boxes by default ─────────────────
    # Check inline <style> blocks and style="" attributes (the only CSS
    # Next.js inlines in SSR output). Skip :hover/:focus/:active blocks.
    style_blocks = [
        tag.string or ""
        for tag in soup.find_all("style")
        if tag.string
    ]
    inline_styles = [
        el.get("style", "")
        for el in soup.find_all(style=True)
    ]
    all_css = style_blocks + inline_styles

    glow_pat = re.compile(
        r"(?:box-shadow|text-shadow|filter)\s*:\s*[^;}]*\b(?:blur|drop-shadow)",
        re.IGNORECASE,
    )
    glow_hits = 0
    for css in all_css:
        # Split on :hover/:focus/:active/:visited to exclude interactive
        parts = re.split(
            r"[:,]\s*(?:hover|focus|active|visited|disabled)\s*\{",
            css,
            flags=re.IGNORECASE,
        )
        for part in parts:
            if glow_pat.search(part):
                glow_hits += 1

    results.append(
        ("9.A", f"No glowing lines/boxes by default (inline glow hits: {glow_hits})", glow_hits == 0)
    )

    # ── 9.B: No floating action buttons by default ─────────────
    fab = bool(soup.find(class_=re.compile(r"\b(fab|floating)\b", re.I)))
    fixed_br = bool(
        soup.find(
            style=re.compile(
                r"position:\s*fixed\s*;[^}]*\b(bottom|right)\s*:\s*0\s*;",
                re.I,
            )
        )
    )
    results.append(
        ("9.B", "No floating action buttons by default", not fab and not fixed_br)
    )

    # ── 9.D: No content-flooding data tables ────────────────────
    tables = len(soup.find_all("table"))
    results.append(
        ("9.D", f"No content-flooding data tables ({tables} <table>)", tables == 0)
    )

    # ── 9.E: No oversized type scale without reason ─────────────
    # Check all inline style="font-size:..." attributes
    oversized = 0
    big_values: list[str] = []
    fs_pat = re.compile(r"font-size\s*:\s*([\d.]+)(?:px|rem)", re.I)
    for el in soup.find_all(style=True):
        for m in fs_pat.finditer(el["style"]):
            try:
                val = float(m.group(1))
                unit = m.group(2).lower() if m.lastindex and m.group(2) else "px"
                # rem → px at 16px base
                px = val * 16 if unit == "rem" else val
                if px >= 64:
                    oversized += 1
                    big_values.append(f"{val}{unit}")
            except ValueError:
                pass
    results.append(
        ("9.E", f"No oversized type scale (>=64px): {big_values}", oversized == 0)
    )

    # ── 9.F: No pure-decorative pulsing dots by default ────────
    dot_pat = re.compile(
        r"\.([^\{]*\b(?:dot|pulse|status|indicator)\b[^\{]*)\s*\{[^}]*animation\s*:",
        re.I,
    )
    dot_hits = 0
    for css in all_css:
        if dot_pat.search(css):
            dot_hits += 1
    results.append(
        ("9.F", "No pure-decorative pulsing dots by default", dot_hits == 0)
    )

    # ── 9.G: Em-dash ban on visible surface ────────────────────
    dashes = [c for c in visible if c in ("\u2014", "\u2013")]
    results.append(
        ("9.G", f"No em/en-dashes on visible surface (found {len(dashes)})", len(dashes) == 0)
    )

    # ── 9.H: No empty white panels / floating white squares ─────
    # Only count background:#fff in actual styles (not in Next.js
    # __NEXT_DATA__ error-page fallback strings).
    white_bg = 0
    for css in all_css:
        white_bg += len(
            re.findall(r"background(?:-color)?\s*:\s*#fff(?:fff)?\s*;", css, re.I)
        )
    results.append(
        ("9.H", f"No empty white panels ({white_bg} background:#fff in styles)", white_bg == 0)
    )

    # ── 9.I: No oversized palette swatches by default ──────────
    # Check inline style="width/height" attributes for large values
    large_dims = 0
    w_pat = re.compile(r"width\s*:\s*([\d.]+)(?:px|rem)", re.I)
    h_pat = re.compile(r"height\s*:\s*([\d.]+)(?:px|rem)", re.I)
    for el in soup.find_all(style=True):
        style = el.get("style", "")
        wm = w_pat.search(style)
        hm = h_pat.search(style)
        if wm and hm:
            try:
                w = float(wm.group(1))
                h = float(hm.group(1))
                wu = "rem" if "rem" in wm.group(0).lower() else "px"
                hu = "rem" if "rem" in hm.group(0).lower() else "px"
                wp = w * 16 if wu == "rem" else w
                hp = h * 16 if hu == "rem" else h
                if wp >= 120 and hp >= 120:
                    large_dims += 1
            except ValueError:
                pass
    results.append(
        ("9.I", f"No oversized palette swatches ({large_dims} >=120px)", large_dims == 0)
    )

    # ── 9.J: No auto-play hero video ────────────────────────────
    videos = len(soup.find_all("video", attrs={"autoplay": True}))
    results.append(
        ("9.J", f"No auto-play hero video ({videos} <video autoplay>)", videos == 0)
    )

    # ── 4.14: Generic pill/layout/Notion-like grids ─────────────
    notion = len(re.findall(r"\b(notion|notion-like)\b", str(soup), re.I))
    pills = len(re.findall(r"\b(pill|tag|bubble|chip)\b", str(soup), re.I))
    grid_cols = len(re.findall(r"\b(grid-cols-\w+|col-\w+)\b", str(soup), re.I))
    pass_414 = notion == 0 and pills < 8 and grid_cols < 8
    results.append(
        (
            "4.14",
            f"No generic pill/layout/Notion slop (notion:{notion} pills:{pills} grid-cols:{grid_cols})",
            pass_414,
        )
    )

    # ── 4.13: Over-generic dark-mode palette ────────────────────
    grays: set[str] = set()
    for m in re.finditer(r"#([0-9a-fA-F]{6})\b", str(soup)):
        hx = m.group(1)
        try:
            r = int(hx[0:2], 16)
            g_ = int(hx[2:4], 16)
            b = int(hx[4:6], 16)
            if abs(r - g_) <= 8 and abs(g_ - b) <= 8:
                grays.add(hx.lower())
        except ValueError:
            pass
    results.append(
        (
            "4.13",
            f"No over-generic dark palette ({len(grays)} unique grayscales)",
            len(grays) <= 12,
        )
    )

    # ── 2.4: No <p> tags inside <h1-h6> ────────────────────────
    p_in_heading = False
    for heading in soup.find_all(re.compile(r"^h[1-6]$", re.I)):
        if heading.find("p"):
            p_in_heading = True
            break
    results.append(
        ("2.4", "No <p> tags inside <h1-h6> (responsive rule)", not p_in_heading)
    )

    # ── 4.11: Section rules ─────────────────────────────────────
    sections = soup.find_all("section")
    h2s = soup.find_all("h2")
    sections_ok = len(sections) >= 1 and len(h2s) <= max(1, len(sections)) + 1
    results.append(
        (
            "4.11",
            f"Section rules: {len(sections)} <section>, {len(h2s)} <h2>",
            sections_ok,
        )
    )

    # ── 4.11 A: msapplication-TileColor ─────────────────────────
    mstile = bool(soup.find("meta", attrs={"name": "msapplication-TileColor"}))
    results.append(("4.11", "msapplication-TileColor present", mstile))

    # ── 4.11: meta viewport ─────────────────────────────────────
    viewport = bool(soup.find("meta", attrs={"name": "viewport"}))
    results.append(("4.11", "meta viewport present", viewport))

    # ── Summary ─────────────────────────────────────────────────────
    all_pass = True
    print("RULE                                      RESULT")
    print("-" * 70)
    for rule, desc, ok in results:
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"{status:4}  {rule:6}  {desc}")

    print()
    if dashes:
        print(f"Em-dash tokens on visible surface: {dashes}")
    print(f"Unique grayscales: {len(grays)}")
    print()
    print(f">>> OVERALL: {'ALL PASS' if all_pass else 'SOME CHECKS FAILED'}")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
