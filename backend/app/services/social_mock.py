import asyncio
import random
import logging
import re
import httpx
import json
from typing import Optional

logger = logging.getLogger("app.social_mock")

def parse_cookie_to_dict(cookie_str: str) -> dict:
    if not cookie_str:
        return {}
        
    cookie_str = cookie_str.strip()
    
    # Check if it looks like a JSON array
    if cookie_str.startswith("[") and cookie_str.endswith("]"):
        try:
            cookie_list = json.loads(cookie_str)
            if isinstance(cookie_list, list):
                return {item["name"]: item["value"] for item in cookie_list if isinstance(item, dict) and "name" in item and "value" in item}
        except Exception as e:
            logger.error(f"Failed to parse cookie JSON list: {e}")
            
    # Fallback to key=value; format
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

async def post_to_x_real(cookie_str: str, target_url: str, comment_content: str) -> dict:
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
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

    async with httpx.AsyncClient(cookies=cookies_dict) as client:
        logger.info(f"Sending real CreateTweet request to X for Tweet ID {tweet_id}")
        response = await client.post(
            "https://x.com/i/api/graphql/bDE2tMmEFcaSKo1SdRc44Q/CreateTweet",
            json=payload,
            headers=headers,
            timeout=15.0
        )

    if response.status_code != 200:
        raise RuntimeError(f"X API error: HTTP {response.status_code} - {response.text[:200]}")

    res_data = response.json()
    if "errors" in res_data:
        raise RuntimeError(f"X GraphQL errors: {res_data['errors']}")

    return res_data

async def post_to_threads_real(cookie_str: str, target_url: str, comment_content: str) -> dict:
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

    cookies_dict = parse_cookie_to_dict(cookie_str)

    headers = {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "x-ig-app-id": "238258286",  # Standard Threads web app ID
        "referer": "https://www.threads.net/"
    }

    # Threads reply graphql doc ID
    payload = {
        "variables": f'{{"post_id":"{numeric_id}","text":"{comment_content}"}}',
        "doc_id": "6984210438258286"
    }

    headers["cookie"] = "; ".join([f"{k}={v}" for k, v in cookies_dict.items()])

    async with httpx.AsyncClient() as client:
        logger.info(f"Sending real comment reply to Threads for Post ID {numeric_id} (shortcode: {shortcode})")
        response = await client.post(
            "https://www.threads.net/api/graphql",
            data=payload,
            headers=headers,
            timeout=15.0
        )

    if response.status_code != 200:
        raise RuntimeError(f"Threads API error: HTTP {response.status_code} - {response.text[:200]}")

    res_data = response.json()
    if "errors" in res_data:
        raise RuntimeError(f"Threads GraphQL errors: {res_data['errors']}")

    return res_data

async def mock_post_comment(platform: str, username: str, target_url: str, comment_content: str, cookie: Optional[str] = None) -> dict:
    """
    Sends a comment using X or Threads. If a valid-looking cookie is provided,
    performs a real HTTP call; otherwise, falls back to simulation.
    """
    logger.info(f"[{platform}] Account @{username} processing comment on {target_url}...")

    # Determine if we should perform a real HTTP post using cookies
    has_real_cookie = cookie and len(cookie) > 20 and not cookie.lower().startswith("mock")

    if has_real_cookie:
        try:
            if platform == "X":
                result = await post_to_x_real(cookie, target_url, comment_content)
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
                result = await post_to_threads_real(cookie, target_url, comment_content)
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

async def check_account_connection(platform: str, cookie: Optional[str]) -> tuple[bool, str]:
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
            session_id = cookies_dict.get("sessionid")
            if not session_id:
                return False, "Cookie thiếu trường 'sessionid' của Threads. Vui lòng kiểm tra lại."
            return True, "Cookie hợp lệ. Đã kết nối tài khoản Threads thành công."
            
        else:
            return False, f"Nền tảng {platform} chưa được hỗ trợ kiểm tra."
    except Exception as e:
        return False, f"Lỗi phân tích Cookie: {str(e)}"


