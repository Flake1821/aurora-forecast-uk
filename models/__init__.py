from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

from models.post import FacebookPost
from models.image import PostImage
from models.event import Event
from models.space_weather import SpaceWeatherReading
from models.site_settings import SiteSettings
