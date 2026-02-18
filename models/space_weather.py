from datetime import datetime
from models import db


class SpaceWeatherReading(db.Model):
    __tablename__ = 'space_weather_readings'

    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(50), nullable=False)
    reading_time = db.Column(db.DateTime, nullable=False)
    kp_index = db.Column(db.Float)
    alert_level = db.Column(db.String(20))
    raw_data = db.Column(db.Text)
    fetched_at = db.Column(db.DateTime, default=datetime.utcnow)
