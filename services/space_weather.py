import json
import logging
import math
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import ephem
import requests
from flask import current_app
from models import db
from models.space_weather import SpaceWeatherReading

logger = logging.getLogger(__name__)

CACHE_SECONDS = 300  # 5 minutes

# NOAA SWPC endpoints (free, no API key)
NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'
NOAA_KP_1MIN_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json'
NOAA_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'

# NOAA SWPC — Solar Wind & IMF (DSCOVR satellite)
NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json'
NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json'
NOAA_SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json'
NOAA_ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json'

# GFZ Potsdam — Hp30 half-hourly geomagnetic index
GFZ_HP30_URL = 'https://kp.gfz.de/app/json/'

# AuroraWatch UK (Lancaster University)
AURORAWATCH_URL = 'https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml'

# Open-Meteo (free, no API key)
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
# UK Met Office models via Open-Meteo — much higher resolution for UK
UKMO_MODEL_2KM = 'ukmo_uk_deterministic_2km'        # 2km UKV, ~2 day range, hourly updates
UKMO_MODEL_SEAMLESS = 'ukmo_seamless'                # Blends 2km near + 10km extended, 7 days

# Default location (Central England) used when user hasn't chosen one
DEFAULT_LAT = 52.5
DEFAULT_LON = -1.5
DEFAULT_LOCATION = 'Central England'

# Latitude → minimum Kp threshold lookup for aurora visibility
_KP_LAT_TABLE = [
    (50.0, 5),   # South England
    (51.5, 5),   # London
    (53.0, 5),   # Manchester, Birmingham
    (54.5, 4),   # Newcastle, Belfast
    (56.0, 3),   # Edinburgh, Glasgow
    (57.5, 3),   # Inverness
    (59.0, 2),   # Northern Highlands
    (60.5, 1),   # Shetland
]


def _kp_threshold_for_latitude(lat):
    """Calculate the minimum Kp needed for aurora at a given UK latitude.

    Uses linear interpolation between known latitude/threshold pairs.
    """
    if lat <= _KP_LAT_TABLE[0][0]:
        return _KP_LAT_TABLE[0][1]
    if lat >= _KP_LAT_TABLE[-1][0]:
        return _KP_LAT_TABLE[-1][1]

    for i in range(len(_KP_LAT_TABLE) - 1):
        lat1, kp1 = _KP_LAT_TABLE[i]
        lat2, kp2 = _KP_LAT_TABLE[i + 1]
        if lat1 <= lat <= lat2:
            frac = (lat - lat1) / (lat2 - lat1)
            return round(kp1 + frac * (kp2 - kp1))

    return 5  # fallback


def get_current_conditions(lat=None, lon=None, location_name=None, rural_urban=''):
    """Get current space weather conditions, using cache if fresh.

    Parameters:
        lat: User's latitude (defaults to Central England)
        lon: User's longitude (defaults to Central England)
        location_name: Display name for the user's location
        rural_urban: RUC11 code from postcodes.io for light pollution estimate
    """
    lat = lat or DEFAULT_LAT
    lon = lon or DEFAULT_LON
    location_name = location_name or DEFAULT_LOCATION

    kp_threshold = _kp_threshold_for_latitude(lat)

    # Location-specific cache key
    cache_key = f'combined_{round(lat, 1)}_{round(lon, 1)}'

    # Check cache first
    cached = SpaceWeatherReading.query.filter_by(
        source=cache_key
    ).order_by(
        SpaceWeatherReading.fetched_at.desc()
    ).first()

    if cached and cached.fetched_at:
        age = (datetime.utcnow() - cached.fetched_at).total_seconds()
        if age < CACHE_SECONDS:
            try:
                data = json.loads(cached.raw_data)
                # Always recalculate light pollution (instant, no API call)
                # because rural_urban may have been resolved after the cache was created
                if rural_urban:
                    data['light_pollution'] = _estimate_bortle(rural_urban)
                return data
            except (json.JSONDecodeError, TypeError):
                pass

    # Fetch fresh data (NOAA + AuroraWatch are UK-wide, not location-specific)
    kp_data = _fetch_noaa_kp()
    aw_data = _fetch_aurorawatch()
    forecast_raw = _fetch_noaa_forecast()
    cloud_cover = _fetch_cloud_cover(lat, lon)

    # Fetch 3-hourly historical Kp once (shared by timeline builder)
    kp_3hourly = _fetch_noaa_kp_3hourly()

    # GFZ Potsdam — Hp30 half-hourly geomagnetic index (30-min resolution)
    hp30_data = _fetch_gfz_hp30()

    # New: solar wind, IMF, NOAA scales, SWPC alerts (all UK-wide)
    solar_wind = _fetch_solar_wind()
    imf_data = _fetch_imf_data()
    noaa_scales = _fetch_noaa_scales()
    swpc_alerts = _fetch_swpc_alerts()

    kp = kp_data.get('current_kp')

    # Moon phase (pure calculation, instant) — computed early so forecast labels can use it
    moon_phase = _calculate_moon_phase()

    # Moonrise/moonset times (location-dependent, ephem calculation)
    moon_rise_set = _calculate_moon_rise_set(lat, lon)
    moon_phase.update(moon_rise_set)

    # Group forecast into 3 days with daily summaries (pass cloud + moon so labels are condition-aware)
    forecast_days = _group_forecast_by_day(forecast_raw, kp_threshold, location_name,
                                           cloud_cover_3day=cloud_cover,
                                           moon_phase=moon_phase)

    # Sunset/sunrise and darkness status (location-dependent, ephem calculation)
    darkness_info = _calculate_darkness_info(lat, lon)

    # Current weather conditions (right now, location-specific)
    current_weather = _fetch_current_weather(lat, lon)

    # Hourly cloud forecast for mini-chart (next 12 hours)
    hourly_cloud = _fetch_hourly_cloud_forecast(lat, lon)

    # Kp timeline for chart (observed + forecast) — uses pre-fetched 3-hourly data
    kp_timeline = _build_kp_timeline(forecast_raw, kp_3hourly)

    # Next predicted Kp value from the timeline
    kp_predicted_result = _extract_next_predicted_kp(kp_timeline)
    kp_predicted_next = kp_predicted_result['kp'] if kp_predicted_result else None
    kp_predicted_hours = kp_predicted_result['hours_ahead'] if kp_predicted_result else None

    # Use the timeline's current-period Kp if the 1-minute API value seems stale.
    # The 1-minute API often returns old or noisy values. The 3-hourly timeline
    # is NOAA's official estimate for the current period and is more reliable.
    current_period_kp = kp_predicted_result.get('current_period_kp') if kp_predicted_result else None
    if current_period_kp is not None:
        kp = current_period_kp

    # Hp30 real-time geomagnetic index (30-min resolution from GFZ Potsdam)
    current_hp30 = hp30_data.get('current_hp30')

    # effective_kp: the higher of Kp and Hp30, for real-time condition assessment.
    # Hp30 captures rapid changes that the 3-hour Kp average smooths out.
    effective_kp = kp
    if current_hp30 is not None and kp is not None:
        effective_kp = max(kp, current_hp30)
    elif current_hp30 is not None:
        effective_kp = current_hp30

    # Novice-friendly labels (use effective_kp so Hp30 surges are reflected)
    kp_severity = _kp_severity_label(effective_kp)

    # Light pollution estimate from location classification
    light_pollution = _estimate_bortle(rural_urban)

    # Composite "should I go outside?" verdict (uses effective_kp so Hp30 surges are reflected)
    go_outside = _go_outside_verdict(
        effective_kp, current_weather, moon_phase, kp_threshold, location_name, imf_data,
        darkness_info, light_pollution=light_pollution
    )

    # Aurora chance — condition-aware (uses effective_kp for real-time accuracy)
    aurora_chance = _aurora_chance_label(
        effective_kp, kp_threshold, location_name,
        current_weather=current_weather,
        darkness_info=darkness_info,
        moon_phase=moon_phase,
        light_pollution=light_pollution,
    )

    # Best viewing window tonight (combines cloud, Kp, darkness)
    best_window = _calculate_best_viewing_window(
        hourly_cloud, kp_timeline, darkness_info, kp_threshold
    )

    # Aurora tonight comprehensive summary (now includes light pollution + Hp30)
    aurora_tonight = _aurora_tonight_summary(
        kp, kp_timeline, darkness_info, current_weather,
        moon_phase, solar_wind, imf_data, hourly_cloud,
        swpc_alerts, kp_threshold, location_name, best_window,
        light_pollution=light_pollution, current_hp30=current_hp30
    )

    combined = {
        'kp_index': kp,
        'kp_timestamp': kp_data.get('timestamp', ''),
        'kp_severity': kp_severity,
        'cornwall_chance': aurora_chance,
        'aurora_chance': aurora_chance,
        'aurorawatch_status': aw_data.get('status', 'unknown'),
        'aurorawatch_message': aw_data.get('message', ''),
        'forecast_3day': forecast_raw,
        'forecast_days': forecast_days,
        'kp_timeline': kp_timeline,
        'kp_predicted_next': kp_predicted_next,
        'kp_predicted_hours': kp_predicted_hours,
        'kp_predicted_severity': _kp_severity_label(kp_predicted_next),
        'cloud_cover_3day': cloud_cover,
        'moon_phase': moon_phase,
        'current_weather': current_weather,
        'go_outside': go_outside,
        'solar_wind': solar_wind,
        'imf_data': imf_data,
        'noaa_scales': noaa_scales,
        'swpc_alerts': swpc_alerts,
        'darkness_info': darkness_info,
        'hourly_cloud_forecast': hourly_cloud,
        'light_pollution': light_pollution,
        'best_viewing_window': best_window,
        'aurora_tonight': aurora_tonight,
        # Hp30 half-hourly index from GFZ Potsdam (30-min resolution)
        'hp30_index': current_hp30,
        'hp30_severity': hp30_data.get('hp30_severity', 'Unknown'),
        'hp30_timestamp': hp30_data.get('hp30_timestamp', ''),
        'hp30_timeline': hp30_data.get('hp30_timeline', []),
        'hp30_peak_24h': hp30_data.get('hp30_peak_24h'),
        'effective_kp': effective_kp,
        # Visibility uses effective_kp (max of Kp, Hp30) for real-time accuracy
        'cornwall_visible': effective_kp is not None and effective_kp >= kp_threshold,
        'aurora_visible': effective_kp is not None and effective_kp >= kp_threshold,
        'cornwall_note': _aurora_visibility_note(effective_kp, kp_threshold, location_name,
                                                current_weather=current_weather,
                                                darkness_info=darkness_info,
                                                moon_phase=moon_phase),
        'aurora_note': _aurora_visibility_note(effective_kp, kp_threshold, location_name,
                                              current_weather=current_weather,
                                              darkness_info=darkness_info,
                                              moon_phase=moon_phase),
        'location_name': location_name,
        'location_lat': lat,
        'location_lon': lon,
        'kp_threshold': kp_threshold,
    }

    # Save to cache
    try:
        reading = SpaceWeatherReading(
            source=cache_key,
            reading_time=datetime.utcnow(),
            kp_index=kp,
            alert_level=aw_data.get('status', 'unknown'),
            raw_data=json.dumps(combined),
            fetched_at=datetime.utcnow(),
        )
        db.session.add(reading)
        db.session.commit()
    except Exception as e:
        logger.error(f'Failed to cache space weather: {e}')
        db.session.rollback()

    return combined


