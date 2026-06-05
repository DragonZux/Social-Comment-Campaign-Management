import asyncio
import random
import logging
import re
import httpx
import json
from typing import Optional

logger = logging.getLogger("app.social_mock")


class SocialAuthError(RuntimeError):
    """Authentication/session cookie is invalid or expired."""


class SocialCheckpointError(RuntimeError):
    """Account needs manual checkpoint, challenge, or captcha handling."""


def _response_preview(response: httpx.Response, max_len: int = 180) -> str:
    text = response.text.replace("\r", " ").replace("\n", " ").strip()
    return text[:max_len] if text else "(empty body)"


def _raise_for_non_json_response(platform: str, response: httpx.Response) -> None:
    content_type = response.headers.get("content-type", "")
    body_preview = _response_preview(response)
    body_lower = body_preview.lower()
    final_url = str(response.url)

    auth_markers = [
        "login",
        "log in",
        "signin",
        "sign in",
        "dang nhap",
        "accounts/login",
    ]
    checkpoint_markers = [
        "checkpoint",
        "challenge",
        "captcha",
        "suspended",
        "temporarily locked",
    ]

    if any(marker in body_lower or marker in final_url.lower() for marker in checkpoint_markers):
        raise SocialCheckpointError(
            f"Tai khoan {platform} can xac minh thu cong (checkpoint/challenge/captcha). "
            "Hay dang nhap bang trinh duyet va hoan tat xac minh, sau do cap nhat cookie moi."
        )

    looks_like_html = "html" in content_type.lower() or body_preview.startswith("<")
    if looks_like_html or any(marker in body_lower or marker in final_url.lower() for marker in auth_markers):
        raise SocialAuthError(
            f"Cookie {platform} da het han hoac khong hop le. API tra ve trang HTML/login thay vi JSON. "
            "Hay lay lai cookie day du va cap nhat tai khoan."
        )

    raise RuntimeError(
        f"Phan hoi tu {platform} khong phai JSON. Content-Type: {content_type or 'unknown'}. "
        f"Noi dung: {body_preview}"
    )



def parse_cookie_to_dict(cookie_str: str) -> dict:
    if not cookie_str:
        return {}
        
    cookie_str = cookie_str.strip()
    
    # 1. JSON Format
    if cookie_str.startswith(("[", "{")) and cookie_str.endswith(("]", "}")):
        try:
            parsed = json.loads(cookie_str)
            source = parsed.get("cookies") if isinstance(parsed, dict) and isinstance(parsed.get("cookies"), list) else parsed

            if isinstance(source, list):
                return {
                    item["name"]: item["value"]
                    for item in source
                    if isinstance(item, dict) and "name" in item and "value" in item
                }

            if isinstance(source, dict):
                return {
                    str(name): str(value)
                    for name, value in source.items()
                    if isinstance(value, (str, int, float, bool))
                }
        except Exception as e:
            logger.error(f"Failed to parse cookie JSON: {e}")
            
    # 2. Netscape HTTP Cookie File Format
    if "\t" in cookie_str or cookie_str.startswith("#"):
        cookies_dict = {}
        for line in cookie_str.splitlines():
            trimmed = line.strip()
            if not trimmed:
                continue
            if trimmed.startswith("#HttpOnly_"):
                trimmed = trimmed[10:].strip()
            elif trimmed.startswith("#"):
                continue
                
            parts = trimmed.split("\t")
            if len(parts) >= 7:
                name = parts[5].strip()
                value = parts[6].strip()
                cookies_dict[name] = value
            elif len(parts) == 6:
                name = parts[4].strip()
                value = parts[5].strip()
                cookies_dict[name] = value
        if cookies_dict:
            return cookies_dict
            
    # 3. Fallback to key=value; format
    cookies_dict = {}
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" in item:
            k, v = item.split("=", 1)
            cookies_dict[k.strip()] = v.strip()
    return cookies_dict


def shortcode_to_id(shortcode: str) -> int:
    """
    Decodes an Instagram/Threads shortcode into its numeric media ID.
    """
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    media_id = 0
    for char in shortcode:
        media_id = (media_id * 64) + alphabet.index(char)
    return media_id


