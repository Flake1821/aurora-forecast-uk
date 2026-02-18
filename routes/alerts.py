from flask import Blueprint, render_template, abort
from models.post import FacebookPost

alerts_bp = Blueprint('alerts', __name__, url_prefix='/alerts')


@alerts_bp.route('/')
def index():
    page = 1
    posts = FacebookPost.query.filter_by(
        category='alert', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).paginate(
        page=page, per_page=12, error_out=False
    )
    return render_template('alerts/index.html', posts=posts)


@alerts_bp.route('/<int:post_id>')
def detail(post_id):
    post = FacebookPost.query.get_or_404(post_id)
    if post.is_hidden:
        abort(404)
    return render_template('alerts/detail.html', post=post)
