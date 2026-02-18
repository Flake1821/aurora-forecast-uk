from flask import Blueprint, render_template
from models.event import Event
from datetime import datetime

events_bp = Blueprint('events', __name__, url_prefix='/events')


@events_bp.route('/')
def index():
    upcoming = Event.query.filter(
        Event.event_date >= datetime.utcnow(),
        Event.is_published == True
    ).order_by(Event.event_date.asc()).all()

    past = Event.query.filter(
        Event.event_date < datetime.utcnow(),
        Event.is_published == True
    ).order_by(Event.event_date.desc()).limit(12).all()

    return render_template('events/index.html',
                           upcoming=upcoming, past=past)


@events_bp.route('/<int:event_id>')
def detail(event_id):
    event = Event.query.get_or_404(event_id)
    return render_template('events/detail.html', event=event)