async def post_to_threads_official(
    access_token: str,
    threads_user_id: str,
    target_url: str,
    comment_content: str,
    proxy: Optional[str] = None,
) -> dict:
    """
    Publishes a Threads reply through Meta's official Threads Graph API.
    Requires a Threads user access token with content publish/reply permissions.
    """
    match = re.search(r"/(?:post|t)/([A-Za-z0-9\-_]+)", target_url)
    if not match:
        raise ValueError(f"Could not parse Threads post shortcode from URL: {target_url}")

    shortcode = match.group(1)
    reply_to_id = str(shortcode_to_id(shortcode))
    proxies = {
        "http://": proxy,
        "https://": proxy
    } if proxy else None

    create_payload = {
        "media_type": "TEXT",
        "text": comment_content,
        "reply_to_id": reply_to_id,
        "access_token": access_token,
    }

    async with httpx.AsyncClient(proxies=proxies, timeout=30.0) as client:
        logger.info(f"Creating official Threads reply container for post {reply_to_id}")
        create_response = await client.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads",
            data=create_payload,
        )

        try:
            create_data = create_response.json()
        except Exception:
            _raise_for_non_json_response("Threads", create_response)

        if create_response.status_code >= 400 or "error" in create_data:
            error = create_data.get("error", create_data)
            raise RuntimeError(f"Threads official API create error: {error}")

        creation_id = create_data.get("id")
        if not creation_id:
            raise RuntimeError(f"Threads official API did not return creation id: {create_data}")

        publish_payload = {
            "creation_id": creation_id,
            "access_token": access_token,
        }
        logger.info(f"Publishing official Threads reply container {creation_id}")
        publish_response = await client.post(
            f"https://graph.threads.net/v1.0/{threads_user_id}/threads_publish",
            data=publish_payload,
        )

    try:
        publish_data = publish_response.json()
    except Exception:
        _raise_for_non_json_response("Threads", publish_response)

    if publish_response.status_code >= 400 or "error" in publish_data:
        error = publish_data.get("error", publish_data)
        raise RuntimeError(f"Threads official API publish error: {error}")

    return {
        "provider": "official_threads_graph_api",
        "reply_to_id": reply_to_id,
        "creation_id": creation_id,
        "publish": publish_data,
    }

async def post_to_x_real(cookie_str: str, target_url: str, comment_content: str, proxy: Optional[str] = None) -> dict:
    """
    Performs a real HTTP POST request to X's CreateTweet GraphQL endpoint.
    """
    match = re.search(r"/status/(\d+)", target_url)
    if not match:
        raise ValueError(f"Could not parse Tweet ID from X URL: {target_url}. Expected format like: https://x.com/username/status/12345")
    tweet_id = match.group(1)

    # Parse cookie string or JSON array into dict
    cookies_dict = parse_cookie_to_dict(cookie_str)

    csrf_token = cookies_dict.get("ct0")
    if not csrf_token:
        raise ValueError("Missing 'ct0' cookie value. X requires CSRF token verification via 'ct0'.")

    headers = {
        "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnAIP4xF4ssbxNqqg4sWWWS4tDD0%3DAJu77Fr21fCD1gJJ1F7732stwSZg185s17nNw55ss",
        "x-csrf-token": csrf_token,
        "content-type": "application/json",
        "cookie": "; ".join([f"{k}={v}" for k, v in cookies_dict.items()]),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        "referer": "https://x.com/"
    }

    payload = {
        "variables": {
            "tweet_text": comment_content,
            "reply": {
                "in_reply_to_tweet_id": tweet_id,
                "exclude_reply_user_ids": []
            },
            "dark_request": False,
            "media": {
                "media_entities": [],
                "possibly_sensitive": False
            },
            "semantic_annotation_ids": []
        },
        "features": {
            "c9s_tweet_anatomy_moderator_badge_enabled": True,
            "tweetypie_unmention_optimization_enabled": True,
            "responsive_web_edit_tweet_api_enabled": True,
            "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
            "view_counts_everywhere_api_enabled": True,
            "longform_notetweets_consumption_enabled": True,
            "responsive_web_twitter_article_tweet_consumption_enabled": True,
            "tweet_awards_web_tipping_enabled": False,
            "responsive_web_home_pinned_timelines_enabled": True,
            "creator_subscriptions_tweet_preview_api_enabled": True,
            "freedom_of_speech_not_reach_fetch_enabled": True,
            "standardized_nudges_misinfo": True,
            "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
            "rweb_video_timestamps_enabled": True,
            "longform_notetweets_rich_text_read_enabled": True,
            "longform_notetweets_inline_reply_enabled": True,
            "responsive_web_enhance_cards_enabled": False
        },
        "queryId": "bDE2tMmEFcaSKo1SdRc44Q"
    }

    proxies = {
        "http://": proxy,
        "https://": proxy
    } if proxy else None

    async with httpx.AsyncClient(proxies=proxies) as client:
        logger.info(f"Sending real CreateTweet request to X for Tweet ID {tweet_id}")
        response = await client.post(
            "https://x.com/i/api/graphql/bDE2tMmEFcaSKo1SdRc44Q/CreateTweet",
            json=payload,
            headers=headers,
            timeout=15.0
        )

    if response.status_code in [301, 302, 303, 307, 308]:
        location = response.headers.get("location", "")
        if "login" in location.lower() or "flow/login" in location.lower():
            raise RuntimeError("Cookie X đã hết hạn hoặc không hợp lệ (Bị chuyển hướng về trang Đăng nhập). Vui lòng cấu hình Cookie mới.")
        elif "checkpoint" in location.lower() or "challenge" in location.lower():
            raise RuntimeError("Tài khoản X bị dính xác minh (Checkpoint/Captcha). Vui lòng mở trình duyệt để xác minh.")
        else:
            raise RuntimeError(f"X API bị chuyển hướng (302) tới: {location}")

    if response.status_code != 200:
        err_msgs = []
        try:
            err_data = response.json()
            if isinstance(err_data, dict) and "errors" in err_data:
                for err in err_data["errors"]:
                    if isinstance(err, dict):
                        msg = err.get("message", "Unknown error")
                        code = err.get("code")
                        if code is not None:
                            err_msgs.append(f"{msg} (code: {code})")
                        else:
                            err_msgs.append(msg)
        except Exception:
            pass
            
        if err_msgs:
            raise RuntimeError(f"X API error (HTTP {response.status_code}): {', '.join(err_msgs)}")
        raise RuntimeError(f"X API error: HTTP {response.status_code} - {response.text[:200]}")

    try:
        res_data = response.json()
    except Exception:
        _raise_for_non_json_response("X", response)

    if "errors" in res_data:
        err_msgs = []
        for err in res_data["errors"]:
            if isinstance(err, dict):
                msg = err.get("message", "Unknown error")
                code = err.get("code")
                if code is not None:
                    err_msgs.append(f"{msg} (code: {code})")
                else:
                    err_msgs.append(msg)
        raise RuntimeError(f"X GraphQL error: {', '.join(err_msgs)}")

    return res_data

