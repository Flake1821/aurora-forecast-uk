import logging
import requests as http_requests
from flask import Blueprint, jsonify, request, session

logger = logging.getLogger(__name__)

api_bp = Blueprint('api', __name__, url_prefix='/api')

# Default location
DEFAULT_LAT = 52.5
DEFAULT_LON = -1.5
DEFAULT_LOCATION = 'Central England'


@api_bp.route('/space-weather')
def space_weather():
    try:
        from services.space_weather import get_current_conditions
        lat = request.args.get('lat', session.get('user_lat', DEFAULT_LAT), type=float)
        lon = request.args.get('lon', session.get('user_lon', DEFAULT_LON), type=float)
        location_name = request.args.get('location', session.get('user_location', DEFAULT_LOCATION))
        rural_urban = session.get('user_rural_urban', '')

        # Validate RUC code format: England/Wales 'A1'-'F2' or Scotland '1'-'8'
        import re
        if rural_urban and not re.match(r'^([A-F][12]|[1-8])$', rural_urban):
            rural_urban = ''
            session.pop('user_rural_urban', None)

        # If we have a user location but no rural_urban code, try to look it up
        if not rural_urban and 'user_lat' in session:
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
                pass  # Non-critical — light pollution will show default

        data = get_current_conditions(lat=lat, lon=lon, location_name=location_name,
                                      rural_urban=rural_urban)
        return jsonify(data)
    except Exception as e:
        return jsonify({
            'kp_index': None,
            'aurorawatch_status': 'unknown',
            'cornwall_visible': False,
            'cornwall_note': 'Error fetching space weather data.',
            'error': str(e),
        })


