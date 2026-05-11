#!/usr/bin/env python3
"""
Clarivise Documentation PDF Generator — Enhanced Edition

Converts markdown documentation to professional, branded PDFs with:
- Custom Clarivise branding and logo
- Color-coded headers per product
- Professional typography and spacing
- Cover pages with artwork
- Table of contents
- Page numbers and headers/footers

Usage:
    python generate_docs_enhanced.py                    # Generate all PDFs
    python generate_docs_enhanced.py --document scan    # Generate only Scan
"""

import os
import sys
import argparse
import re
from pathlib import Path
from datetime import datetime

try:
    import markdown2
    import pdfkit
except ImportError as e:
    print(f"Error: {e}")
    print("Install with: pip install markdown2 pdfkit")
    sys.exit(1)


class ClarivisePDFGeneratorEnhanced:
    """Generate professional Clarivise PDFs with branding."""

    DOCUMENTS = {
        "scan": {
            "title": "Clarivise Scan",
            "subtitle": "Quick Start Guide",
            "source": "docs/scan-quickstart.md",
            "output": "docs/pdf/Clarivise_Scan_QuickStart.pdf",
            "color": "#4f46e5",
            "accent": "#6366f1",
            "icon": "📧",
            "description": "Install the Chrome extension, configure your connection, and start analyzing suspicious emails in Outlook on the web.",
        },
        "shield-hosted": {
            "title": "Clarivise Shield",
            "subtitle": "Hosted Deployment Guide",
            "source": "docs/shield-hosted.md",
            "output": "docs/pdf/Clarivise_Shield_Hosted.pdf",
            "color": "#2E75B6",
            "accent": "#3b82f6",
            "icon": "🛡️",
            "description": "Set up automatic email security on Clarivise servers. Simple mail flow rule in Microsoft 365.",
        },
        "shield-azure": {
            "title": "Clarivise Shield",
            "subtitle": "Self-Hosted Azure Deployment",
            "source": "docs/shield-azure.md",
            "output": "docs/pdf/Clarivise_Shield_SelfHosted_Azure.pdf",
            "color": "#2E75B6",
            "accent": "#3b82f6",
            "icon": "☁️",
            "description": "Deploy Shield in your own Azure environment with full control and compliance flexibility.",
        },
        "faq": {
            "title": "Clarivise",
            "subtitle": "Frequently Asked Questions",
            "source": "docs/faq.md",
            "output": "docs/pdf/Clarivise_FAQ.pdf",
            "color": "#0f172a",
            "accent": "#334155",
            "icon": "❓",
            "description": "Comprehensive answers to questions about features, pricing, privacy, deployment, and support.",
        },
    }

    def __init__(self, base_path=None):
        """Initialize the generator."""
        self.base_path = Path(base_path or ".")
        self.output_dir = self.base_path / "docs" / "pdf"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def read_markdown(self, doc_key):
        """Read markdown file."""
        source = self.base_path / self.DOCUMENTS[doc_key]["source"]
        if not source.exists():
            raise FileNotFoundError(f"Source not found: {source}")
        with open(source, "r", encoding="utf-8") as f:
            return f.read()

    def generate_toc(self, html_content):
        """Extract headings for table of contents."""
        # Find all h2 headers (main sections)
        h2_pattern = r'<h2[^>]*>([^<]+)</h2>'
        headings = re.findall(h2_pattern, html_content)
        
        if not headings:
            return ""
        
        toc_items = "\n".join(
            f'<li><a href="#{i+1}">{h.strip()}</a></li>'
            for i, h in enumerate(headings)
        )
        
        return f"""
        <div class="toc">
            <h2>Contents</h2>
            <ul>
                {toc_items}
            </ul>
        </div>
        """

    def markdown_to_html(self, markdown_text, doc_key):
        """Convert markdown to branded HTML."""
        # Convert markdown to HTML
        html_content = markdown2.markdown(
            markdown_text,
            extras=["tables", "code-friendly", "fenced-code-blocks", "toc"],
        )

        # Get branding
        doc = self.DOCUMENTS[doc_key]
        color = doc["color"]
        accent = doc["accent"]
        title = f"{doc['title']} — {doc['subtitle']}"
        icon = doc["icon"]
        generation_date = datetime.now().strftime("%B %d, %Y")

        # Generate TOC
        toc = self.generate_toc(html_content)

        # Full HTML with branding
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        @page {{
            size: A4;
            margin: 1in 0.75in;
            @bottom-center {{
                content: "Page " counter(page) " of " counter(pages);
                font-size: 10px;
                color: #94a3b8;
            }}
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.65;
            color: #1e293b;
            background: white;
            padding: 0;
        }}

        /* Cover Page */
        .cover {{
            background: linear-gradient(135deg, {color} 0%, {accent} 100%);
            color: white;
            padding: 100px 60px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            page-break-after: always;
            position: relative;
            overflow: hidden;
        }}

        .cover::before {{
            content: '';
            position: absolute;
            top: -50%;
            right: -10%;
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, rgba(255,255,255,.1) 0%, transparent 70%);
            border-radius: 50%;
        }}

        .cover::after {{
            content: '';
            position: absolute;
            bottom: -30%;
            left: -5%;
            width: 500px;
            height: 500px;
            background: radial-gradient(circle, rgba(255,255,255,.05) 0%, transparent 70%);
            border-radius: 50%;
        }}

        .cover-content {{
            position: relative;
            z-index: 2;
        }}

        .cover-badge {{
            display: inline-block;
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-bottom: 30px;
        }}

        .cover-icon {{
            font-size: 64px;
            margin-bottom: 20px;
            opacity: 0.9;
        }}

        .cover-brand {{
            font-size: 16px;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            opacity: 0.95;
            margin-bottom: 15px;
        }}

        .cover-title {{
            font-size: 48px;
            font-weight: 800;
            line-height: 1.2;
            margin-bottom: 20px;
            letter-spacing: -0.02em;
        }}

        .cover-description {{
            font-size: 18px;
            line-height: 1.6;
            opacity: 0.95;
            max-width: 500px;
            margin-bottom: 60px;
        }}

        .cover-meta {{
            font-size: 13px;
            opacity: 0.85;
            margin-top: 80px;
        }}

        .cover-meta p {{
            margin: 5px 0;
        }}

        /* Main Content */
        .content {{
            padding: 60px 60px;
            max-width: 900px;
            margin: 0 auto;
        }}

        /* Table of Contents */
        .toc {{
            background: #f8fafc;
            border-left: 4px solid {color};
            padding: 30px;
            margin: 40px 0;
            border-radius: 8px;
            page-break-inside: avoid;
        }}

        .toc h2 {{
            font-size: 18px;
            color: {color};
            margin: 0 0 20px 0;
        }}

        .toc ul {{
            list-style: none;
            padding: 0;
            margin: 0;
        }}

        .toc li {{
            margin: 8px 0;
            padding: 0;
        }}

        .toc a {{
            color: #0f172a;
            text-decoration: none;
            font-size: 14px;
            transition: color 0.2s;
        }}

        .toc a:hover {{
            color: {color};
        }}

        /* Headings */
        h1 {{
            font-size: 32px;
            font-weight: 800;
            color: {color};
            margin: 50px 0 25px 0;
            padding-bottom: 15px;
            border-bottom: 2px solid {color};
            page-break-after: avoid;
            letter-spacing: -0.02em;
        }}

        h2 {{
            font-size: 24px;
            font-weight: 700;
            color: #0f172a;
            margin: 40px 0 20px 0;
            padding-bottom: 10px;
            border-bottom: 2px solid {color};
            page-break-after: avoid;
        }}

        h3 {{
            font-size: 18px;
            font-weight: 600;
            color: #0f172a;
            margin: 30px 0 15px 0;
            page-break-after: avoid;
        }}

        h4 {{
            font-size: 14px;
            font-weight: 600;
            color: #334155;
            margin: 20px 0 10px 0;
        }}

        /* Paragraphs */
        p {{
            margin-bottom: 15px;
            text-align: justify;
        }}

        p strong {{
            color: #0f172a;
            font-weight: 600;
        }}

        /* Lists */
        ul, ol {{
            margin-left: 30px;
            margin-bottom: 15px;
        }}

        ul li, ol li {{
            margin-bottom: 10px;
            color: #334155;
            line-height: 1.6;
        }}

        ul li::marker {{
            color: {color};
            font-weight: bold;
        }}

        /* Tables */
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 25px 0;
            font-size: 13px;
            page-break-inside: avoid;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
            border-radius: 8px;
            overflow: hidden;
        }}

        thead {{
            background: linear-gradient(135deg, {color} 0%, {accent} 100%);
            color: white;
        }}

        th {{
            padding: 14px;
            text-align: left;
            font-weight: 600;
            letter-spacing: 0.02em;
        }}

        td {{
            padding: 12px 14px;
            border-bottom: 1px solid #e2e8f0;
            color: #475569;
        }}

        tr:last-child td {{
            border-bottom: none;
        }}

        tr:nth-child(even) {{
            background-color: #f8fafc;
        }}

        /* Code */
        pre {{
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            color: #e2e8f0;
            padding: 20px;
            border-left: 4px solid {color};
            overflow-x: auto;
            margin: 20px 0;
            font-size: 12px;
            line-height: 1.6;
            page-break-inside: avoid;
            border-radius: 6px;
        }}

        code {{
            font-family: 'Courier New', 'Courier', monospace;
        }}

        p code {{
            background: #f1f5f9;
            color: {color};
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
        }}

        /* Blockquotes */
        blockquote {{
            border-left: 4px solid {color};
            padding-left: 20px;
            margin: 20px 0;
            color: #64748b;
            font-style: italic;
            font-size: 15px;
        }}

        /* Horizontal Rule */
        hr {{
            border: none;
            border-top: 2px solid {color};
            margin: 40px 0;
            opacity: 0.3;
        }}

        /* Links */
        a {{
            color: {color};
            text-decoration: none;
            transition: all 0.2s;
        }}

        a:hover {{
            text-decoration: underline;
            opacity: 0.8;
        }}

        /* Callout Boxes */
        .note, .warning, .info {{
            padding: 20px;
            margin: 25px 0;
            border-radius: 8px;
            page-break-inside: avoid;
            border-left: 4px solid;
        }}

        .note {{
            background: #eef2ff;
            border-left-color: {color};
            color: #312e81;
        }}

        .warning {{
            background: #fef3c7;
            border-left-color: #f59e0b;
            color: #78350f;
        }}

        .info {{
            background: #dbeafe;
            border-left-color: {color};
            color: #1e40af;
        }}

        /* Footer */
        .footer {{
            margin-top: 80px;
            padding-top: 30px;
            border-top: 2px solid #e2e8f0;
            font-size: 11px;
            color: #94a3b8;
            text-align: center;
            page-break-inside: avoid;
        }}

        .footer p {{
            margin: 5px 0;
        }}

        /* Page Break */
        .page-break {{
            page-break-after: always;
        }}

        /* Responsive */
        @media print {{
            body {{
                padding: 0;
            }}
            .content {{
                padding: 40px;
            }}
            h1, h2, h3 {{
                page-break-after: avoid;
            }}
            table, pre {{
                page-break-inside: avoid;
            }}
        }}
    </style>