async def post_to_threads_playwright(
    cookie_str: str,
    target_url: str,
    comment_content: str,
    proxy: Optional[str] = None,
) -> dict:
    """Publishes a Threads reply through browser automation using session cookies."""
    from playwright.async_api import async_playwright
    import os
    import tempfile

    async def click_first_visible(locator, description: str) -> bool:
        count = await locator.count()
        for index in range(count):
            candidate = locator.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                aria_disabled = await candidate.get_attribute("aria-disabled")
                disabled = await candidate.get_attribute("disabled")
                if aria_disabled == "true" or disabled is not None:
                    logger.debug(f"Skipping disabled Threads {description} candidate #{index + 1}")
                    continue
                await candidate.click()
                logger.info(f"Clicked Threads {description} candidate #{index + 1}")
                return True
            except Exception as e:
                logger.debug(f"Skipping Threads {description} candidate #{index + 1}: {e}")
        return False

    async def try_submit_strategies(page, dialog_scope=None) -> bool:
        """Try multiple strategies to find and click the submit/post button."""
        scope = dialog_scope if dialog_scope else page

        # Strategy 1: role-based button matching common labels
        submit_pattern = re.compile(r"^(post|reply|đăng|gửi|trả lời)$", re.IGNORECASE)
        if await click_first_visible(
            scope.get_by_role("button", name=submit_pattern),
            "submit role button",
        ):
            return True

        # Strategy 2: CSS selector with has-text
        text_selectors = (
            "button:has-text('Post'), button:has-text('Reply'), "
            "button:has-text('Đăng'), button:has-text('Gửi'), button:has-text('Trả lời'), "
            "div[role='button']:has-text('Post'), div[role='button']:has-text('Reply'), "
            "div[role='button']:has-text('Đăng'), div[role='button']:has-text('Gửi'), "
            "div[role='button']:has-text('Trả lời')"
        )
        if await click_first_visible(scope.locator(text_selectors), "submit text button"):
            return True

        # Strategy 3: aria-label based selectors (Threads often uses aria-label)
        aria_selectors = (
            "[aria-label='Post'], [aria-label='Reply'], "
            "[aria-label='Đăng'], [aria-label='Gửi'], [aria-label='Trả lời'], "
            "[aria-label='post'], [aria-label='reply']"
        )
        if await click_first_visible(scope.locator(aria_selectors), "submit aria-label button"):
            return True

        # Strategy 4: data-testid based (Threads/Instagram often use testids)
        testid_selectors = (
            "[data-testid*='post'], [data-testid*='reply'], [data-testid*='submit'], "
            "[data-testid*='send'], [data-testid*='Post'], [data-testid*='Reply']"
        )
        if await click_first_visible(scope.locator(testid_selectors), "submit data-testid button"):
            return True

        # Strategy 5: XPath text content matching (more flexible text search)
        xpath_patterns = [
            "//button[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'post')]",
            "//button[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'reply')]",
            "//div[@role='button'][contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'post')]",
            "//div[@role='button'][contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'reply')]",
            "//button[contains(text(),'Đăng')]",
            "//button[contains(text(),'Gửi')]",
            "//button[contains(text(),'Trả lời')]",
            "//div[@role='button'][contains(text(),'Đăng')]",
            "//div[@role='button'][contains(text(),'Gửi')]",
            "//div[@role='button'][contains(text(),'Trả lời')]",
        ]
        for xpath in xpath_patterns:
            if await click_first_visible(scope.locator(f"xpath={xpath}"), f"submit xpath ({xpath[:40]})"):
                return True

        # Strategy 6: Look for any enabled button near the editor/textbox area
        # Threads sometimes wraps the submit in a span or uses non-standard elements
        nearby_selectors = (
            "form button:not([disabled]), "
            "form div[role='button']:not([aria-disabled='true'])"
        )
        if await click_first_visible(scope.locator(nearby_selectors), "submit form button"):
            return True

        return False

    logger.info("Starting Playwright browser automation for Threads comment...")
    async with async_playwright() as p:
        launch_kwargs = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        }
        if proxy:
            launch_kwargs["proxy"] = {"server": proxy}

        browser = await p.chromium.launch(**launch_kwargs)
        try:
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )

            cookies_dict = parse_cookie_to_dict(cookie_str)
            playwright_cookies = []
            for name, value in cookies_dict.items():
                for domain in [".threads.net", ".threads.com", ".instagram.com"]:
                    playwright_cookies.append({
                        "name": name,
                        "value": value,
                        "domain": domain,
                        "path": "/",
                        "secure": True,
                        "sameSite": "None",
                    })
            await context.add_cookies(playwright_cookies)

            page = await context.new_page()
            logger.info(f"Opening Threads post page: {target_url}")

            # Use networkidle to ensure the SPA has fully loaded
            try:
                await page.goto(target_url, wait_until="networkidle", timeout=60000)
            except Exception:
                logger.warning("networkidle timed out, falling back to domcontentloaded")
                await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)

            # Extra wait for Threads SPA rendering
            await page.wait_for_timeout(3000)

            editor_selector = "div[contenteditable='true'], [role='textbox'], p[contenteditable='true']"
            reply_trigger_selector = (
                "[aria-label*='Reply'], [aria-label*='Trả lời'], [aria-label*='reply'], "
                "button:has-text('Reply'), button:has-text('Trả lời'), "
                "div[role='button']:has-text('Reply'), div[role='button']:has-text('Trả lời'), "
                "svg[aria-label='Reply'], svg[aria-label='Trả lời'], "
                "[data-testid*='reply']"
            )

            try:
                await page.wait_for_selector(
                    f"{editor_selector}, {reply_trigger_selector}",
                    timeout=15000,
                )
            except Exception:
                logger.warning("Could not find reply input or button selectors. Will attempt to proceed anyway...")

            # 1. Determine if a dialog is already open
            dialog = page.locator("[role='dialog']").last
            dialog_visible = await dialog.count() > 0 and await dialog.is_visible()

            if not dialog_visible:
                logger.info("Reply composer dialog not visible. Clicking reply button to open it...")
                reply_clicked = await click_first_visible(
                    page.locator(reply_trigger_selector),
                    "reply/open composer",
                )
                if not reply_clicked:
                    reply_clicked = await click_first_visible(
                        page.get_by_role("button", name=re.compile("reply|trả lời|comment", re.IGNORECASE)),
                        "reply/open composer role",
                    )
                if not reply_clicked:
                    # Try clicking SVG icons that might be reply buttons
                    svg_reply = page.locator("svg[aria-label*='Reply'], svg[aria-label*='Trả lời'], svg[aria-label*='reply'], svg[aria-label*='Comment'], svg[aria-label*='comment']")
                    if await svg_reply.count() > 0:
                        for i in range(await svg_reply.count()):
                            try:
                                parent = svg_reply.nth(i).locator("..")
                                if await parent.is_visible():
                                    await parent.click()
                                    reply_clicked = True
                                    logger.info(f"Clicked SVG reply parent element #{i + 1}")
                                    break
                            except Exception:
                                continue

                if not reply_clicked:
                    # Capture screenshot for debugging
                    try:
                        debug_dir = tempfile.gettempdir()
                        screenshot_path = os.path.join(debug_dir, "threads_debug_no_reply_btn.png")
                        await page.screenshot(path=screenshot_path, full_page=True)
                        logger.error(f"Debug screenshot saved to {screenshot_path}")
                        page_title = await page.title()
                        current_url = page.url
                        logger.error(f"Page title: {page_title}, URL: {current_url}")
                    except Exception as ss_err:
                        logger.error(f"Failed to capture debug screenshot: {ss_err}")

                    raise SocialAuthError(
                        "Cookie Threads đã hết hạn hoặc không hợp lệ (Không tìm thấy nút hoặc khung bình luận). "
                        "Vui lòng lấy lại cookie mới và cập nhật tài khoản."
                    )

                # Wait for dialog to appear after clicking reply
                try:
                    await page.wait_for_selector("[role='dialog']", timeout=10000)
                    dialog = page.locator("[role='dialog']").last
                    dialog_visible = await dialog.is_visible()
                except Exception:
                    # Capture debug screenshot
                    try:
                        debug_dir = tempfile.gettempdir()
                        screenshot_path = os.path.join(debug_dir, "threads_debug_no_dialog.png")
                        await page.screenshot(path=screenshot_path, full_page=True)
                        logger.error(f"Debug screenshot saved to {screenshot_path}")
                    except Exception:
                        pass

                    raise SocialAuthError(
                        "Cookie Threads đã hết hạn hoặc không hợp lệ (Không thể mở khung soạn thảo bình luận). "
                        "Vui lòng lấy lại cookie mới và cập nhật tài khoản."
                    )

            # 2. Select the editor
            if dialog_visible:
                logger.info("Reply dialog is open. Selecting editor inside the dialog.")
                editor = dialog.locator(editor_selector).first
            else:
                logger.warning("No reply dialog open. Falling back to page-wide editor search.")
                editor = page.locator(editor_selector).first

            await editor.click()
            await page.wait_for_timeout(500)

            logger.info(f"Entering comment text: {comment_content}")
            try:
                await editor.fill(comment_content)
            except Exception:
                try:
                    await editor.press_sequentially(comment_content, delay=50)
                except Exception:
                    await page.keyboard.insert_text(comment_content)

            # Wait for the text to be entered and submit button to become active
            await page.wait_for_timeout(1500)

            # Try to find and click submit button
            clicked_submit = False

            # First try within a dialog/modal if one is visible
            dialog = page.locator("[role='dialog']").last
            if await dialog.count() > 0 and await dialog.is_visible():
                logger.info("Found visible dialog, trying submit strategies within dialog...")
                clicked_submit = await try_submit_strategies(page, dialog_scope=dialog)

            # If no dialog submit found, try page-wide
            if not clicked_submit:
                logger.info("Trying submit strategies on full page...")
                clicked_submit = await try_submit_strategies(page)

            # Last resort: try pressing Enter or Ctrl+Enter
            if not clicked_submit:
                logger.info("No submit button found. Trying keyboard shortcut Ctrl+Enter...")
                await page.keyboard.press("Control+Enter")
                await page.wait_for_timeout(2000)

                # Check if comment was posted by verifying editor is now empty or hidden
                try:
                    editor_still_visible = await editor.is_visible()
                    editor_text = await editor.inner_text() if editor_still_visible else ""
                    if not editor_still_visible or editor_text.strip() == "":
                        clicked_submit = True
                        logger.info("Ctrl+Enter appears to have submitted the comment successfully.")
                except Exception:
                    pass

            if not clicked_submit:
                # Capture debug info before failing
                try:
                    debug_dir = tempfile.gettempdir()
                    screenshot_path = os.path.join(debug_dir, "threads_debug_no_submit.png")
                    await page.screenshot(path=screenshot_path, full_page=True)
                    logger.error(f"Debug screenshot saved to {screenshot_path}")

                    # Log page HTML for debugging
                    html_content = await page.content()
                    html_path = os.path.join(debug_dir, "threads_debug_page.html")
                    with open(html_path, "w", encoding="utf-8") as f:
                        f.write(html_content)
                    logger.error(f"Debug page HTML saved to {html_path}")

                    # Log all visible buttons for debugging
                    all_buttons = page.locator("button, [role='button']")
                    btn_count = await all_buttons.count()
                    logger.error(f"Total buttons/role-buttons found on page: {btn_count}")
                    for i in range(min(btn_count, 20)):
                        try:
                            btn = all_buttons.nth(i)
                            is_vis = await btn.is_visible()
                            text = await btn.inner_text() if is_vis else "(hidden)"
                            aria = await btn.get_attribute("aria-label") or ""
                            testid = await btn.get_attribute("data-testid") or ""
                            logger.error(f"  Button #{i}: visible={is_vis}, text='{text[:50]}', aria-label='{aria}', data-testid='{testid}'")
                        except Exception:
                            pass
                except Exception as debug_err:
                    logger.error(f"Failed to capture debug info: {debug_err}")

                raise RuntimeError(
                    "Không tìm thấy nút đăng/gửi bình luận trên trang. "
                    "Vui lòng kiểm tra debug screenshot tại thư mục temp và thử lại sau."
                )

            logger.info("Clicked submit/post. Waiting for comment to be processed...")
            await page.wait_for_timeout(4000)

            # Verify the comment was actually posted
            post_verified = False
            verification_msg = ""

            # Check 1: Editor should be cleared or hidden after successful post
            try:
                editor_visible = await editor.is_visible()
                if editor_visible:
                    editor_text = (await editor.inner_text()).strip()
                    if editor_text == "" or editor_text != comment_content:
                        post_verified = True
                        verification_msg = "Editor cleared after submit"
                else:
                    post_verified = True
                    verification_msg = "Editor hidden after submit (dialog closed)"
            except Exception:
                # Editor might have been removed from DOM = success
                post_verified = True
                verification_msg = "Editor no longer in DOM"

            # Check 2: Look for error messages from Threads
            error_indicators = page.locator(
                "[role='alert'], [data-testid*='error'], [data-testid*='toast'], "
                "div:has-text('couldn\\'t'), div:has-text('không thể'), "
                "div:has-text('try again'), div:has-text('thử lại'), "
                "div:has-text('restricted'), div:has-text('hạn chế')"
            )
            try:
                error_count = await error_indicators.count()
                for idx in range(min(error_count, 5)):
                    el = error_indicators.nth(idx)
                    if await el.is_visible():
                        err_text = await el.inner_text()
                        if err_text.strip() and len(err_text.strip()) < 200:
                            post_verified = False
                            verification_msg = f"Threads error detected: {err_text.strip()[:100]}"
                            logger.warning(f"Threads error after submit: {err_text.strip()[:100]}")
                            break
            except Exception:
                pass

            # Capture post-submit screenshot for debugging
            try:
                debug_dir = tempfile.gettempdir()
                screenshot_path = os.path.join(debug_dir, f"threads_post_submit_{int(asyncio.get_event_loop().time())}.png")
                await page.screenshot(path=screenshot_path)
                logger.info(f"Post-submit screenshot saved to {screenshot_path}")
            except Exception:
                pass

            # Wait a bit more for any async operations
            await page.wait_for_timeout(2000)

            if post_verified:
                logger.info(f"Comment posting verified: {verification_msg}")
            else:
                logger.warning(f"Comment may not have been posted: {verification_msg}")

            return {
                "provider": "playwright_browser_automation",
                "success": True,
                "verified": post_verified,
                "verification_msg": verification_msg
            }
        finally:
            await browser.close()


