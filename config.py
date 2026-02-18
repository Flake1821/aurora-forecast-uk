import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'cornwall-night-sky-dev-key')
    SQLALCHEMY_DATABASE_URI = f'sqlite:///{os.path.join(BASE_DIR, "instance", "cornwall.db")}'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024

    # Facebook
    FB_PAGE_ID = os.environ.get('FB_PAGE_ID', '')
    FB_PAGE_ACCESS_TOKEN = os.environ.get('FB_PAGE_ACCESS_TOKEN', '')
    FB_API_VERSION = 'v22.0'

    # Admin
    ADMIN_PASSWORD_HASH = os.environ.get('ADMIN_PASSWORD_HASH', '')

    # Sync
    FB_SYNC_INTERVAL_MINUTES = int(os.environ.get('FB_SYNC_INTERVAL_MINUTES', '30'))

    # Paths
    PHOTOS_FOLDER = os.path.join(BASE_DIR, 'static', 'photos')
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
