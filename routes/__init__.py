from routes.main import main_bp
from routes.alerts import alerts_bp
from routes.gallery import gallery_bp
from routes.blog import blog_bp
from routes.events import events_bp
from routes.admin import admin_bp
from routes.api import api_bp


def register_blueprints(app):
    app.register_blueprint(main_bp)
    app.register_blueprint(alerts_bp)
    app.register_blueprint(gallery_bp)
    app.register_blueprint(blog_bp)
    app.register_blueprint(events_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(api_bp)