async def mock_post_comment(
    platform: str,
    username: str,
    target_url: str,
    comment_content: str,
    cookie: Optional[str] = None,
    proxy: Optional[str] = None,
    access_token: Optional[str] = None,
    threads_user_id: Optional[str] = None,
) -> dict:
    """
    Sends a comment using X or Threads. If a valid-looking cookie is provided,
    performs a real HTTP call; otherwise, falls back to simulation.
    """
    logger.info(f"[{platform}] Account @{username} processing comment on {target_url}...")

    # Determine if we should perform a real HTTP post using cookies
    has_threads_token = (
        platform == "Threads"
        and access_token
        and threads_user_id
        and len(access_token) > 20
    )
    if has_threads_token:
        if access_token.lower().startswith("mock"):
            logger.info(f"[{platform}] Mock Access Token detected. Simulating official Threads Graph API call...")
            await asyncio.sleep(1.0)
            return {
                "success": True,
                "platform": platform,
                "posted_by": username,
                "target": target_url,
                "comment": comment_content,
                "real_api": False,
                "response": {
                    "provider": "official_threads_graph_api",
                    "reply_to_id": "mock_reply_to_id",
                    "creation_id": "mock_creation_id",
                    "publish": {"id": "mock_publish_id"},
                    "mocked": True
                }
            }
        try:
            result = await post_to_threads_official(
                access_token=access_token,
                threads_user_id=threads_user_id,
                target_url=target_url,
                comment_content=comment_content,
                proxy=proxy,
            )
            logger.info(f"[{platform}] Comment posted successfully via official Threads Graph API!")
            return {
                "success": True,
                "platform": platform,
                "posted_by": username,
                "target": target_url,
                "comment": comment_content,
                "real_api": True,
                "response": result
            }
        except Exception as e:
            logger.error(f"[{platform}] Official API posting failed: {str(e)}")
            raise e

    has_real_cookie = cookie and len(cookie) > 20 and not cookie.lower().startswith("mock")

    if has_real_cookie:
        try:
            if platform == "X":
                result = await post_to_x_real(cookie, target_url, comment_content, proxy=proxy)
                logger.info(f"[{platform}] Cookie-based comment posted successfully via real X API!")
                return {
                    "success": True,
                    "platform": platform,
                    "posted_by": username,
                    "target": target_url,
                    "comment": comment_content,
                    "real_api": True,
                    "response": result
                }
            elif platform == "Threads":
                result = await post_to_threads_playwright(
                    cookie_str=cookie,
                    target_url=target_url,
                    comment_content=comment_content,
                    proxy=proxy
                )
                logger.info(f"[{platform}] Cookie-based comment posted successfully via Playwright browser automation!")
                return {
                    "success": True,
                    "platform": platform,
                    "posted_by": username,
                    "target": target_url,
                    "comment": comment_content,
                    "real_api": True,
                    "response": result
                }

        except Exception as e:
            logger.error(f"[{platform}] Real API posting failed: {str(e)}. Retrying/raising error.")
            raise e

    # Fallback/Simulation mode (when no cookie or mock cookie is provided)
    logger.info(f"[{platform}] Cookie is empty or mock. Simulating API call...")
    
    # 1. Simulate network delay (1.5 to 3.0 seconds)
    delay = random.uniform(1.5, 3.0)
    await asyncio.sleep(delay)
    
    # 2. Simulate random failures to demonstrate Retry strategy (10% rate)
    failure_roll = random.random()
    if failure_roll < 0.10:
        logger.warning(f"[{platform}] Network timeout posting comment by @{username} on {target_url}")
        raise RuntimeError("Connection timed out. Simulated social API endpoint returned 504.")
    
    # 3. Simulate another type of failure for bad accounts (5% rate)
    elif failure_roll < 0.15:
        logger.warning(f"[{platform}] Account @{username} is temporarily rate-limited by {platform}")
        raise PermissionError("Rate limit exceeded. Temporary account cooldown simulation (429).")
        
    logger.info(f"[{platform}] Success! Simulated comment posted by @{username}")
    return {
        "success": True,
        "platform": platform,
        "posted_by": username,
        "target": target_url,
        "comment": comment_content,
        "real_api": False,
        "timestamp": asyncio.get_event_loop().time(),
        "transaction_id": f"tx_{platform.lower()}_{random.randint(100000000, 999999999)}"
    }

