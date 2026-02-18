import os
import logging
import hashlib
import requests
from flask import current_app
from models import db
from models.image import PostImage

logger = logging.getLogger(__name__)

MAX_WIDTH = 1600
THUMB_WIDTH = 600


def download_post_images(post, post_data):
    """Download images from a Facebook post and save locally.

    Args:
        post: FacebookPost model instance (must have an id)
        post_data: Raw post data dict from Facebook Graph API
    """
    photos_dir = current_app.config.get('PHOTOS_FOLDER', 'static/photos')
    os.makedirs(photos_dir, exist_ok=True)

    image_urls = _extract_image_urls(post_data)

    if not image_urls:
        return

    # Get existing image filenames for this post to avoid re-downloading
    existing_filenames = {
        img.fb_image_url for img in PostImage.query.filter_by(post_id=post.id).all()
    }

    for i, url in enumerate(image_urls):
        if url in existing_filenames:
            continue

        try:
            local_filename = _download_image(url, photos_dir, post.fb_post_id, i)
            if local_filename:
                image = PostImage(
                    post_id=post.id,
                    fb_image_url=url,
                    local_filename=local_filename,
                    is_primary=(i == 0),
                    sort_order=i,
                )
                db.session.add(image)
        except Exception as e:
            logger.error(f'Failed to download image {url}: {e}')


def _extract_image_urls(post_data):
    """Extract all image URLs from a Facebook post's data."""
    urls = []

    # Check attachments first (higher quality)
    attachments = post_data.get('attachments', {}).get('data', [])
    for att in attachments:
        # Single photo attachment
        media = att.get('media', {})
        if media.get('image', {}).get('src'):
            urls.append(media['image']['src'])

        # Album / multiple photos
        subs = att.get('subattachments', {}).get('data', [])
        for sub in subs:
            sub_media = sub.get('media', {})
            if sub_media.get('image', {}).get('src'):
                urls.append(sub_media['image']['src'])

    # Fallback to full_picture if no attachment images found
    if not urls and post_data.get('full_picture'):
        urls.append(post_data['full_picture'])

    return urls


def _download_image(url, photos_dir, fb_post_id, index):
    """Download a single image and save to disk.

    Returns the filename (relative to photos_dir) or None on failure.
    """
    try:
        resp = requests.get(url, timeout=30, stream=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error(f'Image download failed: {e}')
        return None

    # Determine file extension from content-type
    content_type = resp.headers.get('Content-Type', '')
    ext = '.jpg'
    if 'png' in content_type:
        ext = '.png'
    elif 'webp' in content_type:
        ext = '.webp'
    elif 'gif' in content_type:
        ext = '.gif'

    # Create a safe filename from the post ID
    safe_id = fb_post_id.replace('_', '-')
    filename = f'{safe_id}_{index}{ext}'
    filepath = os.path.join(photos_dir, filename)

    # Write to disk
    with open(filepath, 'wb') as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    # Resize if too large
    _resize_if_needed(filepath, MAX_WIDTH)

    logger.info(f'Downloaded image: {filename}')
    return filename


def _resize_if_needed(filepath, max_width):
    """Resize image if wider than max_width, preserving aspect ratio."""
    try:
        from PIL import Image
        with Image.open(filepath) as img:
            if img.width > max_width:
                ratio = max_width / img.width
                new_height = int(img.height * ratio)
                img = img.resize((max_width, new_height), Image.LANCZOS)
                # Save with good quality
                if filepath.lower().endswith('.png'):
                    img.save(filepath, 'PNG', optimize=True)
                else:
                    img.save(filepath, 'JPEG', quality=85, optimize=True)
                logger.info(f'Resized {filepath} to {max_width}px wide')
    except ImportError:
        logger.warning('Pillow not installed, skipping image resize')
    except Exception as e:
        logger.warning(f'Image resize failed for {filepath}: {e}')
