import logging
import requests as http_requests
from flask import Blueprint, render_template, session
from models.post import FacebookPost
from models.event import Event
from datetime import datetime

logger = logging.getLogger(__name__)
main_bp = Blueprint('main', __name__)

# Default location
DEFAULT_LAT = 52.5
DEFAULT_LON = -1.5
DEFAULT_LOCATION = 'Central England'


@main_bp.route('/')
def index():
    # Read user location from session
    lat = session.get('user_lat', DEFAULT_LAT)
    lon = session.get('user_lon', DEFAULT_LON)
    location_name = session.get('user_location', DEFAULT_LOCATION)
    rural_urban = session.get('user_rural_urban', '')
    has_location = 'user_lat' in session

    # Validate RUC code format: England/Wales 'A1'-'F2' or Scotland '1'-'8'
    import re
    if rural_urban and not re.match(r'^([A-F][12]|[1-8])$', rural_urban):
        rural_urban = ''
        session.pop('user_rural_urban', None)

    # If we have a user location but no rural_urban code, try to look it up
    if not rural_urban and has_location:
        try:
            rg = http_requests.get(
                f'https://api.postcodes.io/postcodes?lon={lon}&lat={lat}&limit=1',
                timeout=3
            )
            if rg.status_code == 200:
                rg_data = rg.json()
                if rg_data.get('result') and len(rg_data['result']) > 0:
                    r = rg_data['result'][0]
                    rural_urban = r.get('codes', {}).get('ruc11', '') if isinstance(r.get('codes'), dict) else ''
                    if rural_urban:
                        session['user_rural_urban'] = rural_urban[:5]
        except Exception:
            pass  # Non-critical

    # Fetch live space weather + cloud cover data
    space_weather = {}
    try:
        from services.space_weather import get_current_conditions
        space_weather = get_current_conditions(lat=lat, lon=lon, location_name=location_name,
                                               rural_urban=rural_urban)
    except Exception as e:
        logger.error(f'Failed to fetch space weather for homepage: {e}')

    latest_alerts = FacebookPost.query.filter_by(
        category='alert', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).limit(3).all()

    featured_images = FacebookPost.query.filter_by(
        category='gallery', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).limit(6).all()

    upcoming_events = Event.query.filter(
        Event.event_date >= datetime.utcnow(),
        Event.is_published == True
    ).order_by(Event.event_date.asc()).limit(3).all()

    latest_posts = FacebookPost.query.filter_by(
        is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).limit(4).all()

    return render_template('index.html',
                           space_weather=space_weather,
                           location_name=location_name,
                           location_lat=lat,
                           location_lon=lon,
                           has_location=has_location,
                           latest_alerts=latest_alerts,
                           featured_images=featured_images,
                           upcoming_events=upcoming_events,
                           latest_posts=latest_posts)


@main_bp.route('/about')
def about():
    return render_template('about.html')


@main_bp.route('/contact')
def contact():
    return render_template('contact.html')
