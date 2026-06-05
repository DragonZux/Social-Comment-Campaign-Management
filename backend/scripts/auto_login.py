#!/usr/bin/env python3
"""Auto-login helper using Playwright.

Usage examples:
  python backend/scripts/auto_login.py --cookie "sessionid=...; csrftoken=..." --url "https://www.threads.net/@username" 

Notes:
- Requires `playwright` Python package and browser binaries: `pip install -r requirements.txt` then `playwright install`.
"""
import argparse
from urllib.parse import urlparse
from typing import Dict

def parse_cookie_header(cookie_header: str) -> Dict[str, str]:
    pairs = [p.strip() for p in cookie_header.split(";") if p.strip()]
    cookies = {}
    for p in pairs:
        if "=" in p:
            k, v = p.split("=", 1)
            cookies[k.strip()] = v.strip()
    return cookies


def build_playwright_cookies(cookie_map: Dict[str, str], domain: str):
    cookie_list = []
    for name, value in cookie_map.items():
        cookie_list.append({
            "name": name,
            "value": value,
            "domain": domain,
            "path": "/",
            "secure": True,
            "httpOnly": False,
            "sameSite": "None",
        })
    return cookie_list


def main():
    parser = argparse.ArgumentParser(description="Auto-login using Playwright by injecting cookies into a page context.")
    parser.add_argument("--cookie", required=True, help="Cookie header string, e.g. 'k=v; k2=v2'")
    parser.add_argument("--url", required=True, help="Target profile URL to open (e.g. https://www.threads.net/@user)")
    parser.add_argument("--browser", default="chromium", choices=["chromium", "firefox", "webkit"], help="Browser engine")
    parser.add_argument("--headless", action="store_true", help="Run headless")
    parser.add_argument("--screenshot", help="Optional path to save a screenshot after load")
    args = parser.parse_args()

    cookie_map = parse_cookie_header(args.cookie)
    parsed = urlparse(args.url)
    if not parsed.hostname:
        raise SystemExit("Invalid URL provided")

    domain = parsed.hostname

    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        raise SystemExit("Playwright not installed. Run: pip install -r backend/requirements.txt && playwright install")

    cookies = build_playwright_cookies(cookie_map, domain)

    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch(headless=args.headless)
        context = browser.new_context()
        # Set cookies for the domain before navigation
        context.add_cookies(cookies)
        page = context.new_page()
        print(f"Navigating to {args.url} (with {len(cookies)} cookies)")
        page.goto(args.url, wait_until="networkidle")

        if args.screenshot:
            page.screenshot(path=args.screenshot)
            print(f"Saved screenshot to {args.screenshot}")

        if not args.headless:
            print("Browser opened in non-headless mode. Close the browser window to finish the script.")
            try:
                # Keep process alive until user closes browser window
                page.wait_for_close()
            except KeyboardInterrupt:
                pass

        browser.close()


if __name__ == "__main__":
    main()
