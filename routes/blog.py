from flask import Blueprint, render_template, request, abort
from models.post import FacebookPost

blog_bp = Blueprint('blog', __name__, url_prefix='/blog')


@blog_bp.route('/')
def index():
    page = request.args.get('page', 1, type=int)
    posts = FacebookPost.query.filter_by(
        category='blog', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).paginate(
        page=page, per_page=10, error_out=False
    )
    return render_template('blog/index.html', posts=posts)


@blog_bp.route('/<int:post_id>')
def post(post_id):
    post = FacebookPost.query.get_or_404(post_id)
    if post.is_hidden:
        abort(404)
    return render_template('blog/post.html', post=post)
