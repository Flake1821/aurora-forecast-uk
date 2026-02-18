import re


# Keyword and pattern rules for each category
CATEGORY_RULES = {
    'alert': {
        'keywords': [
            'alert', 'kp', 'aurora', 'geomagnetic', 'storm', 'cme',
            'solar wind', 'tonight', 'heads up', 'look north',
            'meteor shower', 'eclipse', 'supermoon', 'visible',
            'outlook', 'forecast', 'watch for', 'bz', 'solar flare',
            'coronal', 'substorm', 'night sky outlook', 'perseid',
            'geminid', 'leonid', 'quadrantid',
        ],
        'patterns': [
            r'kp\s*[4-9]',
            r'g[1-5]\s*storm',
            r'tonight|this evening',
            r'next\s*\d+\s*hours?',
        ],
    },
    'event': {
        'keywords': [
            'workshop', 'book', 'booking', 'tickets', 'event',
            'milky way workshop', 'photography workshop',
            'join us', 'limited spaces', 'sign up',
            'meetup', 'meet up', 'exhibition', 'class',
            'spaces available', 'register',
        ],
        'patterns': [
            r'\u00a3\d+',  # Price in GBP
            r'\$\d+',
            r'book\s*(now|here|your)',
        ],
    },
    'blog': {
        'keywords': [
            'tutorial', 'how to', 'tips', 'guide', 'learn',
            'behind the scenes', 'bts', 'iso', 'settings',
            'exposure', 'composition', 'editing', 'processing',
            'camera', 'lens', 'technique', 'explained',
            'stacking', 'tracked', 'planning', 'how i',
        ],
        'patterns': [
            r'(\d+)\s*seconds?\s*exposure',
            r'f/\d+',
            r'iso\s*\d+',
        ],
    },
    'gallery': {
        'keywords': [
            'shot', 'captured', 'image', 'photo', 'last night',
            'from the archives', 'throwback', 'print',
        ],
        'patterns': [],
    },
}


def categorize_post(message, has_images=False, image_count=0):
    """Categorize a Facebook post based on its content.

    Args:
        message: Post text content
        has_images: Whether the post has images
        image_count: Number of images attached

    Returns:
        Category string: 'alert', 'gallery', 'blog', 'event', or 'uncategorized'
    """
    message_lower = (message or '').lower()

    if not message_lower.strip():
        # No text — if it has images, it's gallery
        if has_images:
            return 'gallery'
        return 'uncategorized'

    # Score each category
    scores = {}
    for category, rules in CATEGORY_RULES.items():
        score = 0
        for kw in rules.get('keywords', []):
            if kw in message_lower:
                score += 1
        for pat in rules.get('patterns', []):
            if re.search(pat, message_lower, re.IGNORECASE):
                score += 2  # Pattern matches weighted higher
        scores[category] = score

    # Gallery heuristic: image-heavy posts with short text
    if has_images and len(message or '') < 100:
        scores['gallery'] = scores.get('gallery', 0) + 3

    # If it's a long text post with images, lean toward blog
    if has_images and len(message or '') > 500:
        scores['blog'] = scores.get('blog', 0) + 1

    # Return highest scoring category, or 'uncategorized' if all zero
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return 'uncategorized'
    return best
