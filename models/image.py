from datetime import datetime
from models import db


class PostImage(db.Model):
    __tablename__ = 'post_images'

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('facebook_posts.id'),
                        nullable=False)
    fb_image_url = db.Column(db.String(1000), default='')
    local_filename = db.Column(db.String(300), default='')
    caption = db.Column(db.Text, default='')
    width = db.Column(db.Integer)
    height = db.Column(db.Integer)
    is_primary = db.Column(db.Boolean, default=False)
    sort_order = db.Column(db.Integer, default=0)

    location_tag = db.Column(db.String(200), default='')
    equipment_tag = db.Column(db.String(200), default='')

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
