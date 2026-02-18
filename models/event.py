from datetime import datetime
from models import db


class Event(db.Model):
    __tablename__ = 'events'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text, default='')
    event_date = db.Column(db.DateTime, nullable=False)
    end_date = db.Column(db.DateTime)
    location = db.Column(db.String(300), default='')
    event_type = db.Column(db.String(50), default='workshop')
    price = db.Column(db.String(50), default='')
    booking_url = db.Column(db.String(500), default='')
    image_filename = db.Column(db.String(300), default='')
    is_published = db.Column(db.Boolean, default=True)
    fb_post_id = db.Column(db.Integer, db.ForeignKey('facebook_posts.id'),
                           nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow)
