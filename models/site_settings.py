from datetime import datetime
from models import db


class SiteSettings(db.Model):
    __tablename__ = 'site_settings'

    id = db.Column(db.Integer, primary_key=True)
    site_name = db.Column(db.String(200),
                          default='UK Aurora & Night Sky Alerts')
    tagline = db.Column(db.String(500),
                        default='Night-sky alerts for the UK')
    contact_email = db.Column(db.String(200),
                              default='jeremytuckerphotography@gmail.com')
    facebook_url = db.Column(db.String(500),
                             default='https://www.facebook.com/CornwallNightSkyAlerts/')
    instagram_url = db.Column(db.String(500), default='')
    about_text = db.Column(db.Text, default='')
    hero_image = db.Column(db.String(300), default='')
    last_fb_sync = db.Column(db.DateTime)
    fb_sync_interval_minutes = db.Column(db.Integer, default=30)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow)