</head>
<body>
    <!-- Cover Page -->
    <div class="cover">
        <div class="cover-content">
            <div class="cover-badge">{doc['icon']} Clarivise</div>
            <div class="cover-icon">{doc['icon']}</div>
            <div class="cover-brand">Clarivise</div>
            <div class="cover-title">{doc['subtitle']}</div>
            <div class="cover-description">{doc['description']}</div>
            <div class="cover-meta">
                <p><strong>Generated:</strong> {generation_date}</p>
                <p><strong>Version:</strong> 1.0</p>
                <p><strong>Publisher:</strong> Ingot Solutions</p>
            </div>
        </div>
    </div>

    <!-- Main Content -->
    <div class="content">
        {toc}
        {html_content}

        <!-- Footer -->
        <div class="footer">
            <p>© 2026 Ingot Solutions. All rights reserved.</p>
            <p>Clarivise — AI-powered email security for Microsoft 365</p>
            <p>Generated {generation_date} | v1.0</p>
        </div>
    </div>
</body>
</html>
"""
        return html

    def generate_pdf(self, doc_key):
        """Generate PDF for a document."""
        try:
            doc = self.DOCUMENTS[doc_key]
            print(f"{doc['icon']} Generating {doc['title']}...", end=" ", flush=True)

            # Read markdown
            markdown_text = self.read_markdown(doc_key)

            # Convert to HTML
            html = self.markdown_to_html(markdown_text, doc_key)

            # Save intermediate HTML
            html_path = self.output_dir / f"{doc_key}_temp.html"
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html)

            # Output path
            output_path = self.base_path / doc["output"]
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Generate PDF with wkhtmltopdf
            options = {
                "page-size": "A4",
                "margin-top": "0.75in",
                "margin-right": "0.75in",
                "margin-bottom": "0.75in",
                "margin-left": "0.75in",
                "encoding": "UTF-8",
                "no-outline": None,
                "enable-local-file-access": None,
                "print-media-type": None,
            }

            try:
                pdfkit.from_file(str(html_path), str(output_path), options=options)
                size_mb = output_path.stat().st_size / (1024 * 1024)
                print(f"✅ Done ({size_mb:.1f} MB)")
                return True
            except Exception as e:
                print(f"❌ PDF generation failed: {e}")
                print(f"   Saved HTML to {html_path} for inspection")
                return False

        except Exception as e:
            print(f"❌ Error: {e}")
            return False

    def generate_all(self):
        """Generate all PDFs."""
        print("\n" + "="*70)
        print("🛡️  CLARIVISE DOCUMENTATION PDF GENERATOR — ENHANCED")
        print("="*70)
        print(f"\nOutput: {self.output_dir}\n")

        results = {}
        for doc_key in sorted(self.DOCUMENTS.keys()):
            results[doc_key] = self.generate_pdf(doc_key)

        # Summary
        print(f"\n{'='*70}")
        successful = sum(1 for v in results.values() if v)
        print(f"✨ Generated {successful}/{len(results)} professional PDFs")
        print(f"{'='*70}\n")

        if successful == len(results):
            print("🎉 All documentation ready for distribution!\n")
            for doc_key, doc in self.DOCUMENTS.items():
                output = self.base_path / doc["output"]
                if output.exists():
                    size = output.stat().st_size / (1024 * 1024)
                    print(f"  📄 {doc['title']} ({size:.1f} MB)")
        else:
            print("⚠️  Some PDFs failed. Check errors above.\n")

        return all(results.values())


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Generate professional Clarivise documentation PDFs"
    )
    parser.add_argument(
        "--document",
        choices=["scan", "shield-hosted", "shield-azure", "faq"],
        help="Generate only a specific document",
    )
    parser.add_argument("--base-path", default=".", help="Base path for repo")

    args = parser.parse_args()

    generator = ClarivisePDFGeneratorEnhanced(args.base_path)

    if args.document:
        generator.generate_pdf(args.document)
    else:
        generator.generate_all()


if __name__ == "__main__":
    main()
