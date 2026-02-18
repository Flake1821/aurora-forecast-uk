from datetime import datetime
from models import db


class FacebookPost(db.Model):
    __tablename__ = 'facebook_posts'

    id = db.Column(db.Integer, primary_key=True)
    fb_post_id = db.Column(db.String(100), unique=True, nullable=False, index=True)
    message = db.Column(db.Text, default='')
    published_at = db.Column(db.DateTime, nullable=False)
    fb_updated_at = db.Column(db.DateTime)
    fb_permalink = db.Column(db.String(500), default='')

    # Category: 'alert', 'gallery', 'blog', 'event', 'uncategorized'
    category = db.Column(db.String(30), default='uncategorized', index=True)
    category_override = db.Column(db.Boolean, default=False)

    is_featured = db.Column(db.Boolean, default=False)
    is_hidden = db.Column(db.Boolean, default=False)

    # Engagement stats (refreshed on each sync)
    reactions_count = db.Column(db.Integer, default=0)
    comments_count = db.Column(db.Integer, default=0)
    shares_count = db.Column(db.Integer, default=0)

    # Relationship to images
    images = db.relationship('PostImage', backref='post', lazy='dynamic',
                             cascade='all, delete-orphan')

    synced_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow)

    @property
    def title(self):
        """Extract a title from the first line of the message."""
        if not self.message:
            return 'Untitled Post'
        first_line = self.message.split('\n')[0].strip()
        if len(first_line) > 80:
            return first_line[:77] + '...'
        return first_line or 'Untitled Post'

    @property
    def excerpt(self):
        """Short excerpt of the message for cards."""
        if not self.message:
            return ''
        text = self.message.strip()
        if len(text) > 200:
            return text[:197] + '...'
        return text

    @property
    def primary_image(self):
        """Get the primary image for this post."""
        img = self.images.filter_by(is_primary=True).first()
        if not img:
            img = self.images.first()
        return img
