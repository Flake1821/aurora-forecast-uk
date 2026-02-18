import os
import secrets
import time
import logging
import click
from datetime import datetime
from flask import Flask, session, request as flask_request
from config import Config
from models import db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)

    # Register blueprints
    from routes import register_blueprints
    register_blueprints(app)

    # Ensure directories exist
    os.makedirs(app.config.get('PHOTOS_FOLDER', 'static/photos'), exist_ok=True)
    os.makedirs(app.config.get('UPLOAD_FOLDER', 'uploads'), exist_ok=True)
    os.makedirs(os.path.join(os.path.dirname(__file__), 'instance'), exist_ok=True)

    # CSRF protection
    @app.before_request
    def ensure_csrf():
        if 'csrf_token' not in session:
            session['csrf_token'] = secrets.token_hex(32)

    # Context processor for templates
    @app.context_processor
    def inject_globals():
        return {
            'csrf_token': session.get('csrf_token', ''),
            'now': datetime.utcnow(),
        }

    # Template filters
    @app.template_filter('date_format')
    def date_format_filter(value, fmt='%d %B %Y'):
        if value:
            return value.strftime(fmt)
        return ''

    @app.template_filter('time_ago')
    def time_ago_filter(value):
        if not value:
            return ''
        now = datetime.utcnow()
        diff = now - value
        seconds = diff.total_seconds()
        if seconds < 60:
            return 'just now'
        elif seconds < 3600:
            mins = int(seconds / 60)
            return f'{mins}m ago'
        elif seconds < 86400:
            hours = int(seconds / 3600)
            return f'{hours}h ago'
        elif seconds < 604800:
            days = int(seconds / 86400)
            return f'{days}d ago'
        else:
            return value.strftime('%d %b %Y')

    # Create tables and seed settings
    with app.app_context():
        db.create_all()

        from models.site_settings import SiteSettings
        if not SiteSettings.query.first():
            db.session.add(SiteSettings(
                id=1,
                site_name='UK Aurora & Night Sky Alerts',
                tagline='Night-sky alerts for the UK',
                contact_email='jeremytuckerphotography@gmail.com',
                facebook_url='https://www.facebook.com/CornwallNightSkyAlerts/',
            ))
            db.session.commit()

    # Auto-sync Facebook posts (throttled, runs at most once per interval)
    @app.before_request
    def auto_sync_facebook():
        if flask_request.path.startswith('/static/'):
            return
        now = time.time()
        last_sync = getattr(app, '_last_fb_sync_check', 0)
        interval = app.config.get('FB_SYNC_INTERVAL_MINUTES', 30) * 60
        if now - last_sync < interval:
            return
        app._last_fb_sync_check = now
        if not app.config.get('FB_PAGE_ID') or not app.config.get('FB_PAGE_ACCESS_TOKEN'):
            return
        try:
            from services.facebook_sync import sync_all_posts
            stats = sync_all_posts(full=False)
            logger.info(f'Auto-sync complete: {stats}')
        except Exception as e:
            logger.error(f'Auto-sync failed: {e}')

    # Flask CLI commands
    @app.cli.command('sync-facebook')
    @click.option('--full', is_flag=True, help='Sync all historical posts')
    def sync_facebook_cmd(full):
        """Sync posts from the Facebook page."""
        from services.facebook_sync import sync_all_posts
        print(f'Starting Facebook sync (full={full})...')
        stats = sync_all_posts(full=full)
        print(f'Sync complete: {stats["new"]} new, {stats["updated"]} updated, {stats["errors"]} errors')

    @app.cli.command('set-admin-password')
    @click.argument('password')
    def set_admin_password_cmd(password):
        """Set the admin password."""
        from werkzeug.security import generate_password_hash
        pw_hash = generate_password_hash(password)
        print(f'Add this to your .env file:')
        print(f'ADMIN_PASSWORD_HASH={pw_hash}')

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5002, host='0.0.0.0')
