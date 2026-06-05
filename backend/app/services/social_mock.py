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


def _threads_web_origin(cookie_str: str, target_url: str) -> str:
    return "https://www.threads.net"


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
        raise RuntimeError(f"X API error: HTTP {response.status_code} - {response.text[:200]}")

    try:
        res_data = response.json()
    except Exception:
        _raise_for_non_json_response("X", response)

    if "errors" in res_data:
        raise RuntimeError(f"X GraphQL errors: {res_data['errors']}")

    return res_data

async def post_to_threads_real(cookie_str: str, target_url: str, comment_content: str, proxy: Optional[str] = None) -> dict:
    """
    Performs a real HTTP POST request to Threads GraphQL endpoint.
    """
    # Extract shortcode
    match = re.search(r"/post/([A-Za-z0-9\-_]+)", target_url)
    if not match:
        match = re.search(r"/t/([A-Za-z0-9\-_]+)", target_url)
    if not match:
        raise ValueError(f"Could not parse post shortcode from Threads URL: {target_url}")
    
    shortcode = match.group(1)
    numeric_id = shortcode_to_id(shortcode)
    web_origin = _threads_web_origin(cookie_str, target_url)

    cookies_dict = parse_cookie_to_dict(cookie_str)
    csrf_token = cookies_dict.get("csrftoken")

    # If csrftoken is not present in the user's cookie, fetch a new one dynamically
    if not csrf_token:
        logger.info("csrftoken not found in user cookie. Fetching from Threads homepage...")
        try:
            homepage_headers = {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0",
                "referer": f"{web_origin}/"
            }
            proxies = {
                "http://": proxy,
                "https://": proxy
            } if proxy else None
            if cookies_dict:
                homepage_headers["cookie"] = "; ".join([f"{k}={v}" for k, v in cookies_dict.items()])
            async with httpx.AsyncClient(proxies=proxies) as client:
                res = await client.get(f"{web_origin}/", headers=homepage_headers, timeout=10.0, follow_redirects=True)
                if "login" in str(res.url).lower():
                    raise SocialAuthError(
                        "Cookie Threads da het han hoac khong hop le khi lay csrftoken tu homepage. "
                        "Hay lay lai cookie day du va cap nhat tai khoan."
                    )
                csrf_token = res.cookies.get("csrftoken")
                if csrf_token:
                    logger.info(f"Successfully retrieved fresh csrftoken: {csrf_token}")
                    cookies_dict["csrftoken"] = csrf_token
                elif res.status_code == 200 and "html" in res.headers.get("content-type", "").lower():
                    logger.warning("Threads homepage did not return csrftoken; continuing with existing session cookies.")
        except SocialAuthError:
            raise
        except Exception as e:
            logger.error(f"Failed to fetch csrftoken from homepage: {e}")

    headers = {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0",
        "x-ig-app-id": "238260118697367",  # Standard Threads web app ID
        "referer": f"{web_origin}/",
        "origin": web_origin,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin"
    }
    if csrf_token:
        headers["x-csrftoken"] = csrf_token

    # Threads reply graphql doc ID
    payload = {
        "variables": f'{{"post_id":"{numeric_id}","text":"{comment_content}"}}',
        "doc_id": "6984210438258286"
    }

    headers["cookie"] = "; ".join([f"{k}={v}" for k, v in cookies_dict.items()])

    proxies = {
        "http://": proxy,
        "https://": proxy
    } if proxy else None

    async with httpx.AsyncClient(proxies=proxies) as client:
        logger.info(f"Sending real comment reply to Threads for Post ID {numeric_id} (shortcode: {shortcode})")
        response = await client.post(
            f"{web_origin}/api/graphql",
            data=payload,
            headers=headers,
            timeout=15.0,
            follow_redirects=False
        )

    if response.status_code in [301, 302, 303, 307, 308]:
        location = response.headers.get("location", "")
        normalized_location = location.rstrip("/")
        normalized_origin = web_origin.rstrip("/")
        if "login" in location.lower() or normalized_location == normalized_origin:
            raise SocialAuthError("Cookie Threads da het han hoac khong hop le hoac khong du quyen comment. Hay lay lai cookie/token va cap nhat tai khoan.")
        elif "challenge" in location.lower() or "checkpoint" in location.lower():
            raise SocialCheckpointError("Tai khoan Threads dang bi khoa tam thoi hoac dinh xac minh (checkpoint/captcha).")
        else:
            raise RuntimeError(f"Threads API bị chuyển hướng (302) tới: {location}")

    if response.status_code in [401, 403]:
        raise SocialAuthError(
            f"Cookie Threads da het han hoac khong du quyen. HTTP {response.status_code}. "
            "Hay lay lai cookie day du va cap nhat tai khoan."
        )

    if response.status_code != 200:
        raise RuntimeError(f"Threads API error: HTTP {response.status_code} - {response.text[:200]}")

    try:
        res_data = response.json()
    except Exception:
        _raise_for_non_json_response("Threads", response)

    if "errors" in res_data:
        raise RuntimeError(f"Threads GraphQL errors: {res_data['errors']}")

    return res_data

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
                result = await post_to_threads_real(cookie, target_url, comment_content, proxy=proxy)
                logger.info(f"[{platform}] Cookie-based comment posted successfully via real Threads API!")
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
) -> tuple[bool, str]:
    if platform == "Threads" and access_token:
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
        return False, "Chưa cấu hình Cookie cho tài khoản này."
        
    try:
        cookies_dict = parse_cookie_to_dict(cookie)
        
        if platform == "X":
            csrf_token = cookies_dict.get("ct0")
            auth_token = cookies_dict.get("auth_token")
            if not csrf_token or not auth_token:
                return False, "Cookie thiếu trường 'ct0' hoặc 'auth_token' của X. Vui lòng kiểm tra lại."
            return True, "Cookie hợp lệ. Đã kết nối tài khoản X thành công."
            
        elif platform == "Threads":
            session_id = cookies_dict.get("sessionid") or cookies_dict.get("session_id")
            if not session_id:
                return False, "Cookie thiếu trường 'sessionid' của Threads. Vui lòng kiểm tra lại."
            return True, "Cookie hợp lệ. Đã kết nối tài khoản Threads thành công."
            
        else:
            return False, f"Nền tảng {platform} chưa được hỗ trợ kiểm tra."
    except Exception as e:
        return False, f"Lỗi phân tích Cookie: {str(e)}"