def _fetch_noaa_kp():
    """Fetch current Kp index from NOAA SWPC."""
    try:
        # Try the 1-minute resolution endpoint first
        resp = requests.get(NOAA_KP_1MIN_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if data:
            # Most recent reading is last in the list
            latest = data[-1]
            kp = float(latest.get('kp_index', 0))
            timestamp = latest.get('time_tag', '')
            return {'current_kp': kp, 'timestamp': timestamp}
    except Exception as e:
        logger.warning(f'NOAA 1-min Kp fetch failed: {e}')

    # Fallback to the 3-hourly Kp index
    try:
        resp = requests.get(NOAA_KP_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if len(data) > 1:
            # First row is header, last row is most recent
            latest = data[-1]
            kp = float(latest[1])  # Kp value is the second column
            timestamp = latest[0]
            return {'current_kp': kp, 'timestamp': timestamp}
    except Exception as e:
        logger.warning(f'NOAA 3-hourly Kp fetch failed: {e}')

    return {'current_kp': None, 'timestamp': ''}


def _fetch_noaa_kp_3hourly():
    """Fetch 3-hourly Kp history from NOAA SWPC (shared data, fetched once)."""
    try:
        resp = requests.get(NOAA_KP_URL, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f'NOAA 3-hourly Kp fetch failed: {e}')
        return []


def _hp30_defaults():
    """Return safe defaults when Hp30 data is unavailable."""
    return {
        'current_hp30': None,
        'hp30_severity': 'Unknown',
        'hp30_timestamp': '',
        'hp30_timeline': [],
        'hp30_peak_24h': None,
    }


def _fetch_gfz_hp30():
    """Fetch last 24h of Hp30 half-hourly geomagnetic index from GFZ Potsdam.

    The Hp30 index has 30-minute resolution (48 entries per day) and uses the
    same scale as Kp but is open-ended (can exceed 9 during extreme storms).

    Returns dict with current_hp30, hp30_severity, hp30_timestamp,
    hp30_timeline (list of {time, hp30, type}), hp30_peak_24h.
    """
    try:
        now = datetime.utcnow()
        start = (now - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
        end = now.strftime('%Y-%m-%dT%H:%M:%SZ')

        resp = requests.get(GFZ_HP30_URL, params={
            'start': start,
            'end': end,
            'index': 'Hp30',
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        datetimes = data.get('datetime', [])
        hp30_values = data.get('Hp30', [])

        if not datetimes or not hp30_values or len(datetimes) != len(hp30_values):
            logger.warning('GFZ Hp30: empty or mismatched arrays')
            return _hp30_defaults()

        # Build timeline entries (parallel arrays → list of dicts)
        timeline = []
        for ts, val in zip(datetimes, hp30_values):
            if val is None:
                continue
            try:
                hp30_val = float(val)
                # Normalise: "2024-05-10T00:00:00Z" → "2024-05-10 00:00"
                time_str = ts.replace('T', ' ')[:16]
                timeline.append({
                    'time': time_str,
                    'hp30': round(hp30_val, 2),
                    'type': 'observed',
                })
            except (ValueError, TypeError):
                continue

        if not timeline:
            return _hp30_defaults()

        # Latest entry is current Hp30
        latest = timeline[-1]
        current_hp30 = latest['hp30']
        hp30_timestamp = latest['time']

        # Peak in last 24h
        peak_24h = max(e['hp30'] for e in timeline)

        return {
            'current_hp30': current_hp30,
            'hp30_severity': _kp_severity_label(current_hp30),
            'hp30_timestamp': hp30_timestamp,
            'hp30_timeline': timeline,
            'hp30_peak_24h': round(peak_24h, 2),
        }

    except Exception as e:
        logger.warning(f'GFZ Hp30 fetch failed: {e}')
        return _hp30_defaults()


def _fetch_aurorawatch():
    """Fetch current status from AuroraWatch UK."""
    try:
        resp = requests.get(AURORAWATCH_URL, timeout=10)
        resp.raise_for_status()

        root = ET.fromstring(resp.content)

        # Parse the XML status
        # The XML structure has <current_status> with <site_status> elements
        status_el = root.find('.//site_status')
        if status_el is not None:
            status_id = status_el.get('status_id', 'green').lower()
            # Map numeric/text IDs to color names
            status_map = {
                '1': 'green', 'green': 'green',
                '2': 'yellow', 'yellow': 'yellow',
                '3': 'amber', 'amber': 'amber',
                '4': 'red', 'red': 'red',
            }
            status = status_map.get(status_id, status_id)

            # Get the status message
            message = ''
            desc_el = status_el.find('description')
            if desc_el is not None and desc_el.text:
                message = desc_el.text.strip()

            return {'status': status, 'message': message}

    except Exception as e:
        logger.warning(f'AuroraWatch UK fetch failed: {e}')

    return {'status': 'unknown', 'message': 'Unable to fetch AuroraWatch UK status.'}


def _fetch_noaa_forecast():
    """Fetch 3-day Kp forecast from NOAA."""
    try:
        resp = requests.get(NOAA_FORECAST_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if len(data) > 1:
            # First row is header: ["time_tag", "kp", "observed", "noaa_scale"]
            # Return all forecast entries (up to 3 days = 24 x 3-hour blocks)
            forecast = []
            for row in data[1:]:
                kp_val = None
                try:
                    kp_val = float(row[1]) if row[1] else None
                except (ValueError, TypeError):
                    pass
                forecast.append({
                    'time': row[0],
                    'kp': kp_val,
                    'observed': row[2] if len(row) > 2 else '',
                })
            return forecast
    except Exception as e:
        logger.warning(f'NOAA forecast fetch failed: {e}')

    return []


def _group_forecast_by_day(forecast_entries, kp_threshold=5, location_name='your location',
                           cloud_cover_3day=None, moon_phase=None):
    """Group 3-hourly Kp forecast entries into daily summaries.

    Now accepts cloud_cover_3day (from _fetch_cloud_cover) and moon_phase so that
    forecast chance labels are condition-aware — e.g. won't say "go outside!" when
    overcast or when bright moonlight would reduce visibility.

    Returns list of dicts: [{date, date_label, max_kp, avg_kp, cornwall_note, entries}]
    """
    from collections import defaultdict
    days = defaultdict(list)

    for entry in forecast_entries:
        time_str = entry.get('time', '')
        if not time_str:
            continue
        try:
            dt = datetime.strptime(time_str[:10], '%Y-%m-%d')
            day_key = dt.strftime('%Y-%m-%d')
            days[day_key].append(entry)
        except ValueError:
            continue

    # Build a lookup: date → night cloud avg from cloud_cover_3day
    cloud_by_date = {}
    if cloud_cover_3day:
        for night in cloud_cover_3day:
            cloud_by_date[night.get('date', '')] = night.get('night_avg_cloud')

    # Filter to today onward (NOAA data includes old observed dates)
    today = datetime.now().strftime('%Y-%m-%d')
    future_dates = [d for d in sorted(days.keys()) if d >= today][:3]

    result = []
    for day_key in future_dates:
        entries = days[day_key]
        kp_values = [e['kp'] for e in entries if e['kp'] is not None]
        max_kp = max(kp_values) if kp_values else 0
        avg_kp = sum(kp_values) / len(kp_values) if kp_values else 0

        try:
            dt = datetime.strptime(day_key, '%Y-%m-%d')
            date_label = dt.strftime('%a %d %b')
        except ValueError:
            date_label = day_key

        # Build synthetic weather dict from forecast cloud data for this night
        forecast_cloud = cloud_by_date.get(day_key)
        forecast_weather = {'cloud_cover': forecast_cloud} if forecast_cloud is not None else {}

        # For forecast days: assume dark (it's a night-time forecast) and no
        # darkness blocker. Moon phase is the same for all 3 days (close enough).
        forecast_darkness = {'darkness_status': 'dark'}

        result.append({
            'date': day_key,
            'date_label': date_label,
            'max_kp': round(max_kp, 1),
            'avg_kp': round(avg_kp, 1),
            'kp_severity': _kp_severity_label(max_kp),
            'cornwall_chance': _aurora_chance_label(
                max_kp, kp_threshold, location_name,
                current_weather=forecast_weather,
                darkness_info=forecast_darkness,
                moon_phase=moon_phase,
            ),
            'cornwall_note': _aurora_visibility_note(
                max_kp, kp_threshold, location_name,
                current_weather=forecast_weather,
                darkness_info=forecast_darkness,
                moon_phase=moon_phase,
            ),
            'entries': entries,
        })

    return result


def _fetch_cloud_cover(lat=DEFAULT_LAT, lon=DEFAULT_LON):
    """Fetch 3-day cloud cover forecast from Open-Meteo using Met Office UKMO seamless model.

    Returns night-time summaries (20:00-06:00) for the next 3 nights,
    including high/mid/low cloud layer breakdowns.
    Falls back to generic forecast if UKMO model is unavailable.
    """
    try:
        params = {
            'latitude': lat,
            'longitude': lon,
            'hourly': 'cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low',
            'forecast_days': 4,  # 4 days to cover 3 full nights
            'timezone': 'Europe/London',
            'models': UKMO_MODEL_SEAMLESS,
        }
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()
        except Exception:
            logger.info('UKMO seamless model unavailable for cloud forecast, falling back')
            params.pop('models', None)
            params['hourly'] = 'cloud_cover'
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()

        data = resp.json()

        hourly = data.get('hourly', {})
        times = hourly.get('time', [])
        cloud = hourly.get('cloud_cover', [])
        cloud_high = hourly.get('cloud_cover_high', [])
        cloud_mid = hourly.get('cloud_cover_mid', [])
        cloud_low = hourly.get('cloud_cover_low', [])

        if not times or not cloud:
            return []

        # Build night-time windows: 20:00 to 06:00 next day
        # Group by the evening date (the night "belongs" to the date it starts on)
        from collections import defaultdict
        nights = defaultdict(list)

        for i, time_str in enumerate(times):
            if i >= len(cloud):
                break
            try:
                dt = datetime.strptime(time_str, '%Y-%m-%dT%H:%M')
                hour = dt.hour
                entry = {
                    'hour': dt.strftime('%H:%M'),
                    'cloud_pct': cloud[i],
                    'cloud_high': int(cloud_high[i]) if i < len(cloud_high) and cloud_high[i] is not None else None,
                    'cloud_mid': int(cloud_mid[i]) if i < len(cloud_mid) and cloud_mid[i] is not None else None,
                    'cloud_low': int(cloud_low[i]) if i < len(cloud_low) and cloud_low[i] is not None else None,
                }
                # Night hours: 20-23 belong to that date's night
                # Night hours: 00-06 belong to previous date's night
                if 20 <= hour <= 23:
                    night_date = dt.strftime('%Y-%m-%d')
                    nights[night_date].append(entry)
                elif 0 <= hour <= 6:
                    prev_date = (dt - timedelta(days=1)).strftime('%Y-%m-%d')
                    nights[prev_date].append(entry)
            except ValueError:
                continue

        # Build summaries for the next 3 nights
        today = datetime.now().strftime('%Y-%m-%d')
        result = []
        for day_offset in range(3):
            night_date = (datetime.now() + timedelta(days=day_offset)).strftime('%Y-%m-%d')
            hours = nights.get(night_date, [])

            if hours:
                pcts = [h['cloud_pct'] for h in hours]
                avg_cloud = round(sum(pcts) / len(pcts))
                min_cloud = min(pcts)
                # Cloud layer averages
                high_vals = [h['cloud_high'] for h in hours if h.get('cloud_high') is not None]
                mid_vals = [h['cloud_mid'] for h in hours if h.get('cloud_mid') is not None]
                low_vals = [h['cloud_low'] for h in hours if h.get('cloud_low') is not None]
                avg_high = round(sum(high_vals) / len(high_vals)) if high_vals else None
                avg_mid = round(sum(mid_vals) / len(mid_vals)) if mid_vals else None
                avg_low = round(sum(low_vals) / len(low_vals)) if low_vals else None
            else:
                avg_cloud = None
                min_cloud = None
                avg_high = None
                avg_mid = None
                avg_low = None

            # Determine cloud description and icon
            if avg_cloud is None:
                desc = 'No data'
                icon = 'question-circle'
            elif avg_cloud <= 15:
                desc = 'Clear skies'
                icon = 'moon-stars'
            elif avg_cloud <= 30:
                desc = 'Mostly clear'
                icon = 'moon-stars'
            elif avg_cloud <= 55:
                desc = 'Partly cloudy'
                icon = 'cloud-moon'
            elif avg_cloud <= 80:
                desc = 'Mostly cloudy'
                icon = 'clouds'
            else:
                desc = 'Overcast'
                icon = 'cloud-fill'

            try:
                dt = datetime.strptime(night_date, '%Y-%m-%d')
                date_label = dt.strftime('%a %d %b')
            except ValueError:
                date_label = night_date

            # Novice-friendly viewing label
            if avg_cloud is None:
                viewing_label = 'No data available'
                viewing_level = 'unknown'
            elif avg_cloud <= 25:
                viewing_label = 'Excellent for viewing'
                viewing_level = 'good'
            elif avg_cloud <= 50:
                viewing_label = 'Good for viewing'
                viewing_level = 'good'
            elif avg_cloud <= 75:
                viewing_label = 'Fair — gaps in cloud possible'
                viewing_level = 'fair'
            else:
                viewing_label = 'Poor visibility'
                viewing_level = 'poor'

            result.append({
                'date': night_date,
                'date_label': date_label,
                'night_avg_cloud': avg_cloud,
                'night_min_cloud': min_cloud,
                'night_avg_cloud_high': avg_high,
                'night_avg_cloud_mid': avg_mid,
                'night_avg_cloud_low': avg_low,
                'description': desc,
                'icon': icon,
                'viewing_label': viewing_label,
                'viewing_level': viewing_level,
                'night_hours': hours,
            })

        return result

    except Exception as e:
        logger.warning(f'Open-Meteo cloud cover fetch failed: {e}')
        return []


def _calculate_moon_phase():
    """Calculate current moon phase using synodic month period.

    Uses a known new moon reference date and the synodic month (29.53059 days)
    to determine the current phase. Pure calculation — no API needed.
    """
    # Known new moon: January 6, 2000 18:14 UTC
    known_new_moon = datetime(2000, 1, 6, 18, 14, 0)
    synodic_month = 29.53058867

    now = datetime.utcnow()
    diff = (now - known_new_moon).total_seconds() / 86400.0
    cycles = diff / synodic_month
    phase_fraction = cycles % 1.0  # 0.0 = new moon, 0.5 = full moon

    # Illumination: 0% at new moon, 100% at full moon
    illumination = round((1 - math.cos(2 * math.pi * phase_fraction)) / 2 * 100)

    # Phase name and emoji
    PHASES = [
        (0.0625,  'New Moon',         '\U0001F311'),
        (0.1875,  'Waxing Crescent',  '\U0001F312'),
        (0.3125,  'First Quarter',    '\U0001F313'),
        (0.4375,  'Waxing Gibbous',   '\U0001F314'),
        (0.5625,  'Full Moon',         '\U0001F315'),
        (0.6875,  'Waning Gibbous',   '\U0001F316'),
        (0.8125,  'Last Quarter',     '\U0001F317'),
        (0.9375,  'Waning Crescent',  '\U0001F318'),
        (1.0001,  'New Moon',         '\U0001F311'),
    ]

    phase_name = 'New Moon'
    emoji = '\U0001F311'
    for threshold, name, em in PHASES:
        if phase_fraction < threshold:
            phase_name = name
            emoji = em
            break

    # Viewing conditions — low moon is good for faint aurora / stargazing
    is_favorable = illumination < 40

    if illumination > 70:
        note = 'Bright moon \u2014 may wash out faint aurora'
    elif illumination > 40:
        note = 'Moderate moonlight \u2014 aurora needs to be bright'
    else:
        note = 'Dark skies \u2014 good for faint aurora'

    return {
        'phase_name': phase_name,
        'illumination': illumination,
        'phase_fraction': round(phase_fraction, 4),
        'emoji': emoji,
        'is_favorable': is_favorable,
        'note': note,
    }


def _calculate_moon_rise_set(lat, lon):
    """Calculate next moonrise and moonset times for a given location.

    Uses the PyEphem library for accurate astronomical calculations.
    Returns times in local UK time (Europe/London timezone).
    """
    try:
        observer = ephem.Observer()
        observer.lat = str(lat)
        observer.lon = str(lon)
        observer.elevation = 50  # Average UK elevation in metres
        observer.pressure = 0    # Disable atmospheric refraction for simplicity
        observer.horizon = '0'

        now = datetime.utcnow()
        observer.date = now

        moon = ephem.Moon()
        uk_tz = ZoneInfo('Europe/London')

        result = {'moonrise': None, 'moonset': None}

        try:
            next_rise = observer.next_rising(moon)
            rise_utc = ephem.Date(next_rise).datetime()
            rise_local = rise_utc.replace(tzinfo=ZoneInfo('UTC')).astimezone(uk_tz)
            result['moonrise'] = rise_local.strftime('%H:%M')
        except (ephem.AlwaysUpError, ephem.NeverUpError):
            pass

        try:
            next_set = observer.next_setting(moon)
            set_utc = ephem.Date(next_set).datetime()
            set_local = set_utc.replace(tzinfo=ZoneInfo('UTC')).astimezone(uk_tz)
            result['moonset'] = set_local.strftime('%H:%M')
        except (ephem.AlwaysUpError, ephem.NeverUpError):
            pass

        return result
    except Exception as e:
        logger.warning(f'Moon rise/set calculation failed: {e}')
        return {'moonrise': None, 'moonset': None}


def _calculate_darkness_info(lat, lon):
    """Calculate sunset, sunrise, and current darkness status.

    Uses PyEphem to determine sun position and twilight phases.
    Returns times in UK local time (Europe/London).
    """
    try:
        observer = ephem.Observer()
        observer.lat = str(lat)
        observer.lon = str(lon)
        observer.elevation = 50
        observer.pressure = 0

        now = datetime.utcnow()
        observer.date = now
        sun = ephem.Sun()
        uk_tz = ZoneInfo('Europe/London')

        result = {
            'sunset': None,
            'sunrise': None,
            'darkness_status': 'unknown',
            'darkness_label': 'Unknown',
            'is_dark_enough': False,
        }

        # Sunset / Sunrise (standard horizon)
        observer.horizon = '0'
        try:
            next_set = observer.next_setting(sun)
            set_local = ephem.Date(next_set).datetime().replace(
                tzinfo=ZoneInfo('UTC')).astimezone(uk_tz)
            result['sunset'] = set_local.strftime('%H:%M')
        except (ephem.AlwaysUpError, ephem.NeverUpError):
            pass

        try:
            next_rise = observer.next_rising(sun)
            rise_local = ephem.Date(next_rise).datetime().replace(
                tzinfo=ZoneInfo('UTC')).astimezone(uk_tz)
            result['sunrise'] = rise_local.strftime('%H:%M')
        except (ephem.AlwaysUpError, ephem.NeverUpError):
            pass

        # Determine current sun altitude for darkness status
        sun.compute(observer)
        sun_alt_deg = float(sun.alt) * 180.0 / math.pi

        if sun_alt_deg > 0:
            result['darkness_status'] = 'daylight'
            result['darkness_label'] = 'Daylight \u2014 aurora not visible'
            result['is_dark_enough'] = False
        elif sun_alt_deg > -6:
            result['darkness_status'] = 'civil_twilight'
            result['darkness_label'] = 'Civil twilight \u2014 too bright'
            result['is_dark_enough'] = False
        elif sun_alt_deg > -12:
            result['darkness_status'] = 'nautical_twilight'
            result['darkness_label'] = 'Nautical twilight \u2014 getting dark'
            result['is_dark_enough'] = True
        elif sun_alt_deg > -18:
            result['darkness_status'] = 'astronomical_twilight'
            result['darkness_label'] = 'Nearly full dark'
            result['is_dark_enough'] = True
        else:
            result['darkness_status'] = 'dark'
            result['darkness_label'] = 'Full darkness \u2014 ideal'
            result['is_dark_enough'] = True

        return result

    except Exception as e:
        logger.warning(f'Darkness calculation failed: {e}')
        return {
            'sunset': None, 'sunrise': None,
            'darkness_status': 'unknown',
            'darkness_label': 'Unable to calculate',
            'is_dark_enough': False,
        }


def _build_kp_timeline(forecast_raw, kp_3hourly=None):
    """Build a combined observed + predicted Kp timeline for charting.

    Merges last 48h of observed 3-hourly Kp with the forecast data.
    Uses pre-fetched kp_3hourly data to avoid redundant API calls.
    Returns a list of {time, kp, type} sorted by time.
    """
    timeline = []

    # 1) Parse historical 3-hourly data (pre-fetched, no extra API call)
    data = kp_3hourly or []
    if len(data) > 1:
        cutoff = (datetime.utcnow() - timedelta(hours=48)).strftime('%Y-%m-%d')
        for row in data[1:]:
            try:
                if row[0][:10] >= cutoff:
                    kp_val = float(row[1])
                    timeline.append({
                        'time': row[0][:16],
                        'kp': round(kp_val, 1),
                        'type': 'observed',
                    })
            except (ValueError, TypeError, IndexError):
                pass

    # 2) Add forecast entries (estimated + predicted)
    seen_times = {e['time'] for e in timeline}
    for entry in forecast_raw:
        time_str = entry.get('time', '')[:16]
        if time_str and time_str not in seen_times:
            obs = entry.get('observed', '')
            entry_type = 'observed' if obs == 'observed' else (
                'estimated' if obs == 'estimated' else 'predicted')
            if entry.get('kp') is not None:
                timeline.append({
                    'time': time_str,
                    'kp': round(entry['kp'], 1),
                    'type': entry_type,
                })
                seen_times.add(time_str)

    # Sort by time
    timeline.sort(key=lambda x: x['time'])
    return timeline


def _extract_next_predicted_kp(kp_timeline):
    """Find the next predicted/estimated Kp value from the timeline.

    NOAA Kp data comes in 3-hour blocks (00, 03, 06, 09, 12, 15, 18, 21 UTC).
    Each timestamp marks the START of a 3-hour period.

    Returns a dict with:
      - kp: the predicted Kp value for the next 3-hour period
      - hours_ahead: hours until that period starts
      - current_period_kp: the Kp for the period covering NOW (if available)
    """
    now = datetime.utcnow()
    now_str = now.strftime('%Y-%m-%d %H:%M')

    current_period_kp = None
    next_predicted = None

    for i, entry in enumerate(kp_timeline):
        try:
            entry_dt = datetime.strptime(entry['time'], '%Y-%m-%d %H:%M')
        except ValueError:
            continue

        # Check if this entry's 3-hour window covers NOW
        # (entry starts at entry_dt, covers until entry_dt + 3h)
        period_end = entry_dt + timedelta(hours=3)
        if entry_dt <= now < period_end:
            current_period_kp = entry['kp']

        # Find the first entry that starts AFTER now with predicted/estimated type
        if entry_dt > now and entry['type'] in ('predicted', 'estimated') and next_predicted is None:
            hours_ahead = max(1, round((entry_dt - now).total_seconds() / 3600))
            next_predicted = {
                'kp': entry['kp'],
                'hours_ahead': hours_ahead,
                'current_period_kp': current_period_kp,
            }

    # If we found a next prediction, return it with the current period info
    if next_predicted:
        if next_predicted['current_period_kp'] is None:
            next_predicted['current_period_kp'] = current_period_kp
        return next_predicted

    # Fallback: no future predictions found
    if current_period_kp is not None:
        return {'kp': None, 'hours_ahead': None, 'current_period_kp': current_period_kp}

    return None


def _kp_severity_label(kp):
    """Return a plain-English severity label for a Kp value."""
    if kp is None:
        return 'Unknown'
    elif kp >= 8:
        return 'Extreme storm'
    elif kp >= 7:
        return 'Strong storm'
    elif kp >= 5:
        return 'Geomagnetic storm'
    elif kp >= 4:
        return 'Unsettled'
    elif kp >= 3:
        return 'Active'
    elif kp >= 2:
        return 'Quiet'
    else:
        return 'Very quiet'


def _aurora_chance_label(kp, kp_threshold=5, location_name='your location',
                         current_weather=None, darkness_info=None,
                         moon_phase=None, light_pollution=None):
    """Return a novice-friendly aurora chance label that considers ALL conditions.

    Takes into account: Kp margin, cloud cover, darkness status, moon phase,
    and light pollution (Bortle scale).
    Only says 'go outside' when conditions genuinely support it.
    """
    if kp is None:
        return {'text': 'Unknown', 'level': 'unknown'}

    margin = kp - kp_threshold
    current_weather = current_weather or {}
    darkness_info = darkness_info or {}
    moon_phase = moon_phase or {}
    light_pollution = light_pollution or {}

    cloud = current_weather.get('cloud_cover')
    dark_status = darkness_info.get('darkness_status', 'unknown')
    moon_illum = moon_phase.get('illumination', 0)
    bortle = light_pollution.get('bortle', 5)

    # Determine the Kp-based aurora potential first
    if margin >= 2:
        kp_potential = 'excellent'
    elif margin >= 1:
        kp_potential = 'good'
    elif margin >= 0:
        kp_potential = 'possible'
    elif margin >= -1:
        kp_potential = 'unlikely'
    elif margin >= -2:
        kp_potential = 'very_unlikely'
    else:
        kp_potential = 'none'

    # If aurora potential is none/very unlikely, conditions don't matter
    if kp_potential == 'none':
        return {'text': 'No chance', 'level': 'none'}
    if kp_potential == 'very_unlikely':
        return {'text': 'Very unlikely', 'level': 'low'}
    if kp_potential == 'unlikely':
        if bortle >= 7:
            return {'text': 'Unlikely \u2014 too much light pollution here', 'level': 'low'}
        return {'text': 'Unlikely \u2014 faint glow from very dark sites', 'level': 'low'}

    # Aurora IS possible (margin >= 0) — now check real conditions
    # Blocker: daylight
    if dark_status in ('daylight', 'civil_twilight'):
        sunset = darkness_info.get('sunset', '')
        return {'text': f'Possible after dark ({sunset})', 'level': 'medium'}

    # Blocker: heavy cloud
    if cloud is not None and cloud >= 90:
        return {'text': 'Possible \u2014 but overcast', 'level': 'medium'}
    if cloud is not None and cloud >= 70:
        return {'text': 'Possible \u2014 heavy cloud', 'level': 'medium'}

    # Conditions are favourable (dark + clearish skies) — rate by Kp potential
    # Adjust for bright moon (only meaningful for faint aurora)
    bright_moon = moon_illum > 70

    if kp_potential == 'excellent':
        if bright_moon:
            return {'text': 'Likely visible \u2014 bright moon may wash out faint detail',
                    'level': 'high'}
        if bortle >= 7:
            return {'text': 'Likely visible \u2014 get away from city lights!',
                    'level': 'high'}
        return {'text': 'Likely visible \u2014 go outside!', 'level': 'high'}

    if kp_potential == 'good':
        if bright_moon:
            return {'text': 'Good chance \u2014 find a spot away from moonlight',
                    'level': 'high'}
        if bortle >= 7:
            return {'text': 'Good chance \u2014 drive to a darker area if possible',
                    'level': 'high'}
        return {'text': 'Good chance \u2014 find a dark spot', 'level': 'high'}

    # kp_potential == 'possible' (margin 0–1)
    if cloud is not None and cloud >= 50:
        return {'text': 'Possible \u2014 watch for gaps in cloud', 'level': 'medium'}
    if bright_moon:
        return {'text': 'Possible \u2014 bright moon may reduce visibility',
                'level': 'medium'}
    if bortle >= 7:
        return {'text': 'Possible \u2014 but light pollution makes it hard from here',
                'level': 'medium'}
    return {'text': 'Possible \u2014 check the northern horizon', 'level': 'medium'}


def _aurora_visibility_note(kp, kp_threshold=5, location_name='your location',
                            current_weather=None, darkness_info=None,
                            moon_phase=None):
    """Generate location-specific aurora visibility note.

    Considers Kp margin AND real conditions (cloud cover, darkness, moon phase).
    Uses accurate NOAA Kp scale language.
    """
    if kp is None:
        return 'Unable to determine current conditions.'

    current_weather = current_weather or {}
    darkness_info = darkness_info or {}
    moon_phase = moon_phase or {}
    margin = kp - kp_threshold
    cloud = current_weather.get('cloud_cover')
    dark_status = darkness_info.get('darkness_status', 'unknown')
    moon_illum = moon_phase.get('illumination', 0)

    # NOAA storm descriptor
    if kp >= 8:
        storm_desc = 'Extreme storm'
    elif kp >= 7:
        storm_desc = 'Strong storm'
    elif kp >= 5:
        storm_desc = 'Geomagnetic storm'
    elif kp >= 4:
        storm_desc = 'Unsettled'
    elif kp >= 3:
        storm_desc = 'Active'
    elif kp >= 2:
        storm_desc = 'Quiet'
    else:
        storm_desc = 'Very quiet'

    # Below threshold — conditions don't matter
    if margin < -1:
        return f'{storm_desc} \u2014 aurora not expected from {location_name}.'
    if margin < 0:
        return f'{storm_desc} \u2014 unlikely from {location_name}, possible faint glow from very dark sites.'

    # Aurora IS possible — check blockers
    if dark_status in ('daylight', 'civil_twilight'):
        sunset = darkness_info.get('sunset', '')
        if margin >= 2:
            return f'{storm_desc} \u2014 aurora likely after dark. Sunset at {sunset}.'
        return f'{storm_desc} \u2014 aurora possible after sunset ({sunset}).'

    if cloud is not None and cloud >= 90:
        if margin >= 2:
            return f'{storm_desc} \u2014 aurora likely but overcast. Check back if skies clear.'
        return f'{storm_desc} \u2014 aurora possible but completely overcast.'

    if cloud is not None and cloud >= 70:
        if margin >= 2:
            return f'{storm_desc} \u2014 aurora likely from {location_name} but heavy cloud.'
        return f'{storm_desc} \u2014 aurora possible from {location_name} but cloudy.'

    # Good conditions (dark + clearish) — now also consider moon
    bright_moon = moon_illum > 70

    if margin >= 3:
        if bright_moon:
            return f'{storm_desc} \u2014 aurora likely visible from {location_name}! Bright moon may reduce contrast.'
        return f'{storm_desc} \u2014 aurora likely visible overhead from {location_name}!'
    elif margin >= 2:
        if bright_moon:
            return f'{storm_desc} \u2014 aurora likely from {location_name} but bright moon may wash out faint detail.'
        return f'{storm_desc} \u2014 aurora likely visible from {location_name} with clear skies.'
    elif margin >= 1:
        if bright_moon:
            return f'{storm_desc} \u2014 good chance from {location_name}. Find a dark spot away from moonlight.'
        return f'{storm_desc} \u2014 good chance of aurora from dark sites near {location_name}.'
    else:
        if bright_moon:
            return f'{storm_desc} \u2014 aurora may be visible from {location_name} but bright moon will reduce contrast.'
        return f'{storm_desc} \u2014 aurora may be visible low on the northern horizon from {location_name}.'


def _wind_speed_classification(speed_kmh):
    """Classify wind speed into categories for display and rain angle."""
    if speed_kmh is None:
        return {'label': 'No data', 'level': 'unknown'}
    if speed_kmh < 5:
        return {'label': 'Calm', 'level': 'calm'}
    elif speed_kmh < 20:
        return {'label': 'Light breeze', 'level': 'light'}
    elif speed_kmh < 40:
        return {'label': 'Moderate wind', 'level': 'moderate'}
    elif speed_kmh < 60:
        return {'label': 'Strong wind', 'level': 'strong'}
    else:
        return {'label': 'Gale force', 'level': 'gale'}


def _wind_direction_compass(degrees):
    """Convert wind direction in degrees to compass text."""
    if degrees is None:
        return ''
    dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = round(degrees / 45) % 8
    return dirs[idx]


def _weather_code_to_description(code):
    """Map WMO weather code to (description, bootstrap_icon)."""
    WMO_MAP = {
        0: ('Clear sky', 'moon-stars'),
        1: ('Mainly clear', 'moon-stars'),
        2: ('Partly cloudy', 'cloud-moon'),
        3: ('Overcast', 'cloud-fill'),
        45: ('Fog', 'cloud-fog'),
        48: ('Rime fog', 'cloud-fog'),
        51: ('Light drizzle', 'cloud-drizzle'),
        53: ('Drizzle', 'cloud-drizzle'),
        55: ('Dense drizzle', 'cloud-drizzle'),
        61: ('Slight rain', 'cloud-rain'),
        63: ('Moderate rain', 'cloud-rain'),
        65: ('Heavy rain', 'cloud-rain-heavy'),
        71: ('Slight snow', 'cloud-snow'),
        73: ('Moderate snow', 'cloud-snow'),
        75: ('Heavy snow', 'cloud-snow'),
        77: ('Snow grains', 'cloud-snow'),
        80: ('Slight showers', 'cloud-rain'),
        81: ('Moderate showers', 'cloud-rain'),
        82: ('Violent showers', 'cloud-rain-heavy'),
        85: ('Slight snow showers', 'cloud-snow'),
        86: ('Heavy snow showers', 'cloud-snow'),
        95: ('Thunderstorm', 'cloud-lightning-rain'),
        96: ('Thunderstorm + hail', 'cloud-lightning-rain'),
        99: ('Thunderstorm + heavy hail', 'cloud-lightning-rain'),
    }
    if code is None:
        return ('Unknown', 'question-circle')
    return WMO_MAP.get(code, ('Unknown', 'question-circle'))


def _fetch_current_weather(lat=DEFAULT_LAT, lon=DEFAULT_LON):
    """Fetch current weather conditions from Open-Meteo using Met Office UKMO 2km model.

    Returns dict with cloud_cover (total + high/mid/low layers), temperature,
    weather_code, weather_description, weather_icon, visibility_km.
    Falls back to generic forecast if UKMO model is unavailable.
    """
    default = {
        'cloud_cover': None,
        'cloud_cover_high': None,
        'cloud_cover_mid': None,
        'cloud_cover_low': None,
        'cloud_label': 'No data',
        'cloud_level': 'unknown',
        'cloud_model': '',
        'temperature': None,
        'weather_code': None,
        'weather_description': 'Unknown',
        'weather_icon': 'question-circle',
        'visibility_km': None,
        'wind_speed': None,
        'wind_direction': None,
        'wind_direction_compass': '',
        'wind_gusts': None,
        'wind_classification': {'label': 'No data', 'level': 'unknown'},
        'timestamp': '',
    }
    try:
        params = {
            'latitude': lat,
            'longitude': lon,
            'current': 'cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low,temperature_2m,weather_code,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
            'timezone': 'Europe/London',
            'models': UKMO_MODEL_2KM,
        }
        cloud_model = 'Met Office UKV 2km'
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()
        except Exception:
            # UKMO model unavailable — fall back to generic forecast
            logger.info('UKMO 2km model unavailable, falling back to generic forecast')
            params.pop('models', None)
            params['current'] = 'cloud_cover,temperature_2m,weather_code,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
            cloud_model = ''
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()

        data = resp.json()

        current = data.get('current', {})
        cloud = current.get('cloud_cover')
        cloud_high = current.get('cloud_cover_high')
        cloud_mid = current.get('cloud_cover_mid')
        cloud_low = current.get('cloud_cover_low')
        temp = current.get('temperature_2m')
        weather_code = current.get('weather_code')
        visibility = current.get('visibility')
        wind_speed = current.get('wind_speed_10m')
        wind_direction = current.get('wind_direction_10m')
        wind_gusts = current.get('wind_gusts_10m')

        # Convert visibility from metres to km
        visibility_km = round(visibility / 1000, 1) if visibility else None

        # Map weather code to description + icon
        desc, icon = _weather_code_to_description(weather_code)

        # Cloud cover novice label
        if cloud is None:
            cloud_label = 'No data'
            cloud_level = 'unknown'
        elif cloud <= 15:
            cloud_label = 'Clear skies'
            cloud_level = 'good'
        elif cloud <= 30:
            cloud_label = 'Mostly clear'
            cloud_level = 'good'
        elif cloud <= 55:
            cloud_label = 'Partly cloudy'
            cloud_level = 'fair'
        elif cloud <= 80:
            cloud_label = 'Mostly cloudy'
            cloud_level = 'poor'
        else:
            cloud_label = 'Overcast'
            cloud_level = 'poor'

        return {
            'cloud_cover': cloud,
            'cloud_cover_high': round(cloud_high) if cloud_high is not None else None,
            'cloud_cover_mid': round(cloud_mid) if cloud_mid is not None else None,
            'cloud_cover_low': round(cloud_low) if cloud_low is not None else None,
            'cloud_label': cloud_label,
            'cloud_level': cloud_level,
            'cloud_model': cloud_model,
            'temperature': temp,
            'weather_code': weather_code,
            'weather_description': desc,
            'weather_icon': icon,
            'visibility_km': visibility_km,
            'wind_speed': round(wind_speed, 1) if wind_speed is not None else None,
            'wind_direction': round(wind_direction) if wind_direction is not None else None,
            'wind_direction_compass': _wind_direction_compass(wind_direction),
            'wind_gusts': round(wind_gusts, 1) if wind_gusts is not None else None,
            'wind_classification': _wind_speed_classification(wind_speed),
            'timestamp': current.get('time', ''),
        }
    except Exception as e:
        logger.warning(f'Open-Meteo current weather fetch failed: {e}')
        return default


def _fetch_hourly_cloud_forecast(lat, lon):
    """Fetch next 12 hours of hourly cloud cover using Met Office UKMO 2km model.

    Returns list of {hour, cloud_pct, cloud_high, cloud_mid, cloud_low}.
    Falls back to generic forecast if UKMO model is unavailable.
    """
    try:
        params = {
            'latitude': lat,
            'longitude': lon,
            'hourly': 'cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low',
            'forecast_hours': 12,
            'timezone': 'Europe/London',
            'models': UKMO_MODEL_2KM,
        }
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()
        except Exception:
            logger.info('UKMO 2km model unavailable for hourly forecast, falling back')
            params.pop('models', None)
            params['hourly'] = 'cloud_cover'
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=10)
            resp.raise_for_status()

        data = resp.json()

        hourly = data.get('hourly', {})
        times = hourly.get('time', [])
        cloud = hourly.get('cloud_cover', [])
        cloud_high = hourly.get('cloud_cover_high', [])
        cloud_mid = hourly.get('cloud_cover_mid', [])
        cloud_low = hourly.get('cloud_cover_low', [])

        result = []
        for i, time_str in enumerate(times):
            if i >= len(cloud) or i >= 12:
                break
            try:
                dt = datetime.strptime(time_str, '%Y-%m-%dT%H:%M')
                result.append({
                    'hour': dt.strftime('%H:%M'),
                    'cloud_pct': int(cloud[i]) if cloud[i] is not None else 0,
                    'cloud_high': int(cloud_high[i]) if i < len(cloud_high) and cloud_high[i] is not None else None,
                    'cloud_mid': int(cloud_mid[i]) if i < len(cloud_mid) and cloud_mid[i] is not None else None,
                    'cloud_low': int(cloud_low[i]) if i < len(cloud_low) and cloud_low[i] is not None else None,
                })
            except (ValueError, TypeError):
                continue

        return result
    except Exception as e:
        logger.warning(f'Hourly cloud forecast fetch failed: {e}')
        return []


# In-memory cache for cloud grid data (location-independent)
_cloud_grid_cache = {'data': None, 'timestamp': 0}

def _fetch_cloud_grid():
    """Fetch cloud cover + wind grid for aurora map overlay.

    Returns a 6×8 grid of 48 points covering 40-72°N, -30 to +30°E.
    Each point has 12 hours of cloud_cover, wind_speed, wind_direction.
    Uses UKMO seamless model with fallback to generic.
    Cached for 30 minutes (grid is location-independent).
    """
    import time as _time

    # Check cache (30 minutes = 1800 seconds)
    now = _time.time()
    if _cloud_grid_cache['data'] and (now - _cloud_grid_cache['timestamp']) < 1800:
        return _cloud_grid_cache['data']

    grid_lats = [42, 48, 54, 58, 62, 68]
    grid_lons = [-27, -19, -11, -3, 5, 13, 21, 29]

    # Open-Meteo requires paired lat/lon arrays of equal length
    # Generate all 48 combinations (6 lats × 8 lons)
    all_lats = []
    all_lons = []
    for lat in grid_lats:
        for lon in grid_lons:
            all_lats.append(str(lat))
            all_lons.append(str(lon))

    lat_str = ','.join(all_lats)
    lon_str = ','.join(all_lons)

    params = {
        'latitude': lat_str,
        'longitude': lon_str,
        'hourly': 'cloud_cover,wind_speed_10m,wind_direction_10m',
        'forecast_hours': 12,
        'timezone': 'UTC',
        'models': UKMO_MODEL_SEAMLESS,
    }

    try:
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=15)
            resp.raise_for_status()
        except Exception:
            logger.info('UKMO seamless unavailable for cloud grid, falling back to generic')
            params.pop('models', None)
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=15)
            resp.raise_for_status()

        raw = resp.json()

        # Open-Meteo multi-location returns a list of objects
        # Each element corresponds to one (lat, lon) pair
        if not isinstance(raw, list):
            raw = [raw]

        grid = []
        for i, entry in enumerate(raw):
            lat = entry.get('latitude', grid_lats[i] if i < len(grid_lats) else 0)
            lon = entry.get('longitude', grid_lons[i] if i < len(grid_lons) else 0)
            hourly = entry.get('hourly', {})
            times = hourly.get('time', [])
            clouds = hourly.get('cloud_cover', [])
            winds = hourly.get('wind_speed_10m', [])
            dirs = hourly.get('wind_direction_10m', [])

            hours = []
            for h in range(min(12, len(times))):
                hours.append({
                    'hour_offset': h,
                    'time': times[h] if h < len(times) else '',
                    'cloud_cover': int(clouds[h]) if h < len(clouds) and clouds[h] is not None else 0,
                    'wind_speed': round(float(winds[h]), 1) if h < len(winds) and winds[h] is not None else 0,
                    'wind_direction': int(dirs[h]) if h < len(dirs) and dirs[h] is not None else 0,
                })

            grid.append({
                'lat': lat,
                'lon': lon,
                'hours': hours,
            })

        result = {
            'grid': grid,
            'grid_lats': grid_lats,
            'grid_lons': grid_lons,
            'generated_at': datetime.utcnow().isoformat() + 'Z',
        }

        _cloud_grid_cache['data'] = result
        _cloud_grid_cache['timestamp'] = now
        return result

    except Exception as e:
        logger.warning(f'Cloud grid fetch failed: {e}')
        # Return cached data if available, else empty
        if _cloud_grid_cache['data']:
            return _cloud_grid_cache['data']
        return {'grid': [], 'grid_lats': grid_lats, 'grid_lons': grid_lons, 'error': str(e)}


def _go_outside_verdict(kp, current_weather, moon_phase, kp_threshold=5,
                        location_name='your location', imf_data=None,
                        darkness_info=None, light_pollution=None):
    """Generate a composite 'should I go outside?' verdict.

    Combines Kp index, current cloud cover, moon phase, weather, IMF Bz,
    darkness status, and light pollution into a single novice-friendly recommendation.

    Returns: {verdict: str, level: 'yes'|'maybe'|'no', reasons: [str]}
    """
    cloud = current_weather.get('cloud_cover')
    weather_code = current_weather.get('weather_code')
    moon_illum = moon_phase.get('illumination', 50)
    imf_data = imf_data or {}
    darkness_info = darkness_info or {}
    light_pollution = light_pollution or {}

    reasons = []
    score = 0  # Higher = better for viewing

    # Helper: NOAA severity descriptor for the actual Kp value
    def _kp_desc(val):
        if val >= 8: return 'Extreme storm'
        if val >= 7: return 'Strong storm'
        if val >= 5: return 'Geomagnetic storm'
        if val >= 4: return 'Unsettled'
        if val >= 3: return 'Active'
        if val >= 2: return 'Quiet'
        return 'Very quiet'

    # ── Daylight blocker — aurora is invisible in daylight ──
    dark_status = darkness_info.get('darkness_status', 'unknown')
    if dark_status in ('daylight', 'civil_twilight'):
        sunset = darkness_info.get('sunset', '??')
        reasons.append('It is still too bright outside for aurora.')
        reasons.append(f'Darkness begins after sunset at {sunset}.')
        if kp is not None and kp >= kp_threshold:
            reasons.append('Aurora activity is present \u2014 check back after dark.')
        return {
            'verdict': f'Still too bright \u2014 sunset at {sunset}',
            'level': 'no',
            'reasons': reasons,
        }

    # ── Hard cloud blocker — 90%+ overcast means nothing is visible ──
    if cloud is not None and cloud >= 90:
        reasons.append('Completely overcast \u2014 cloud is blocking the sky.')
        if kp is not None and kp >= kp_threshold:
            reasons.append('Aurora activity is present \u2014 check back if skies clear.')
        elif kp is not None and kp >= kp_threshold - 1:
            reasons.append('Minor aurora activity \u2014 check back if skies clear.')
        else:
            reasons.append('Aurora activity is low right now.')
        if weather_code is not None and weather_code >= 51:
            reasons.append('Rain is forecast.')
        return {
            'verdict': 'Not tonight \u2014 completely overcast',
            'level': 'no',
            'reasons': reasons,
        }

    # Factor 1: Aurora activity (most important, scaled by latitude threshold)
    margin = (kp - kp_threshold) if kp is not None else None
    if kp is None:
        reasons.append('Activity data is temporarily unavailable.')
    elif margin >= 2:
        score += 4
        reasons.append(f'Aurora is very likely from {location_name}.')
    elif margin >= 0:
        score += 3
        reasons.append(f'Aurora is possible from {location_name}.')
    elif margin >= -1:
        score += 1
        reasons.append('A faint glow may be possible from very dark sites.')
    else:
        reasons.append('Aurora activity is low right now.')

    # Factor 2: Cloud cover
    if cloud is None:
        reasons.append('Cloud data is temporarily unavailable.')
    elif cloud <= 25:
        score += 2
        reasons.append('Skies are clear overhead.')
    elif cloud <= 50:
        score += 1
        reasons.append('Partly cloudy with gaps to see through.')
    elif cloud <= 75:
        reasons.append('Mostly cloudy \u2014 limited viewing.')
        score -= 2
    else:
        # 75-89% cloud (90%+ is handled by the hard blocker above)
        reasons.append('Heavy cloud will block the view.')
        score -= 3

    # Factor 3: Rain/weather
    if weather_code is not None and weather_code >= 51:
        reasons.append('Rain or precipitation is falling.')
        score -= 1

    # Factor 4: Moon brightness
    if moon_illum < 30:
        reasons.append('Moon brightness is not a concern.')
        score += 1
    elif moon_illum > 70:
        reasons.append('Bright moonlight may wash out faint aurora.')
        score -= 1

    # Factor 5: IMF Bz (southward = good for aurora)
    bz = imf_data.get('bz')
    if bz is not None:
        if bz <= -10:
            score += 2
            reasons.append('Magnetic conditions are excellent for aurora.')
        elif bz <= -5:
            score += 1
            reasons.append('Magnetic conditions favour aurora.')
        elif bz > 0:
            reasons.append('Magnetic conditions are less favourable right now.')

    # Factor 6: Light pollution
    bortle = light_pollution.get('bortle', 5)
    if bortle >= 8:
        reasons.append('Severe light pollution \u2014 only the strongest aurora would be visible here.')
        score -= 2
    elif bortle >= 7:
        reasons.append('Light pollution is significant \u2014 find a darker spot if you can.')
        score -= 1
    elif bortle >= 6:
        reasons.append('Some light pollution \u2014 look north, away from town lights.')
    elif bortle <= 3:
        reasons.append('This is a great dark sky location.')
        score += 1

    # Determine verdict
    if score >= 5:
        if bortle >= 7:
            verdict = 'Yes! Drive to a darker spot if you can'
        else:
            verdict = 'Yes! Head outside to a dark spot now'
        level = 'yes'
    elif score >= 3:
        if bortle >= 7:
            verdict = 'Worth a look \u2014 get away from streetlights'
        else:
            verdict = 'Worth a look \u2014 check the northern horizon'
        level = 'maybe'
    elif score >= 1:
        verdict = 'Conditions are marginal \u2014 keep monitoring'
        level = 'maybe'
    else:
        verdict = 'Not tonight \u2014 stay warm indoors'
        level = 'no'

    return {
        'verdict': verdict,
        'level': level,
        'reasons': reasons,
    }


def _calculate_best_viewing_window(hourly_cloud, kp_timeline, darkness_info, kp_threshold):
    """Calculate the best viewing window tonight by combining cloud, Kp, and darkness.

    Scores each hour in the next 12 hours and finds the best contiguous window.
    Returns: {window: str, summary: str, score: int} or None.
    """
    if not hourly_cloud:
        return None

    dark_status = darkness_info.get('darkness_status', 'unknown') if darkness_info else 'unknown'
    sunset = darkness_info.get('sunset', '') if darkness_info else ''
    sunrise = darkness_info.get('sunrise', '') if darkness_info else ''

    # Build a score for each hour
    hour_scores = []
    now = datetime.utcnow()
    uk_tz = ZoneInfo('Europe/London')
    now_uk = now.replace(tzinfo=ZoneInfo('UTC')).astimezone(uk_tz)

    for i, h in enumerate(hourly_cloud):
        cloud_pct = h.get('cloud_pct', 100)
        hour_str = h.get('hour', '')

        # Parse the hour to determine UK local time
        try:
            hour_int = int(hour_str.split(':')[0])
            # Calculate the actual datetime for this forecast hour
            forecast_dt = now_uk.replace(minute=0, second=0, microsecond=0) + timedelta(hours=i)
            forecast_hour = forecast_dt.hour
        except (ValueError, IndexError):
            forecast_hour = 0
            forecast_dt = now_uk

        score = 0

        # Cloud score (most important — heavy cloud is a hard blocker)
        if cloud_pct <= 15:
            score += 4  # Clear
        elif cloud_pct <= 30:
            score += 3  # Mostly clear
        elif cloud_pct <= 55:
            score += 1  # Partly cloudy
        elif cloud_pct <= 80:
            score -= 2  # Mostly cloudy
        else:
            score -= 6  # Overcast — hard penalty, cannot be offset by other factors

        # Darkness score — must be dark for aurora
        # Sunset typically 16-21, sunrise 5-8 in UK
        is_dark = False
        try:
            if sunset and sunrise:
                sunset_h = int(sunset.split(':')[0])
                sunrise_h = int(sunrise.split(':')[0])
                # It's dark if after sunset or before sunrise
                if forecast_hour >= sunset_h + 1 or forecast_hour < sunrise_h:
                    is_dark = True
                    score += 2
                elif forecast_hour >= sunset_h:
                    is_dark = True
                    score += 1  # Twilight
                else:
                    score -= 5  # Daylight — heavily penalize
            else:
                # No sunset data — assume dark between 20:00-06:00
                if 20 <= forecast_hour or forecast_hour < 6:
                    is_dark = True
                    score += 2
        except (ValueError, IndexError):
            pass

        # Kp score — check if a predicted Kp entry exists for this time
        forecast_utc = forecast_dt.astimezone(ZoneInfo('UTC'))
        forecast_utc_str = forecast_utc.strftime('%Y-%m-%d %H:%M')
        best_kp = None
        for entry in kp_timeline:
            if entry.get('type') in ('predicted', 'estimated'):
                # Find closest Kp forecast within 3 hours
                try:
                    entry_dt = datetime.strptime(entry['time'], '%Y-%m-%d %H:%M')
                    diff_h = abs((entry_dt - forecast_utc.replace(tzinfo=None)).total_seconds()) / 3600
                    if diff_h <= 1.5:
                        best_kp = entry['kp']
                        break
                except ValueError:
                    pass

        if best_kp is not None:
            if best_kp >= kp_threshold:
                score += 3
            elif best_kp >= kp_threshold - 1:
                score += 1

        hour_scores.append({
            'hour': hour_str,
            'score': score,
            'cloud': cloud_pct,
            'dark': is_dark,
            'kp': best_kp,
        })

    # Find the best contiguous window (2+ hours with score >= 2)
    best_start = -1
    best_end = -1
    best_total = -999

    for start in range(len(hour_scores)):
        total = 0
        for end in range(start, min(start + 6, len(hour_scores))):
            total += hour_scores[end]['score']
            length = end - start + 1
            if length >= 2 and total > best_total:
                best_total = total
                best_start = start
                best_end = end

    if best_start < 0 or best_total < 2:
        return {
            'window': None,
            'summary': 'No good viewing window in the next 12 hours',
            'hours': [],
        }

    window_start = hour_scores[best_start]['hour']
    window_end = hour_scores[best_end]['hour']
    avg_cloud = sum(h['cloud'] for h in hour_scores[best_start:best_end + 1]) // (best_end - best_start + 1)

    # Build summary
    if best_total >= 10:
        quality = 'Excellent'
    elif best_total >= 6:
        quality = 'Good'
    elif best_total >= 3:
        quality = 'Fair'
    else:
        quality = 'Marginal'

    summary = f'{quality} window: {window_start}\u2013{window_end}'
    if avg_cloud <= 30:
        summary += ' (clear skies expected)'
    elif avg_cloud <= 55:
        summary += ' (some cloud gaps)'

    return {
        'window': f'{window_start}\u2013{window_end}',
        'summary': summary,
        'quality': quality.lower(),
        'avg_cloud': avg_cloud,
        'hours': hour_scores,
    }


def _aurora_tonight_summary(kp, kp_timeline, darkness_info, current_weather,
                            moon_phase, solar_wind, imf_data, hourly_cloud,
                            swpc_alerts, kp_threshold, location_name,
                            best_window, light_pollution=None, current_hp30=None):
    """Build a comprehensive 'Aurora Conditions Tonight' assessment.

    Combines all available aurora and weather factors into a structured
    summary with an overall rating and factor breakdown.
    """
    factors = []
    score = 0
    darkness_info = darkness_info or {}
    current_weather = current_weather or {}
    moon_phase = moon_phase or {}
    solar_wind = solar_wind or {}
    imf_data = imf_data or {}
    light_pollution = light_pollution or {}

    sunset_str = darkness_info.get('sunset', '20:00')
    sunrise_str = darkness_info.get('sunrise', '06:00')
    try:
        sunset_h = int(sunset_str.split(':')[0]) if sunset_str else 20
        sunrise_h = int(sunrise_str.split(':')[0]) if sunrise_str else 6
    except (ValueError, IndexError):
        sunset_h, sunrise_h = 20, 6

    # ── Factor 1: Kp Activity ──
    tonight_peak_kp = kp
    peak_kp_time_str = None
    for entry in (kp_timeline or []):
        if entry.get('type') in ('predicted', 'estimated') and entry.get('kp') is not None:
            try:
                time_str = entry['time']
                hour = int(time_str.split(' ')[1].split(':')[0])
                if hour >= sunset_h or hour < sunrise_h:
                    if entry['kp'] > (tonight_peak_kp or 0):
                        tonight_peak_kp = entry['kp']
                        peak_kp_time_str = time_str[-5:]  # extract "HH:MM"
            except (ValueError, IndexError):
                pass

    if kp is not None:
        peak_detail = ''
        if tonight_peak_kp and tonight_peak_kp > kp:
            peak_detail = f'Peak tonight: Kp {tonight_peak_kp:.1f}'
        elif tonight_peak_kp:
            peak_detail = f'Tonight peak: Kp {tonight_peak_kp:.1f}'

        if kp >= kp_threshold:
            factors.append({'name': 'Kp Activity', 'icon': 'activity',
                            'value': f'Kp {kp:.1f} now', 'detail': peak_detail,
                            'status': 'good'})
            score += 3
        elif kp >= kp_threshold - 1:
            factors.append({'name': 'Kp Activity', 'icon': 'activity',
                            'value': f'Kp {kp:.1f} now', 'detail': peak_detail,
                            'status': 'fair'})
            score += 1
        else:
            factors.append({'name': 'Kp Activity', 'icon': 'activity',
                            'value': f'Kp {kp:.1f} now',
                            'detail': f'Need Kp {kp_threshold}+ for {location_name}',
                            'status': 'poor'})
    else:
        factors.append({'name': 'Kp Activity', 'icon': 'activity',
                        'value': 'No data', 'detail': '', 'status': 'unknown'})

    # ── Factor 1b: Hp30 Real-time Activity ──
    # Hp30 provides 30-min resolution vs Kp's 3-hour average — captures rapid surges.
    if current_hp30 is not None:
        # Hp30 may show a higher current value than the 3-hour Kp
        if current_hp30 > (tonight_peak_kp or 0):
            tonight_peak_kp = current_hp30

        hp30_margin = current_hp30 - kp_threshold
        if hp30_margin >= 2:
            factors.insert(1, {'name': 'Hp30 Real-time', 'icon': 'lightning-charge',
                               'value': f'Hp30 {current_hp30:.1f}',
                               'detail': '30-min index \u2014 storm level',
                               'status': 'good'})
            score += 2
        elif hp30_margin >= 0:
            factors.insert(1, {'name': 'Hp30 Real-time', 'icon': 'lightning-charge',
                               'value': f'Hp30 {current_hp30:.1f}',
                               'detail': '30-min index \u2014 aurora possible',
                               'status': 'fair'})
            score += 1
        elif hp30_margin >= -1:
            factors.insert(1, {'name': 'Hp30 Real-time', 'icon': 'lightning-charge',
                               'value': f'Hp30 {current_hp30:.1f}',
                               'detail': '30-min index \u2014 borderline',
                               'status': 'fair'})
        else:
            factors.insert(1, {'name': 'Hp30 Real-time', 'icon': 'lightning-charge',
                               'value': f'Hp30 {current_hp30:.1f}',
                               'detail': '30-min index \u2014 quiet',
                               'status': 'neutral'})

    # ── Factor 2: IMF Bz ──
    bz = imf_data.get('bz')
    if bz is not None:
        if bz <= -10:
            factors.append({'name': 'IMF Bz', 'icon': 'magnet',
                            'value': f'{bz:.1f} nT',
                            'detail': 'Strongly southward \u2014 excellent',
                            'status': 'good'})
            score += 2
        elif bz <= -5:
            factors.append({'name': 'IMF Bz', 'icon': 'magnet',
                            'value': f'{bz:.1f} nT',
                            'detail': 'Southward \u2014 favourable',
                            'status': 'good'})
            score += 1
        elif bz <= 0:
            factors.append({'name': 'IMF Bz', 'icon': 'magnet',
                            'value': f'{bz:.1f} nT',
                            'detail': 'Weakly southward',
                            'status': 'fair'})
        else:
            factors.append({'name': 'IMF Bz', 'icon': 'magnet',
                            'value': f'+{bz:.1f} nT',
                            'detail': 'Northward \u2014 unfavourable',
                            'status': 'poor'})
            score -= 1
    else:
        factors.append({'name': 'IMF Bz', 'icon': 'magnet',
                        'value': 'No data', 'detail': '', 'status': 'unknown'})

    # ── Factor 3: Solar Wind ──
    sw_speed = solar_wind.get('speed')
    if sw_speed is not None:
        sw_level = solar_wind.get('speed_level', 'unknown')
        if sw_level in ('high', 'extreme'):
            factors.append({'name': 'Solar Wind', 'icon': 'wind',
                            'value': f'{sw_speed:.0f} km/s',
                            'detail': solar_wind.get('speed_label', 'High'),
                            'status': 'good'})
            score += 1
        elif sw_level == 'elevated':
            factors.append({'name': 'Solar Wind', 'icon': 'wind',
                            'value': f'{sw_speed:.0f} km/s',
                            'detail': 'Elevated', 'status': 'fair'})
        else:
            factors.append({'name': 'Solar Wind', 'icon': 'wind',
                            'value': f'{sw_speed:.0f} km/s',
                            'detail': solar_wind.get('speed_label', 'Normal'),
                            'status': 'neutral'})
    else:
        factors.append({'name': 'Solar Wind', 'icon': 'wind',
                        'value': 'No data', 'detail': '', 'status': 'unknown'})

    # ── Factor 4: Cloud Cover ──
    cloud = current_weather.get('cloud_cover')
    night_cloud_hours = []
    for h in (hourly_cloud or []):
        try:
            hour_int = int(h.get('hour', '00').split(':')[0])
            if hour_int >= sunset_h or hour_int < sunrise_h:
                night_cloud_hours.append(h.get('cloud_pct', 100))
        except (ValueError, IndexError):
            pass
    avg_tonight_cloud = (round(sum(night_cloud_hours) / len(night_cloud_hours))
                         if night_cloud_hours else None)

    if cloud is not None:
        cloud_detail = ''
        if avg_tonight_cloud is not None:
            if avg_tonight_cloud <= 30:
                cloud_detail = 'Tonight: mostly clear'
            elif avg_tonight_cloud <= 60:
                cloud_detail = f'Tonight avg: ~{avg_tonight_cloud}%'
            else:
                cloud_detail = f'Tonight avg: ~{avg_tonight_cloud}%'

        if cloud <= 25:
            factors.append({'name': 'Cloud Cover', 'icon': 'clouds',
                            'value': f'{cloud}% now',
                            'detail': cloud_detail, 'status': 'good'})
            score += 2
        elif cloud <= 50:
            factors.append({'name': 'Cloud Cover', 'icon': 'clouds',
                            'value': f'{cloud}% now',
                            'detail': cloud_detail, 'status': 'fair'})
            score += 1
        elif cloud <= 80:
            factors.append({'name': 'Cloud Cover', 'icon': 'clouds',
                            'value': f'{cloud}% now',
                            'detail': cloud_detail, 'status': 'poor'})
            score -= 1
        else:
            factors.append({'name': 'Cloud Cover', 'icon': 'clouds',
                            'value': f'{cloud}% \u2014 overcast',
                            'detail': cloud_detail, 'status': 'poor'})
            score -= 2
    else:
        factors.append({'name': 'Cloud Cover', 'icon': 'clouds',
                        'value': 'No data', 'detail': '', 'status': 'unknown'})

    # ── Factor 5: Moon ──
    moon_illum = moon_phase.get('illumination', 50)
    moon_name = moon_phase.get('phase_name', '')
    if moon_illum < 30:
        factors.append({'name': 'Moon', 'icon': 'moon',
                        'value': f'{moon_name} ({moon_illum}%)',
                        'detail': 'Dark skies \u2014 favourable',
                        'status': 'good'})
        score += 1
    elif moon_illum < 60:
        factors.append({'name': 'Moon', 'icon': 'moon',
                        'value': f'{moon_name} ({moon_illum}%)',
                        'detail': 'Moderate moonlight',
                        'status': 'fair'})
    else:
        factors.append({'name': 'Moon', 'icon': 'moon',
                        'value': f'{moon_name} ({moon_illum}%)',
                        'detail': 'Bright moon may wash out aurora',
                        'status': 'poor'})
        score -= 1

    # ── Factor 6: Darkness ──
    dark_status = darkness_info.get('darkness_status', 'unknown')
    sunset = darkness_info.get('sunset')
    sunrise = darkness_info.get('sunrise')
    if dark_status in ('dark', 'astronomical_twilight'):
        factors.append({'name': 'Darkness', 'icon': 'moon-stars-fill',
                        'value': 'Dark',
                        'detail': f'Sunrise {sunrise}' if sunrise else '',
                        'status': 'good'})
        score += 1
    elif dark_status == 'nautical_twilight':
        factors.append({'name': 'Darkness', 'icon': 'moon-stars-fill',
                        'value': 'Getting dark',
                        'detail': f'Sunset {sunset} \u2022 Sunrise {sunrise}' if sunset and sunrise else '',
                        'status': 'fair'})
    elif dark_status == 'civil_twilight':
        factors.append({'name': 'Darkness', 'icon': 'moon-stars-fill',
                        'value': 'Twilight',
                        'detail': f'Wait for full dark after {sunset}' if sunset else '',
                        'status': 'poor'})
        score -= 1
    else:
        factors.append({'name': 'Darkness', 'icon': 'moon-stars-fill',
                        'value': 'Daylight',
                        'detail': f'Sunset at {sunset}' if sunset else 'Too bright',
                        'status': 'poor'})
        score -= 2

    # ── Factor 7: Light Pollution ──
    bortle = light_pollution.get('bortle', 5)
    bortle_label = light_pollution.get('label', '')
    if bortle <= 3:
        factors.append({'name': 'Light Pollution', 'icon': 'lightbulb-off',
                        'value': f'Bortle {bortle}',
                        'detail': f'{bortle_label} \u2014 excellent dark skies',
                        'status': 'good'})
        score += 1
    elif bortle <= 5:
        factors.append({'name': 'Light Pollution', 'icon': 'lightbulb',
                        'value': f'Bortle {bortle}',
                        'detail': f'{bortle_label} \u2014 good conditions',
                        'status': 'fair'})
    elif bortle <= 6:
        factors.append({'name': 'Light Pollution', 'icon': 'lightbulb-fill',
                        'value': f'Bortle {bortle}',
                        'detail': f'{bortle_label} \u2014 find a darker spot nearby',
                        'status': 'fair'})
    else:
        factors.append({'name': 'Light Pollution', 'icon': 'lightbulb-fill',
                        'value': f'Bortle {bortle}',
                        'detail': f'{bortle_label} \u2014 heavy light pollution, drive to darker area',
                        'status': 'poor'})
        score -= 1

    # ── Overall rating ──
    if score >= 7:
        rating = 'Excellent'
        rating_level = 'excellent'
    elif score >= 4:
        rating = 'Good'
        rating_level = 'good'
    elif score >= 2:
        rating = 'Fair'
        rating_level = 'fair'
    elif score >= 0:
        rating = 'Poor'
        rating_level = 'poor'
    else:
        rating = 'None'
        rating_level = 'none'

    # Active alerts summary
    active_alerts = []
    for alert in (swpc_alerts or []):
        if alert.get('friendly_explanation'):
            active_alerts.append(alert['friendly_explanation'])

    # ── Nighttime-focused derived fields ──
    peak_kp = tonight_peak_kp if tonight_peak_kp else (kp if kp is not None else 0)

    # Dark hours
    dark_hours = f'{sunset_str} – {sunrise_str}'

    # Cloud outlook (uses night_cloud_hours from Factor 4)
    if not night_cloud_hours:
        cloud_outlook = 'No cloud forecast available'
    elif avg_tonight_cloud is not None and avg_tonight_cloud <= 20:
        cloud_outlook = 'Clear skies expected tonight'
    elif avg_tonight_cloud is not None and avg_tonight_cloud <= 35:
        cloud_outlook = 'Mostly clear with occasional cloud'
    elif avg_tonight_cloud is not None and avg_tonight_cloud > 70:
        cloud_outlook = 'Heavy cloud expected throughout'
    elif len(night_cloud_hours) >= 4:
        first_half = sum(night_cloud_hours[:len(night_cloud_hours)//2]) / (len(night_cloud_hours)//2)
        second_half = sum(night_cloud_hours[len(night_cloud_hours)//2:]) / (len(night_cloud_hours) - len(night_cloud_hours)//2)
        if first_half > 60 and second_half < 40:
            cloud_outlook = 'Cloud clearing after midnight'
        elif first_half < 40 and second_half > 60:
            cloud_outlook = 'Cloud building through the night'
        else:
            cloud_outlook = f'Variable cloud — breaks possible (~{avg_tonight_cloud}% avg)'
    else:
        cloud_outlook = f'Variable cloud (~{avg_tonight_cloud}% avg)' if avg_tonight_cloud else 'Variable cloud'

    # Moon impact
    moonrise = moon_phase.get('moonrise')
    moonset = moon_phase.get('moonset')
    if moon_illum < 15:
        moon_impact = f'{moon_name} ({moon_illum}%) — dark skies all night'
    elif moon_illum < 40:
        if moonset:
            moon_impact = f'{moon_name} ({moon_illum}%) — sets {moonset}, darker after'
        else:
            moon_impact = f'{moon_name} ({moon_illum}%) — minimal moonlight'
    elif moon_illum < 60:
        if moonrise and moonset:
            moon_impact = f'{moon_name} ({moon_illum}%) — rises {moonrise}, sets {moonset}'
        elif moonrise:
            moon_impact = f'{moon_name} ({moon_illum}%) — rises {moonrise}'
        else:
            moon_impact = f'{moon_name} ({moon_illum}%) — moderate moonlight'
    else:
        if moonrise:
            moon_impact = f'Bright {moon_name} ({moon_illum}%) rises {moonrise}'
        elif moonset:
            moon_impact = f'Bright {moon_name} ({moon_illum}%) — sets {moonset}, darker after'
        else:
            moon_impact = f'Bright {moon_name} ({moon_illum}%) — moonlight all night'

    # Photography verdict (includes light pollution awareness)
    cloud_for_photo = avg_tonight_cloud if avg_tonight_cloud is not None else 100
    kp_above_threshold = peak_kp >= kp_threshold
    kp_near_threshold = peak_kp >= kp_threshold - 1
    lp_suffix = ''
    if bortle >= 7:
        lp_suffix = ' \u2014 drive to a darker location for best results'
    elif bortle >= 6:
        lp_suffix = ' \u2014 find a spot away from streetlights'

    if rating_level in ('excellent', 'good') and cloud_for_photo <= 40:
        photography_verdict = 'Great conditions for aurora photography tonight' + lp_suffix
        photography_possible = True
    elif rating_level in ('excellent', 'good') and cloud_for_photo <= 60:
        photography_verdict = 'Photography possible \u2014 watch for clear spells' + lp_suffix
        photography_possible = True
    elif kp_above_threshold and cloud_for_photo <= 60:
        photography_verdict = 'Photography possible if skies clear' + lp_suffix
        photography_possible = True
    elif kp_above_threshold and cloud_for_photo > 60:
        photography_verdict = 'Aurora possible but heavy cloud may block views'
        photography_possible = False
    elif kp_near_threshold:
        photography_verdict = 'Marginal \u2014 would need Kp to rise further'
        photography_possible = False
    else:
        photography_verdict = 'Not a photography night \u2014 aurora activity too low'
        photography_possible = False

    return {
        'rating': rating,
        'rating_level': rating_level,
        'score': score,
        'photography_verdict': photography_verdict,
        'photography_possible': photography_possible,
        'dark_hours': dark_hours,
        'moon_impact': moon_impact,
        'peak_kp_time': peak_kp_time_str,
        'cloud_outlook': cloud_outlook,
        'factors': factors,
        'tonight_peak_kp': round(tonight_peak_kp, 1) if tonight_peak_kp else None,
        'kp_threshold': kp_threshold,
        'location_name': location_name,
        'best_window': best_window,
        'active_alerts': active_alerts[:3],
    }


# ──────────────────────────────────────────────────────────────
# Solar Wind, IMF, NOAA Scales, SWPC Alerts, Light Pollution
# ──────────────────────────────────────────────────────────────

def _fetch_solar_wind():
    """Fetch real-time solar wind plasma data from NOAA DSCOVR satellite.

    Returns: {speed: float (km/s), density: float (p/cm³),
              temperature: float (K), timestamp: str,
              speed_label: str, speed_level: str}
    """
    default = {
        'speed': None, 'density': None, 'temperature': None,
        'timestamp': '', 'speed_label': 'No data', 'speed_level': 'unknown',
    }
    try:
        resp = requests.get(NOAA_PLASMA_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if len(data) < 2:
            return default

        # data[0] is header: ["time_tag", "density", "speed", "temperature"]
        # Find last row with valid speed value
        for row in reversed(data[1:]):
            try:
                speed = float(row[2]) if row[2] else None
                density = float(row[1]) if row[1] else None
                temp = float(row[3]) if row[3] else None
                if speed is not None:
                    # Classify speed
                    if speed >= 800:
                        speed_label = 'Extreme'
                        speed_level = 'extreme'
                    elif speed >= 600:
                        speed_label = 'High'
                        speed_level = 'high'
                    elif speed >= 500:
                        speed_label = 'Elevated'
                        speed_level = 'elevated'
                    elif speed >= 400:
                        speed_label = 'Normal'
                        speed_level = 'normal'
                    else:
                        speed_label = 'Slow'
                        speed_level = 'low'

                    return {
                        'speed': round(speed, 1),
                        'density': round(density, 2) if density else None,
                        'temperature': round(temp) if temp else None,
                        'timestamp': row[0] if row[0] else '',
                        'speed_label': speed_label,
                        'speed_level': speed_level,
                    }
            except (ValueError, TypeError, IndexError):
                continue

    except Exception as e:
        logger.warning(f'NOAA solar wind fetch failed: {e}')

    return default


def _fetch_imf_data():
    """Fetch real-time IMF (Interplanetary Magnetic Field) data from DSCOVR.

    Returns: {bz: float (nT), bt: float (nT), timestamp: str,
              bz_label: str, bz_level: str}
    """
    default = {
        'bz': None, 'bt': None, 'timestamp': '',
        'bz_label': 'No data', 'bz_level': 'unknown',
    }
    try:
        resp = requests.get(NOAA_MAG_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if len(data) < 2:
            return default

        # data[0] is header: ["time_tag","bx_gsm","by_gsm","bz_gsm","lon_gsm","lat_gsm","bt"]
        for row in reversed(data[1:]):
            try:
                bz = float(row[3]) if row[3] else None
                bt = float(row[6]) if row[6] else None
                if bz is not None:
                    # Classify Bz (negative = southward = good for aurora)
                    if bz <= -10:
                        bz_label = 'Strongly southward'
                        bz_level = 'excellent'
                    elif bz <= -5:
                        bz_label = 'Southward'
                        bz_level = 'good'
                    elif bz <= 0:
                        bz_label = 'Weakly southward'
                        bz_level = 'neutral'
                    else:
                        bz_label = 'Northward'
                        bz_level = 'poor'

                    return {
                        'bz': round(bz, 1),
                        'bt': round(bt, 1) if bt else None,
                        'timestamp': row[0] if row[0] else '',
                        'bz_label': bz_label,
                        'bz_level': bz_level,
                    }
            except (ValueError, TypeError, IndexError):
                continue

    except Exception as e:
        logger.warning(f'NOAA IMF fetch failed: {e}')

    return default


def _fetch_noaa_scales():
    """Fetch current NOAA Space Weather Scales (G/S/R).

    Returns: {g_scale: int, g_text: str, s_scale: int, s_text: str,
              r_scale: int, r_text: str}
    """
    default = {
        'g_scale': 0, 'g_text': 'None',
        's_scale': 0, 's_text': 'None',
        'r_scale': 0, 'r_text': 'None',
    }
    try:
        resp = requests.get(NOAA_SCALES_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # Entry "0" is the current state
        current = data.get('0', data.get(0, {}))
        if current:
            g = current.get('G', {})
            s = current.get('S', {})
            r = current.get('R', {})
            return {
                'g_scale': int(g.get('Scale', 0) or 0),
                'g_text': g.get('Text', 'None') or 'None',
                's_scale': int(s.get('Scale', 0) or 0),
                's_text': s.get('Text', 'None') or 'None',
                'r_scale': int(r.get('Scale', 0) or 0),
                'r_text': r.get('Text', 'None') or 'None',
            }
    except Exception as e:
        logger.warning(f'NOAA scales fetch failed: {e}')

    return default


def _parse_swpc_timestamp(ts_str):
    """Parse a SWPC validity timestamp like '2026 Feb 16 1700 UTC' into a datetime.

    Returns datetime (UTC) or None if parsing fails.
    """
    if not ts_str:
        return None
    try:
        # Strip trailing 'UTC' and parse
        clean = ts_str.replace(' UTC', '').strip()
        return datetime.strptime(clean, '%Y %b %d %H%M')
    except (ValueError, TypeError):
        return None


def _fetch_swpc_alerts():
    """Fetch recent SWPC alerts for geomagnetic storms and CMEs.

    Returns list of up to 5 alerts that are currently valid or were issued
    recently (last 6 hours for alerts without a valid_until).
    Expired alerts (valid_until in the past) are excluded.
    """
    try:
        resp = requests.get(NOAA_ALERTS_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        now = datetime.utcnow()
        # For alerts without valid_until, only show if issued within 6 hours
        recent_cutoff = (now - timedelta(hours=6)).strftime('%Y-%m-%dT%H:%M')

        # Relevant alert product IDs for aurora watchers
        relevant_ids = {
            'K04W', 'K05W', 'K06W', 'K07W', 'K08W',  # Kp warnings
            'K04A', 'K05A', 'K06A', 'K07A', 'K08A',  # Kp alerts
            'A20F',  # Geomagnetic storm watch/forecast
            'MSIS',  # Geomagnetic sudden impulse
        }

        alerts = []
        for entry in data:
            issue_dt = entry.get('issue_datetime', '')
            product_id = entry.get('product_id', '')

            if product_id not in relevant_ids:
                continue

            # Extract summary and validity from the message
            message = entry.get('message', '')
            summary = _extract_alert_summary(message, product_id)
            validity = _extract_alert_validity(message)

            # Filter out expired alerts
            valid_until_dt = _parse_swpc_timestamp(validity['valid_until'])
            if valid_until_dt and valid_until_dt < now:
                # This alert has a valid_until that has passed — skip it
                continue

            # For alerts without valid_until (e.g., K-index actual alerts),
            # only show if issued within the last 6 hours
            if not valid_until_dt:
                if issue_dt[:16] < recent_cutoff:
                    continue

            alerts.append({
                'product_id': product_id,
                'issue_datetime': issue_dt,
                'summary': summary,
                'friendly_explanation': _friendly_alert_explanation(product_id, summary),
                'valid_from': validity['valid_from'],
                'valid_until': validity['valid_until'],
            })

        # Return most recent 5
        alerts.sort(key=lambda x: x['issue_datetime'], reverse=True)
        return alerts[:5]

    except Exception as e:
        logger.warning(f'SWPC alerts fetch failed: {e}')

    return []


def _friendly_alert_explanation(product_id, summary=''):
    """Return a plain-English explanation of a SWPC alert for UK aurora watchers.

    Maps Kp alert product IDs to user-friendly text explaining what the alert
    means for aurora visibility in the UK.
    """
    # Kp warnings (W = expected soon) and alerts (A = happening now)
    explanations = {
        'K04W': 'Minor geomagnetic activity expected. Aurora may be visible from northern Scotland with clear, dark skies.',
        'K04A': 'Minor geomagnetic activity in progress. Aurora may be visible from northern Scotland right now.',
        'K05W': 'Geomagnetic storm expected. Aurora possible across Scotland and northern England.',
        'K05A': 'Geomagnetic storm in progress! Aurora possible across Scotland and northern England right now.',
        'K06W': 'Strong geomagnetic storm expected. Aurora may be visible across much of the UK.',
        'K06A': 'Strong geomagnetic storm in progress! Aurora may be visible across much of the UK right now.',
        'K07W': 'Severe geomagnetic storm expected. Aurora likely visible across the entire UK.',
        'K07A': 'Severe geomagnetic storm in progress! Aurora likely visible across the entire UK right now.',
        'K08W': 'Extreme geomagnetic storm expected. Spectacular aurora displays possible UK-wide.',
        'K08A': 'Extreme geomagnetic storm in progress! Spectacular aurora displays possible UK-wide right now.',
        'A20F': 'Geomagnetic storm watch issued. Increased aurora activity possible in the coming days.',
        'MSIS': 'Sudden magnetic impulse detected. This can indicate the arrival of a solar wind shock \u2014 aurora may follow.',
    }

    return explanations.get(product_id, '')


def _extract_alert_summary(message, product_id):
    """Extract a one-line summary from a SWPC alert message."""
    if not message:
        return product_id

    lines = message.strip().split('\n')

    # Priority 1: Look for EXTENDED WARNING / WARNING / ALERT / WATCH lines
    for line in lines:
        line = line.strip()
        for prefix in ('EXTENDED WARNING:', 'WARNING:', 'ALERT:', 'WATCH:', 'SUMMARY:'):
            if line.startswith(prefix):
                summary = line[len(prefix):].strip()
                if summary:
                    return summary

    # Priority 2: Look for "Valid From" or "Now Valid Until" lines
    validity = []
    for line in lines:
        line = line.strip()
        if line.startswith('Now Valid Until:'):
            validity.append(line)
        elif line.startswith('Valid From:'):
            validity.append(line)
    if validity:
        return ' | '.join(validity)

    # Priority 3: fallback to first informative line (skip headers)
    skip_prefixes = ('Space Weather Message', 'Serial Number', 'Issue Time',
                     'NOAA Space Weather Scale', 'www.', 'Extension to',
                     ':', '#', 'Issued', 'Product')
    for line in lines:
        line = line.strip()
        if len(line) > 15 and not line.startswith(skip_prefixes):
            return line[:120]

    return product_id


def _extract_alert_validity(message):
    """Extract Valid From and Valid Until timestamps from a SWPC alert message.

    SWPC alerts contain lines like:
        Valid From: 2025 Feb 18 1400 UTC
        Now Valid Until: 2025 Feb 19 0200 UTC

    Returns: dict with 'valid_from' and 'valid_until' (str or None).
    """
    result = {'valid_from': None, 'valid_until': None}
    if not message:
        return result

    for line in message.strip().split('\n'):
        line = line.strip()
        if line.startswith('Valid From:'):
            result['valid_from'] = line[len('Valid From:'):].strip()
        elif line.startswith('Now Valid Until:'):
            result['valid_until'] = line[len('Now Valid Until:'):].strip()
        elif line.startswith('Valid Until:'):
            result['valid_until'] = line[len('Valid Until:'):].strip()
        elif line.startswith('Valid To:'):
            result['valid_until'] = line[len('Valid To:'):].strip()

    return result


def _estimate_bortle(rural_urban_code):
    """Estimate Bortle dark-sky class from postcodes.io RUC11 classification.

    Maps the Rural-Urban Classification 2011 code to an approximate
    Bortle class (1=darkest, 9=brightest) with advice for aurora viewing.
    Supports both England/Wales codes (A1-F2) and Scotland codes (1-8).
    """
    mapping = {
        # England/Wales Rural-Urban Classification 2011
        'A1': (8, 'City centre', 'Severe light pollution \u2014 only the brightest stars visible'),
        'A2': (8, 'City centre', 'Severe light pollution \u2014 only the brightest stars visible'),
        'B1': (7, 'Urban', 'Significant light pollution \u2014 aurora needs to be very bright'),
        'B2': (7, 'Urban', 'Significant light pollution \u2014 aurora needs to be very bright'),
        'C1': (7, 'Urban', 'Significant light pollution \u2014 aurora needs to be very bright'),
        'C2': (6, 'Suburban', 'Moderate light pollution \u2014 strong aurora may be visible on horizon'),
        'D1': (5, 'Rural fringe', 'Some light pollution \u2014 good aurora should be visible'),
        'D2': (5, 'Rural fringe', 'Some light pollution \u2014 good aurora should be visible'),
        'E1': (4, 'Rural', 'Low light pollution \u2014 good conditions for aurora hunting'),
        'E2': (4, 'Rural', 'Low light pollution \u2014 good conditions for aurora hunting'),
        'F1': (3, 'Dark rural', 'Very low light pollution \u2014 excellent dark sky site'),
        'F2': (3, 'Dark rural', 'Very low light pollution \u2014 excellent dark sky site'),
        # Scottish Government Urban Rural Classification 2011-2012
        # 1 = Large Urban Areas (pop >= 125,000)
        '1': (8, 'City centre', 'Severe light pollution \u2014 only the brightest stars visible'),
        # 2 = Other Urban Areas (pop 10,000-125,000)
        '2': (7, 'Urban', 'Significant light pollution \u2014 aurora needs to be very bright'),
        # 3 = Accessible Small Towns (pop 3,000-10,000, within 30min drive)
        '3': (6, 'Small town', 'Moderate light pollution \u2014 strong aurora may be visible on horizon'),
        # 4 = Remote Small Towns (pop 3,000-10,000, >30min drive)
        '4': (5, 'Remote town', 'Some light pollution \u2014 good aurora should be visible'),
        # 5 = Very Remote Small Towns (pop 3,000-10,000, >60min drive)
        '5': (4, 'Very remote town', 'Low light pollution \u2014 good conditions for aurora hunting'),
        # 6 = Accessible Rural (pop <3,000, within 30min drive)
        '6': (4, 'Rural', 'Low light pollution \u2014 good conditions for aurora hunting'),
        # 7 = Remote Rural (pop <3,000, >30min drive)
        '7': (3, 'Remote rural', 'Very low light pollution \u2014 excellent dark sky site'),
        # 8 = Very Remote Rural (pop <3,000, >60min drive)
        '8': (2, 'Very remote rural', 'Minimal light pollution \u2014 outstanding dark sky site'),
    }
    bortle, label, advice = mapping.get(
        rural_urban_code, (5, 'Moderate', 'Light pollution level unknown for this location')
    )
    return {
        'bortle': bortle,
        'label': label,
        'advice': advice,
        'ruc_code': rural_urban_code or '',
    }