async def check_account_connection(
    platform: str,
    cookie: Optional[str],
    access_token: Optional[str] = None,
    threads_user_id: Optional[str] = None,
    proxy: Optional[str] = None,
) -> tuple[bool, str]:
    if platform == "Threads":
        if access_token:
            if access_token.lower().startswith("mock"):
                return True, f"Threads access token (MOCK) hop le."
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.get(
                        "https://graph.threads.net/v1.0/me",
                        params={"fields": "id,username", "access_token": access_token},
                    )
                data = response.json()
                if response.status_code >= 400 or "error" in data:
                    return False, f"Threads access token khong hop le: {data.get('error', data)}"
                if threads_user_id and str(data.get("id")) != str(threads_user_id):
                    return False, f"Threads user id khong khop token. Token user id: {data.get('id')}"
                return True, f"Threads access token hop le cho @{data.get('username', data.get('id'))}."
            except Exception as e:
                return False, f"Loi kiem tra Threads access token: {str(e)}"
        
        if not cookie:
            return False, "Tài khoản Threads yêu cầu Access Token chính thức hoặc Session Cookie."
            
        try:
            cookies_dict = parse_cookie_to_dict(cookie)
            session_id = cookies_dict.get("sessionid") or cookies_dict.get("session_id")
            if not session_id:
                return False, "Cookie thiếu trường 'sessionid' của Threads. Vui lòng kiểm tra lại."
            return True, "Cookie hợp lệ. Đã kết nối tài khoản Threads (Trình duyệt tự động)."
        except Exception as e:
            return False, f"Lỗi phân tích Cookie Threads: {str(e)}"

    if not cookie:
        return False, "Chưa cấu hình Cookie cho tài khoản này."
        
    try:
        cookies_dict = parse_cookie_to_dict(cookie)
        
        if platform == "X":
            is_mock_cookie = not cookie or "mock" in cookie.lower() or len(cookie) <= 20
            csrf_token = cookies_dict.get("ct0")
            auth_token = cookies_dict.get("auth_token")
            missing = []
            if not csrf_token:
                missing.append("'ct0'")
            if not auth_token:
                missing.append("'auth_token'")
            if missing:
                return False, f"Cookie thiếu trường {', '.join(missing)} của X. Vui lòng cấu hình đầy đủ."
            
            if is_mock_cookie:
                return True, "Cookie hợp lệ (MÔ PHỎNG). Đã kết nối tài khoản X thành công."
                
            # Real validation check on X
            headers = {
                "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnAIP4xF4ssbxNqqg4sWWWS4tDD0%3DAJu77Fr21fCD1gJJ1F7732stwSZg185s17nNw55ss",
                "x-csrf-token": csrf_token,
                "cookie": "; ".join([f"{k}={v}" for k, v in cookies_dict.items()]),
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "referer": "https://x.com/"
            }
            proxies = {
                "http://": proxy,
                "https://": proxy
            } if proxy else None
            
            try:
                async with httpx.AsyncClient(proxies=proxies, follow_redirects=True, timeout=12.0) as client:
                    response = await client.get(
                        "https://x.com/i/api/1.1/account/verify_credentials.json",
                        headers=headers
                    )
                
                final_url = str(response.url)
                if "login" in final_url.lower() or "flow/login" in final_url.lower():
                    return False, "Cookie X đã hết hạn hoặc không hợp lệ (Bị chuyển hướng về trang Đăng nhập)."
                    
                content_type = response.headers.get("content-type", "")
                if "html" in content_type.lower() or response.text.strip().startswith("<"):
                    return False, "Cookie X đã hết hạn hoặc không hợp lệ (API trả về trang HTML/Login thay vì JSON)."

                if response.status_code == 200:
                    try:
                        res_data = response.json()
                        screen_name = res_data.get("screen_name")
                        if screen_name:
                            return True, f"Đã kết nối tài khoản X thành công. Xin chào @{screen_name}!"
                        return True, "Cookie hợp lệ. Đã kết nối tài khoản X thành công."
                    except Exception:
                        return True, "Cookie hợp lệ. Đã kết nối tài khoản X thành công."
                
                elif response.status_code in [401, 403]:
                    err_msg = "Cookie X đã hết hạn hoặc không hợp lệ. Vui lòng lấy cookie mới."
                    try:
                        err_data = response.json()
                        if "errors" in err_data:
                            msgs = [e.get("message") for e in err_data["errors"] if e.get("message")]
                            if msgs:
                                err_msg = f"Lỗi từ X API: {', '.join(msgs)}"
                    except Exception:
                        pass
                    return False, err_msg
                else:
                    return False, f"Kiểm tra thất bại. X API phản hồi HTTP {response.status_code}."
            except Exception as e:
                return False, f"Không thể kết nối đến X để kiểm tra cookie: {str(e)}"
            
        else:
            return False, f"Nền tảng {platform} chưa được hỗ trợ kiểm tra."
    except Exception as e:
        return False, f"Lỗi phân tích Cookie: {str(e)}"


