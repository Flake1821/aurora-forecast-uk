import os
import logging
from datetime import datetime
import requests
from flask import current_app
from models import db
from models.post import FacebookPost
from models.site_settings import SiteSettings
from services.image_handler import download_post_images
from services.post_categorizer import categorize_post

logger = logging.getLogger(__name__)

GRAPH_API_BASE = 'https://graph.facebook.com'


def get_api_url(path):
    version = current_app.config.get('FB_API_VERSION', 'v22.0')
    return f'{GRAPH_API_BASE}/{version}/{path}'


def sync_all_posts(full=False):
    """Sync posts from the Facebook page.

    Args:
        full: If True, paginate through all historical posts.
              If False (default), only fetch the most recent page.

    Returns:
        dict with 'new', 'updated', 'errors' counts.
    """
    page_id = current_app.config.get('FB_PAGE_ID', '')
    token = current_app.config.get('FB_PAGE_ACCESS_TOKEN', '')

    if not page_id or not token:
        logger.warning('Facebook sync skipped: FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set.')
        return {'new': 0, 'updated': 0, 'errors': 0, 'message': 'Not configured'}

    fields = (
        'id,message,created_time,updated_time,full_picture,'
        'attachments{media,media_type,type,url,subattachments},'
        'permalink_url,shares,'
        'reactions.summary(true),'
        'comments.summary(true)'
    )

    url = get_api_url(f'{page_id}/feed')
    params = {
        'fields': fields,
        'limit': 25,
        'access_token': token,
    }

    stats = {'new': 0, 'updated': 0, 'errors': 0}
    pages_fetched = 0
    max_pages = 100 if full else 2

    while url and pages_fetched < max_pages:
        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            logger.error(f'Facebook API request failed: {e}')
            stats['errors'] += 1
            break
        except ValueError as e:
            logger.error(f'Facebook API returned invalid JSON: {e}')
            stats['errors'] += 1
            break

        posts = data.get('data', [])
        if not posts:
            break

        for post_data in posts:
            try:
                result = _upsert_post(post_data)
                stats[result] += 1
            except Exception as e:
                logger.error(f'Error processing post {post_data.get("id", "?")}: {e}')
                stats['errors'] += 1

        db.session.commit()

        # Move to next page
        paging = data.get('paging', {})
        url = paging.get('next')
        params = {}  # next URL includes all params
        pages_fetched += 1

    # Update last sync time
    settings = SiteSettings.query.first()
    if settings:
        settings.last_fb_sync = datetime.utcnow()
        db.session.commit()

    logger.info(f'Facebook sync complete: {stats}')
    return stats


def _upsert_post(post_data):
    """Create or update a single post. Returns 'new' or 'updated'."""
    fb_id = post_data.get('id', '')
    existing = FacebookPost.query.filter_by(fb_post_id=fb_id).first()

    message = post_data.get('message', '')
    created_time = _parse_fb_datetime(post_data.get('created_time'))
    updated_time = _parse_fb_datetime(post_data.get('updated_time'))
    permalink = post_data.get('permalink_url', '')

    reactions = post_data.get('reactions', {}).get('summary', {}).get('total_count', 0)
    comments = post_data.get('comments', {}).get('summary', {}).get('total_count', 0)
    shares = post_data.get('shares', {}).get('count', 0)

    if existing:
        # Update engagement stats and message (in case of edits)
        existing.message = message
        existing.fb_updated_at = updated_time
        existing.reactions_count = reactions
        existing.comments_count = comments
        existing.shares_count = shares
        existing.synced_at = datetime.utcnow()
        existing.updated_at = datetime.utcnow()

        # Re-categorize only if not manually overridden
        if not existing.category_override:
            has_images = bool(post_data.get('full_picture'))
            image_count = _count_images(post_data)
            existing.category = categorize_post(message, has_images, image_count)

        # Update images
        download_post_images(existing, post_data)
        return 'updated'
    else:
        # Create new post
        has_images = bool(post_data.get('full_picture'))
        image_count = _count_images(post_data)
        category = categorize_post(message, has_images, image_count)

        post = FacebookPost(
            fb_post_id=fb_id,
            message=message,
            published_at=created_time or datetime.utcnow(),
            fb_updated_at=updated_time,
            fb_permalink=permalink,
            category=category,
            reactions_count=reactions,
            comments_count=comments,
            shares_count=shares,
            synced_at=datetime.utcnow(),
        )
        db.session.add(post)
        db.session.flush()  # Get the ID for image downloads

        download_post_images(post, post_data)
        return 'new'


def _parse_fb_datetime(dt_str):
    """Parse Facebook's ISO 8601 datetime string."""
    if not dt_str:
        return None
    try:
        # Facebook returns: 2024-01-15T10:30:00+0000
        return datetime.strptime(dt_str, '%Y-%m-%dT%H:%M:%S%z').replace(tzinfo=None)
    except ValueError:
        try:
            return datetime.fromisoformat(dt_str.replace('+0000', '+00:00')).replace(tzinfo=None)
        except ValueError:
            return None


def _count_images(post_data):
    """Count the number of images in a post's attachments."""
    attachments = post_data.get('attachments', {}).get('data', [])
    count = 0
    for att in attachments:
        if att.get('media_type') == 'photo' or att.get('type') == 'photo':
            count += 1
        subs = att.get('subattachments', {}).get('data', [])
        for sub in subs:
            if sub.get('media_type') == 'photo' or sub.get('type') == 'photo':
                count += 1
    if count == 0 and post_data.get('full_picture'):
        count = 1
    return count