@api_bp.route('/set-location', methods=['POST'])
def set_location():
    """Save user's chosen location to session."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    lat = data.get('lat')
    lon = data.get('lon')
    name = data.get('name', 'Unknown')

    if lat is None or lon is None:
        return jsonify({'error': 'lat and lon required'}), 400

    try:
        lat = float(lat)
        lon = float(lon)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid coordinates'}), 400

    # Validate UK bounds (roughly 49-61N, -9 to 3E)
    if not (49 <= lat <= 61 and -9 <= lon <= 3):
        return jsonify({'error': 'Location must be within the UK'}), 400

    session['user_lat'] = round(lat, 2)
    session['user_lon'] = round(lon, 2)
    session['user_location'] = name[:50]
    session['user_rural_urban'] = data.get('rural_urban', '')[:5]

    return jsonify({'status': 'ok', 'lat': lat, 'lon': lon, 'name': name})


@api_bp.route('/postcode/<postcode>')
def lookup_postcode(postcode):
    """Look up a UK postcode via postcodes.io."""
    try:
        clean = postcode.strip().upper().replace(' ', '')
        resp = http_requests.get(
            f'https://api.postcodes.io/postcodes/{clean}',
            timeout=5
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get('status') == 200 and data.get('result'):
            r = data['result']
            # ruc11 code is inside codes.ruc11 (e.g., 'D1', 'E1')
            # The top-level ruc11 is the text description
            ruc_code = r.get('codes', {}).get('ruc11', '') if isinstance(r.get('codes'), dict) else ''
            return jsonify({
                'lat': r['latitude'],
                'lon': r['longitude'],
                'name': r.get('admin_district') or r.get('parliamentary_constituency', 'Unknown'),
                'region': r.get('region', ''),
                'rural_urban': ruc_code,
            })
        return jsonify({'error': 'Postcode not found'}), 404
    except Exception as e:
        logger.warning(f'Postcode lookup failed: {e}')
        return jsonify({'error': 'Postcode lookup failed'}), 500


@api_bp.route('/reverse-geocode')
def reverse_geocode():
    """Reverse geocode lat/lon to a UK place name via postcodes.io."""
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    if lat is None or lon is None:
        return jsonify({'error': 'lat and lon required'}), 400
    try:
        resp = http_requests.get(
            f'https://api.postcodes.io/postcodes?lon={lon}&lat={lat}&limit=1',
            timeout=5
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get('result') and len(data['result']) > 0:
            r = data['result'][0]
            ruc_code = r.get('codes', {}).get('ruc11', '') if isinstance(r.get('codes'), dict) else ''
            return jsonify({
                'name': r.get('admin_district') or r.get('parliamentary_constituency', 'Unknown'),
                'region': r.get('region', ''),
                'rural_urban': ruc_code,
            })
        return jsonify({'name': 'Unknown'})
    except Exception as e:
        logger.warning(f'Reverse geocode failed: {e}')
        return jsonify({'name': 'Unknown'})


@api_bp.route('/place-search/<query>')
def place_search(query):
    """Unified search: tries postcode first, then place name via postcodes.io."""
    clean = query.strip()
    if not clean or len(clean) < 2:
        return jsonify({'results': [], 'error': 'Query too short'}), 400
    if len(clean) > 50:
        clean = clean[:50]

    results = []

    # 1) Try as a postcode first
    try:
        pc = clean.upper().replace(' ', '')
        resp = http_requests.get(
            f'https://api.postcodes.io/postcodes/{pc}',
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get('status') == 200 and data.get('result'):
                r = data['result']
                lat = r.get('latitude')
                lon = r.get('longitude')
                if lat and lon and 49 <= lat <= 61 and -9 <= lon <= 3:
                    ruc_code = r.get('codes', {}).get('ruc11', '') if isinstance(r.get('codes'), dict) else ''
                    name = r.get('admin_district') or r.get('parliamentary_constituency', 'Unknown')
                    results.append({
                        'lat': lat,
                        'lon': lon,
                        'name': name,
                        'description': f'{clean.upper()} — {name}',
                        'rural_urban': ruc_code,
                    })
                    return jsonify({'results': results})
    except Exception:
        pass  # Fall through to place search

    # 2) Try as a place name
    try:
        resp = http_requests.get(
            'https://api.postcodes.io/places',
            params={'q': clean, 'limit': 5},
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get('result'):
                for place in data['result']:
                    lat = place.get('latitude')
                    lon = place.get('longitude')
                    if lat is None or lon is None:
                        continue
                    # Filter to UK bounds
                    if not (49 <= lat <= 61 and -9 <= lon <= 3):
                        continue
                    name = place.get('name_1', 'Unknown')
                    county = place.get('county_unitary', '') or place.get('region', '')
                    desc = f'{name}, {county}' if county else name
                    results.append({
                        'lat': lat,
                        'lon': lon,
                        'name': name,
                        'description': desc,
                        'rural_urban': '',
                    })
    except Exception as e:
        logger.warning(f'Place search failed: {e}')

    # Enrich place results with RUC11 code via reverse geocode
    for result in results:
        if not result.get('rural_urban'):
            try:
                rg = http_requests.get(
                    f"https://api.postcodes.io/postcodes?lon={result['lon']}&lat={result['lat']}&limit=1",
                    timeout=3
                )
                if rg.status_code == 200:
                    rg_data = rg.json()
                    if rg_data.get('result') and len(rg_data['result']) > 0:
                        ruc = rg_data['result'][0].get('codes', {}).get('ruc11', '')
                        result['rural_urban'] = ruc
            except Exception:
                pass  # Non-critical

    if not results:
        return jsonify({'results': [], 'error': 'No results found'}), 404

    return jsonify({'results': results})


@api_bp.route('/latest-alert')
def latest_alert():
    from models.post import FacebookPost
    post = FacebookPost.query.filter_by(
        category='alert', is_hidden=False
    ).order_by(FacebookPost.published_at.desc()).first()
    if not post:
        return jsonify({'alert': None})
    return jsonify({
        'alert': {
            'id': post.id,
            'title': post.title,
            'published_at': post.published_at.isoformat() if post.published_at else None,
            'excerpt': post.excerpt,
        }
    })


@api_bp.route('/cloud-grid')
def cloud_grid():
    """Cloud cover + wind grid for aurora map overlay (48 points, 12 hours)."""
    try:
        from services.space_weather import _fetch_cloud_grid
        data = _fetch_cloud_grid()
        return jsonify(data)
    except Exception as e:
        return jsonify({'grid': [], 'error': str(e)})