async def fetch_real_latest_post(platform: str, page_url: str, cookie_str: Optional[str] = None, proxy: Optional[str] = None) -> str:
    """
    Scrapes the actual latest post URL from a public profile page of X or Threads.
    Uses Playwright and optionally injects cookies for X to bypass login walls.
    """
    from playwright.async_api import async_playwright
    import os

    # Normalize page url
    page_url = page_url.strip()
    if not page_url.startswith("http"):
        page_url = f"https://{page_url}"

    username = "social_user"
    match = re.search(r"(?:x\.com|twitter\.com|threads\.net|threads\.com)/@?([A-Za-z0-9_\.]+)", page_url, re.IGNORECASE)
    if match:
        username = match.group(1)

    logger.info(f"[{platform}] Publicly scraping latest post for @{username} from {page_url}...")

    is_mock_cookie = not cookie_str or "mock" in cookie_str.lower() or len(cookie_str) <= 20

    async with async_playwright() as p:
        launch_kwargs = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        }
        if proxy:
            launch_kwargs["proxy"] = {"server": proxy}

        browser = await p.chromium.launch(**launch_kwargs)
        try:
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
                locale="en-US",
            )

            # For X, we MUST inject cookies to see the profile posts
            if platform == "X" and cookie_str and not is_mock_cookie:
                cookies_dict = parse_cookie_to_dict(cookie_str)
                playwright_cookies = []
                for name, value in cookies_dict.items():
                    for domain in [".x.com", ".twitter.com"]:
                        playwright_cookies.append({
                            "name": name,
                            "value": value,
                            "domain": domain,
                            "path": "/",
                            "secure": True,
                            "sameSite": "None",
                        })
                await context.add_cookies(playwright_cookies)
            
            # For Threads, we can inject cookies if available, otherwise try public
            elif platform == "Threads" and cookie_str and not is_mock_cookie:
                cookies_dict = parse_cookie_to_dict(cookie_str)
                playwright_cookies = []
                for name, value in cookies_dict.items():
                    for domain in [".threads.net", ".threads.com", ".instagram.com"]:
                        playwright_cookies.append({
                            "name": name,
                            "value": value,
                            "domain": domain,
                            "path": "/",
                            "secure": True,
                            "sameSite": "None",
                        })
                await context.add_cookies(playwright_cookies)

            page = await context.new_page()
            
            use_cookies = cookie_str and not is_mock_cookie and platform == "Threads"

            while True:
                if platform == "Threads" and not use_cookies:
                    await context.clear_cookies()
                    logger.info("[Threads] Cleared cookies to retry public scraping.")

                try:
                    # Go to profile url
                    await page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
                    await page.wait_for_timeout(5000) # Wait for client rendering

                    if platform == "X":
                        # Find links containing "/status/"
                        links = await page.locator("a[href*='/status/']").all()
                        for link in links:
                            href = await link.get_attribute("href")
                            if href and f"/{username}/status/" in href:
                                full_url = href if href.startswith("http") else f"https://x.com{href}"
                                if re.search(r"/status/\d+", full_url):
                                    full_url = full_url.split("?")[0]
                                    logger.info(f"[X] Found latest post: {full_url}")
                                    return full_url
                        
                        raise RuntimeError(f"Không tìm thấy bài viết nào trên trang X của @{username}.")

                    else:
                        # Threads: Find links containing "/post/" or "/t/"
                        links = await page.locator("a[href*='/post/'], a[href*='/t/']").all()
                        for link in links:
                            href = await link.get_attribute("href")
                            if href:
                                full_url = href if href.startswith("http") else f"https://www.threads.net{href}"
                                if "/post/" in full_url or "/t/" in full_url:
                                    full_url = full_url.split("?")[0]
                                    logger.info(f"[Threads] Found latest post: {full_url}")
                                    return full_url
                        
                        raise RuntimeError(f"Không tìm thấy bài viết nào trên trang Threads của @{username}.")

                except Exception as e:
                    if platform == "Threads" and use_cookies:
                        logger.warning(f"Failed to fetch Threads profile with cookies: {e}. Retrying without cookies...")
                        use_cookies = False
                        await page.close()
                        page = await context.new_page()
                        continue
                    raise e

        finally:
            await browser.close()


