import asyncio
import random
import logging

logger = logging.getLogger("app.social_mock")

async def mock_post_comment(platform: str, username: str, target_url: str, comment_content: str) -> dict:
    """
    Simulates sending a comment to X (Twitter) or Threads.
    Includes network delay, potential temporary failures, and limits validation.
    """
    logger.info(f"[{platform}] Account @{username} posting comment on {target_url}...")
    
    # 1. Simulate network delay (1.5 to 3.0 seconds)
    delay = random.uniform(1.5, 3.0)
    await asyncio.sleep(delay)
    
    # 2. Simulate random failures to demonstrate Retry strategy (10% rate)
    failure_roll = random.random()
    if failure_roll < 0.10:
        logger.warning(f"[{platform}] Network timeout posting comment by @{username} on {target_url}")
        raise RuntimeError("Connection timed out. API endpoint returned 504.")
    
    # 3. Simulate another type of failure for bad accounts (5% rate)
    elif failure_roll < 0.15:
        logger.warning(f"[{platform}] Account @{username} is temporarily rate-limited by {platform}")
        raise PermissionError("Rate limit exceeded. Temporary account cooldown (429).")
        
    logger.info(f"[{platform}] Success! Comment posted by @{username}")
    return {
        "success": True,
        "platform": platform,
        "posted_by": username,
        "target": target_url,
        "comment": comment_content,
        "timestamp": asyncio.get_event_loop().time(),
        "transaction_id": f"tx_{platform.lower()}_{random.randint(100000000, 999999999)}"
    }
