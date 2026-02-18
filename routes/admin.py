from flask import Blueprint, render_template, session, redirect, url_for, \
    request, flash, current_app, jsonify
from functools import wraps
from models import db
from models.post import FacebookPost
from models.event import Event
from models.site_settings import SiteSettings
from datetime import datetime

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

CATEGORIES = ['alert', 'gallery', 'blog', 'event', 'uncategorized']


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('is_admin'):
            return redirect(url_for('admin.login'))
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        from werkzeug.security import check_password_hash
        password = request.form.get('password', '')
        stored_hash = current_app.config.get('ADMIN_PASSWORD_HASH', '')
        if stored_hash and check_password_hash(stored_hash, password):
            session['is_admin'] = True
            flash('Logged in successfully.', 'success')
            return redirect(url_for('admin.dashboard'))
        flash('Invalid password.', 'danger')
    return render_template('admin/login.html')


@admin_bp.route('/logout')
def logout():
    session.pop('is_admin', None)
    flash('Logged out.', 'info')
    return redirect(url_for('main.index'))


# ── Dashboard ──

@admin_bp.route('/')
@admin_required
def dashboard():
    settings = SiteSettings.query.first()
    total_posts = FacebookPost.query.count()
    total_events = Event.query.count()

    category_counts = {}
    for cat in CATEGORIES:
        category_counts[cat] = FacebookPost.query.filter_by(category=cat).count()

    recent_posts = FacebookPost.query.order_by(
        FacebookPost.published_at.desc()
    ).limit(5).all()

    return render_template('admin/dashboard.html',
                           total_posts=total_posts,
                           total_events=total_events,
                           settings=settings,
                           category_counts=category_counts,
                           recent_posts=recent_posts)


@admin_bp.route('/sync', methods=['POST'])
@admin_required
def sync_now():
    full = request.form.get('full') == '1'
    try:
        from services.facebook_sync import sync_all_posts
        stats = sync_all_posts(full=full)
        flash(f'Sync complete: {stats["new"]} new, {stats["updated"]} updated, '
              f'{stats["errors"]} errors.', 'success')
    except Exception as e:
        flash(f'Sync failed: {e}', 'danger')
    return redirect(url_for('admin.dashboard'))


# ── Post Management ──

@admin_bp.route('/posts')
@admin_required
def posts():
    page = request.args.get('page', 1, type=int)
    category = request.args.get('category', '')

    query = FacebookPost.query

    if category and category in CATEGORIES:
        query = query.filter_by(category=category)

    posts = query.order_by(FacebookPost.published_at.desc()).paginate(
        page=page, per_page=20, error_out=False
    )
    return render_template('admin/posts.html',
                           posts=posts,
                           categories=CATEGORIES,
                           current_category=category)


@admin_bp.route('/posts/<int:post_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_post(post_id):
    post = FacebookPost.query.get_or_404(post_id)

    if request.method == 'POST':
        new_category = request.form.get('category', post.category)
        if new_category in CATEGORIES:
            post.category = new_category
            post.category_override = True

        post.is_featured = request.form.get('is_featured') == '1'
        post.is_hidden = request.form.get('is_hidden') == '1'

        db.session.commit()
        flash('Post updated.', 'success')
        return redirect(url_for('admin.posts'))

    return render_template('admin/edit_post.html',
                           post=post, categories=CATEGORIES)


@admin_bp.route('/posts/<int:post_id>/quick-category', methods=['POST'])
@admin_required
def quick_category(post_id):
    post = FacebookPost.query.get_or_404(post_id)
    new_category = request.form.get('category', '')
    if new_category in CATEGORIES:
        post.category = new_category
        post.category_override = True
        db.session.commit()
        flash(f'Post re-categorized to "{new_category}".', 'success')
    return redirect(request.referrer or url_for('admin.posts'))


@admin_bp.route('/posts/<int:post_id>/toggle-featured', methods=['POST'])
@admin_required
def toggle_featured(post_id):
    post = FacebookPost.query.get_or_404(post_id)
    post.is_featured = not post.is_featured
    db.session.commit()
    status = 'featured' if post.is_featured else 'unfeatured'
    flash(f'Post {status}.', 'success')
    return redirect(request.referrer or url_for('admin.posts'))


@admin_bp.route('/posts/<int:post_id>/toggle-hidden', methods=['POST'])
@admin_required
def toggle_hidden(post_id):
    post = FacebookPost.query.get_or_404(post_id)
    post.is_hidden = not post.is_hidden
    db.session.commit()
    status = 'hidden' if post.is_hidden else 'visible'
    flash(f'Post now {status}.', 'success')
    return redirect(request.referrer or url_for('admin.posts'))


# ── Event Management ──

@admin_bp.route('/events')
@admin_required
def events():
    all_events = Event.query.order_by(Event.event_date.desc()).all()
    return render_template('admin/events.html', events=all_events)


@admin_bp.route('/events/new', methods=['GET', 'POST'])
@admin_required
def new_event():
    if request.method == 'POST':
        event = Event(
            title=request.form.get('title', ''),
            description=request.form.get('description', ''),
            event_date=_parse_form_datetime(request.form.get('event_date', '')),
            end_date=_parse_form_datetime(request.form.get('end_date', '')),
            location=request.form.get('location', ''),
            event_type=request.form.get('event_type', 'workshop'),
            price=request.form.get('price', ''),
            booking_url=request.form.get('booking_url', ''),
            is_published=request.form.get('is_published') == '1',
        )
        db.session.add(event)
        db.session.commit()
        flash('Event created.', 'success')
        return redirect(url_for('admin.events'))

    return render_template('admin/edit_event.html', event=None)


@admin_bp.route('/events/<int:event_id>/edit', methods=['GET', 'POST'])
@admin_required
def edit_event(event_id):
    event = Event.query.get_or_404(event_id)

    if request.method == 'POST':
        event.title = request.form.get('title', event.title)
        event.description = request.form.get('description', '')
        event.event_date = _parse_form_datetime(
            request.form.get('event_date', '')) or event.event_date
        event.end_date = _parse_form_datetime(request.form.get('end_date', ''))
        event.location = request.form.get('location', '')
        event.event_type = request.form.get('event_type', 'workshop')
        event.price = request.form.get('price', '')
        event.booking_url = request.form.get('booking_url', '')
        event.is_published = request.form.get('is_published') == '1'

        db.session.commit()
        flash('Event updated.', 'success')
        return redirect(url_for('admin.events'))

    return render_template('admin/edit_event.html', event=event)


# ── Settings ──

@admin_bp.route('/settings', methods=['GET', 'POST'])
@admin_required
def settings():
    site = SiteSettings.query.first()
    if not site:
        site = SiteSettings(id=1)
        db.session.add(site)
        db.session.commit()

    if request.method == 'POST':
        site.site_name = request.form.get('site_name', site.site_name)
        site.tagline = request.form.get('tagline', site.tagline)
        site.contact_email = request.form.get('contact_email', site.contact_email)
        site.facebook_url = request.form.get('facebook_url', site.facebook_url)
        site.instagram_url = request.form.get('instagram_url', '')
        site.about_text = request.form.get('about_text', '')
        db.session.commit()
        flash('Settings saved.', 'success')
        return redirect(url_for('admin.settings'))

    return render_template('admin/settings.html', settings=site)


def _parse_form_datetime(dt_str):
    """Parse datetime from HTML form input."""
    if not dt_str:
        return None
    try:
        return datetime.strptime(dt_str, '%Y-%m-%dT%H:%M')
    except ValueError:
        try:
            return datetime.strptime(dt_str, '%Y-%m-%d')
        except ValueError:
            return None