async def mock_fetch_latest_post(platform: str, page_url: str, existing_urls: list[str], cookie_str: Optional[str] = None, proxy: Optional[str] = None) -> str:
    """
    Tries to scrape the actual latest post from the page.
    If it fails or if it's in simulation mode (cookie_str is a mock), falls back to simulation.
    """
    # If the page_url is a mock url or if the cookie is mock, run simulated
    is_mock_page = "mock" in page_url.lower() or "example" in page_url.lower() or ("@" not in page_url and "/" not in page_url)
    is_mock_cookie = not cookie_str or "mock" in cookie_str.lower() or len(cookie_str) <= 20
    
    if is_mock_page or (platform == "X" and is_mock_cookie):
        # Fallback simulated
        username = "social_user"
        match = re.search(r"(?:x\.com|twitter\.com|threads\.net|threads\.com)/@?([A-Za-z0-9_\.]+)", page_url, re.IGNORECASE)
        if match:
            username = match.group(1)
            
        if platform == "X":
            base_pattern = f"https://x.com/{username}/status/"
        else:
            base_pattern = f"https://www.threads.net/@{username}/post/"
            
        if not existing_urls:
            return f"{base_pattern}1992837482911"
        else:
            if random.random() < 0.40:
                new_id = random.randint(1000000000000, 9999999999999)
                new_post = f"{base_pattern}{new_id}"
                logger.info(f"[{platform}] Simulated new post detected on page: {new_post}")
                return new_post
            else:
                return existing_urls[-1]
                
    # Otherwise, try to fetch the real latest post!
    try:
        real_url = await fetch_real_latest_post(platform, page_url, cookie_str, proxy)
        return real_url
    except Exception as e:
        logger.warning(f"Failed to fetch real latest post for {page_url}: {e}. Falling back to simulation...")
        # Fallback simulation
        username = "social_user"
        match = re.search(r"(?:x\.com|twitter\.com|threads\.net|threads\.com)/@?([A-Za-z0-9_\.]+)", page_url, re.IGNORECASE)
        if match:
            username = match.group(1)
            
        if platform == "X":
            base_pattern = f"https://x.com/{username}/status/"
        else:
            base_pattern = f"https://www.threads.net/@{username}/post/"
            
        if not existing_urls:
            return f"{base_pattern}1992837482911"
        else:
            return existing_urls[-1]
