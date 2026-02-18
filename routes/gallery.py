from flask import Blueprint, render_template
from models.post import FacebookPost

gallery_bp = Blueprint('gallery', __name__, url_prefix='/gallery')


@gallery_bp.route('/')
def index():
    posts = FacebookPost.query.filter_by(
        category='gallery', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).all()
    return render_template('gallery/index.html', posts=posts)
