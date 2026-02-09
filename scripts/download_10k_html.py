#!/usr/bin/env python3
"""
Download SEC EDGAR 10-K filings as HTML by ticker and optionally render them
to PDF from the original HTML.

Usage:
  python scripts/download_10k_html.py --year 2024 --tickers MSFT AAPL --convert-pdf

Notes:
  - SEC requires a descriptive User-Agent with contact info.
  - Set SEC_USER_AGENT env var or pass --user-agent.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SEC_TICKER_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data"

DEFAULT_TICKERS = ["MSFT", "AAPL", "TSLA", "JPM", "PFE", "WMT", "XOM", "BA"]
PDF_RENDERERS = ("auto", "playwright", "wkhtmltopdf", "reportlab_text")


@dataclass
class FilingMetadata:
    ticker: str
    cik: str
    accession_number: str
    filing_date: str
    report_date: str
    form: str
    primary_document: str
    html_url: str
    html_path: str
    pdf_path: str | None
    pdf_renderer: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download EDGAR 10-K filings as HTML and optionally convert to PDF."
    )
    parser.add_argument("--year", type=int, default=2024, help="Target filing year (default: 2024).")
    parser.add_argument(
        "--tickers",
        nargs="+",
        default=DEFAULT_TICKERS,
        help=f"Ticker symbols (default: {' '.join(DEFAULT_TICKERS)}).",
    )
    parser.add_argument(
        "--forms",
        nargs="+",
        default=["10-K"],
        help="SEC forms to include (default: 10-K). Example: 10-K 10-K/A",
    )
    parser.add_argument(
        "--output-html-dir",
        default="data/10k_html",
        help="Directory to write downloaded HTML files.",
    )
    parser.add_argument(
        "--output-pdf-dir",
        default="data/10k_pdfs",
        help="Directory to write generated PDF files.",
    )
    parser.add_argument(
        "--metadata-path",
        default="data/metadata/edgar_10k_manifest.json",
        help="Manifest JSON output path.",
    )
    parser.add_argument(
        "--user-agent",
        default=os.getenv("SEC_USER_AGENT", "").strip(),
        help="SEC User-Agent header. Falls back to SEC_USER_AGENT env var.",
    )
    parser.add_argument(
        "--convert-pdf",
        action="store_true",
        help="Render downloaded HTML into PDF files.",
    )
    parser.add_argument(
        "--pdf-renderer",
        choices=PDF_RENDERERS,
        default="auto",
        help="PDF renderer: auto (default), playwright, wkhtmltopdf, reportlab_text.",
    )
    parser.add_argument(
        "--allow-plain-text-pdf-fallback",
        action="store_true",
        help="Allow fallback to plain text PDF (reportlab_text) when renderer fails.",
    )
    parser.add_argument(
        "--pdf-page-size",
        default="A4",
        help="Page size for Playwright PDF generation (default: A4).",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=0.3,
        help="Delay between SEC requests to be polite (default: 0.3).",
    )
    parser.add_argument(
        "--allow-latest-if-missing-year",
        action="store_true",
        help="If no filing is found for --year, use the latest matching form instead.",
    )
    parser.add_argument(
        "--insecure-skip-tls-verify",
        action="store_true",
        help="Skip TLS certificate verification (only for local/dev troubleshooting).",
    )
    return parser.parse_args()


def build_ssl_context(insecure_skip_tls_verify: bool) -> ssl.SSLContext | None:
    if insecure_skip_tls_verify:
        return ssl._create_unverified_context()  # noqa: SLF001

    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return None


def fetch_json(url: str, user_agent: str, ssl_context: ssl.SSLContext | None) -> dict[str, Any]:
    req = Request(url, headers={"User-Agent": user_agent, "Accept": "application/json"})
    with urlopen(req, timeout=30, context=ssl_context) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str, user_agent: str, ssl_context: ssl.SSLContext | None) -> str:
    req = Request(url, headers={"User-Agent": user_agent, "Accept": "text/html,*/*"})
    with urlopen(req, timeout=60, context=ssl_context) as response:
        return response.read().decode("utf-8", errors="ignore")


def load_ticker_map(user_agent: str, ssl_context: ssl.SSLContext | None) -> dict[str, str]:
    payload = fetch_json(SEC_TICKER_URL, user_agent, ssl_context)
    mapping: dict[str, str] = {}
    for _, row in payload.items():
        ticker = str(row["ticker"]).upper()
        cik = str(row["cik_str"]).zfill(10)
        mapping[ticker] = cik
    return mapping


def find_latest_filing(
    submissions: dict[str, Any],
    year: int,
    forms: set[str],
    allow_latest_if_missing_year: bool,
) -> dict[str, str] | None:
    recent = submissions.get("filings", {}).get("recent", {})
    form_list = recent.get("form", [])
    filing_dates = recent.get("filingDate", [])
    report_dates = recent.get("reportDate", [])
    accession_numbers = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])

    for idx, form in enumerate(form_list):
        if form not in forms:
            continue
        filing_date = filing_dates[idx] if idx < len(filing_dates) else ""
        filing_year = int(filing_date[:4]) if filing_date else -1
        if filing_year != year:
            continue

        accession_number = accession_numbers[idx] if idx < len(accession_numbers) else ""
        primary_document = primary_docs[idx] if idx < len(primary_docs) else ""
        report_date = report_dates[idx] if idx < len(report_dates) else ""
        if not accession_number or not primary_document:
            continue

        return {
            "form": form,
            "filing_date": filing_date,
            "report_date": report_date,
            "accession_number": accession_number,
            "primary_document": primary_document,
            "is_year_fallback": "false",
        }
    if not allow_latest_if_missing_year:
        return None

    for idx, form in enumerate(form_list):
        if form not in forms:
            continue
        filing_date = filing_dates[idx] if idx < len(filing_dates) else ""
        accession_number = accession_numbers[idx] if idx < len(accession_numbers) else ""
        primary_document = primary_docs[idx] if idx < len(primary_docs) else ""
        report_date = report_dates[idx] if idx < len(report_dates) else ""
        if not accession_number or not primary_document:
            continue
        return {
            "form": form,
            "filing_date": filing_date,
            "report_date": report_date,
            "accession_number": accession_number,
            "primary_document": primary_document,
            "is_year_fallback": "true",
        }
    return None


def filing_html_url(cik: str, accession_number: str, primary_document: str) -> str:
    cik_no_zero = str(int(cik))
    accession_no_dashes = accession_number.replace("-", "")
    return f"{SEC_ARCHIVES_BASE}/{cik_no_zero}/{accession_no_dashes}/{primary_document}"


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)


def html_to_plain_text(html: str) -> str:
    stripped = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    stripped = re.sub(r"(?s)<[^>]+>", " ", stripped)
    stripped = unescape(stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    return stripped


def write_simple_pdf_from_text(text: str, output_path: Path) -> None:
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "reportlab is required for --convert-pdf. Install with: pip install reportlab"
        ) from exc

    c = canvas.Canvas(str(output_path), pagesize=letter)
    width, height = letter
    x = 54
    y = height - 54
    line_height = 14
    max_width_chars = 95

    for paragraph in text.split(". "):
        wrapped = textwrap.wrap(paragraph.strip(), width=max_width_chars)
        if not wrapped:
            continue
        for line in wrapped:
            if y <= 54:
                c.showPage()
                y = height - 54
            c.drawString(x, y, line)
            y -= line_height
        y -= line_height // 2

    c.save()


def resolve_pdf_renderers(
    requested: str,
    allow_plain_text_pdf_fallback: bool,
    warnings: list[str],
) -> list[str]:
    if requested != "auto":
        return [requested]

    renderers: list[str] = []
    try:
        import playwright.sync_api  # type: ignore  # noqa: F401

        renderers.append("playwright")
    except ImportError:
        pass

    if shutil.which("wkhtmltopdf"):
        renderers.append("wkhtmltopdf")

    if allow_plain_text_pdf_fallback:
        renderers.append("reportlab_text")

    if not renderers:
        warnings.append(
            "No PDF renderer found. Install Playwright (`pip install playwright` then "
            "`playwright install chromium`) or install wkhtmltopdf."
        )
    return renderers


def render_with_playwright(html_path: Path, output_pdf_path: Path, page_size: str) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is not installed. Install: pip install playwright") from exc

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(html_path.resolve().as_uri(), wait_until="networkidle")
            page.emulate_media(media="screen")
            page.pdf(path=str(output_pdf_path), format=page_size.upper(), print_background=True)
            browser.close()
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Playwright render failed. Ensure browser binaries exist: playwright install chromium"
        ) from exc


def render_with_wkhtmltopdf(html_path: Path, output_pdf_path: Path) -> None:
    binary = shutil.which("wkhtmltopdf")
    if not binary:
        raise RuntimeError("wkhtmltopdf binary not found in PATH")

    command = [
        binary,
        "--quiet",
        "--enable-local-file-access",
        str(html_path.resolve()),
        str(output_pdf_path.resolve()),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:  # pragma: no cover
        stderr = (exc.stderr or "").strip()
        raise RuntimeError(f"wkhtmltopdf failed: {stderr}") from exc


def render_html_to_pdf(
    renderer: str,
    html_content: str,
    html_path: Path,
    output_pdf_path: Path,
    page_size: str,
) -> None:
    if renderer == "playwright":
        render_with_playwright(html_path, output_pdf_path, page_size)
        return
    if renderer == "wkhtmltopdf":
        render_with_wkhtmltopdf(html_path, output_pdf_path)
        return
    if renderer == "reportlab_text":
        plain_text = html_to_plain_text(html_content)
        write_simple_pdf_from_text(plain_text, output_pdf_path)
        return
    raise RuntimeError(f"Unknown renderer: {renderer}")


def ensure_user_agent(user_agent: str) -> str:
    if user_agent:
        return user_agent
    raise ValueError(
        "Missing SEC User-Agent. Pass --user-agent \"Your Name your@email.com\" "
        "or set SEC_USER_AGENT env var."
    )


def main() -> int:
    args = parse_args()
    user_agent = ensure_user_agent(args.user_agent)

    html_dir = Path(args.output_html_dir)
    pdf_dir = Path(args.output_pdf_dir)
    metadata_path = Path(args.metadata_path)

    html_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    forms = {item.upper() for item in args.forms}
    tickers = [ticker.upper() for ticker in args.tickers]
    ssl_context = build_ssl_context(args.insecure_skip_tls_verify)

    print(f"Loading SEC ticker map for {len(tickers)} tickers...")
    ticker_to_cik = load_ticker_map(user_agent, ssl_context)

    manifest: list[FilingMetadata] = []
    failures: list[str] = []
    warnings: list[str] = []

    pdf_renderers: list[str] = []
    if args.convert_pdf:
        pdf_renderers = resolve_pdf_renderers(
            requested=args.pdf_renderer,
            allow_plain_text_pdf_fallback=args.allow_plain_text_pdf_fallback,
            warnings=warnings,
        )

    for ticker in tickers:
        cik = ticker_to_cik.get(ticker)
        if not cik:
            failures.append(f"{ticker}: ticker not found in SEC company_tickers.json")
            continue

        submissions_url = SEC_SUBMISSIONS_URL.format(cik=cik)
        try:
            submissions = fetch_json(submissions_url, user_agent, ssl_context)
            filing = find_latest_filing(
                submissions,
                args.year,
                forms,
                args.allow_latest_if_missing_year,
            )
            if not filing:
                failures.append(f"{ticker}: no {sorted(forms)} filing found for {args.year}")
                continue

            html_url = filing_html_url(cik, filing["accession_number"], filing["primary_document"])
            html_content = fetch_text(html_url, user_agent, ssl_context)

            base_name = sanitize_filename(
                f"{ticker}_{filing['form']}_{filing['filing_date']}_{filing['accession_number']}"
            )
            html_path = html_dir / f"{base_name}.html"
            html_path.write_text(html_content, encoding="utf-8")

            pdf_path_str: str | None = None
            pdf_renderer_used: str | None = None
            if args.convert_pdf:
                if not pdf_renderers:
                    raise RuntimeError("PDF conversion requested but no renderer is available")
                pdf_path = pdf_dir / f"{base_name}.pdf"
                render_attempts: list[str] = []
                for renderer in pdf_renderers:
                    try:
                        render_html_to_pdf(
                            renderer=renderer,
                            html_content=html_content,
                            html_path=html_path,
                            output_pdf_path=pdf_path,
                            page_size=args.pdf_page_size,
                        )
                        pdf_path_str = str(pdf_path)
                        pdf_renderer_used = renderer
                        break
                    except RuntimeError as exc:
                        render_attempts.append(f"{renderer}: {exc}")

                if not pdf_path_str:
                    raise RuntimeError("; ".join(render_attempts))

            metadata = FilingMetadata(
                ticker=ticker,
                cik=cik,
                accession_number=filing["accession_number"],
                filing_date=filing["filing_date"],
                report_date=filing["report_date"],
                form=filing["form"],
                primary_document=filing["primary_document"],
                html_url=html_url,
                html_path=str(html_path),
                pdf_path=pdf_path_str,
                pdf_renderer=pdf_renderer_used,
            )
            manifest.append(metadata)

            print(
                f"[OK] {ticker} {filing['form']} {filing['filing_date']} -> "
                f"{html_path.name}{f' + PDF({pdf_renderer_used})' if pdf_path_str else ''}"
                f"{' (fallback-year)' if filing['is_year_fallback'] == 'true' else ''}"
            )
            time.sleep(args.sleep_seconds)
        except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as exc:
            failures.append(f"{ticker}: {exc}")

    metadata_path.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "year": args.year,
                "forms": sorted(forms),
                "records": [asdict(row) for row in manifest],
                "failures": failures,
                "warnings": warnings,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nWrote manifest: {metadata_path}")
    print(f"Success: {len(manifest)} | Failures: {len(failures)}")
    if warnings:
        print("Warnings:")
        for item in warnings:
            print(f"  - {item}")
    if failures:
        print("Failures:")
        for item in failures:
            print(f"  - {item}")

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
