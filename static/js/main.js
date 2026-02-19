/* UK Aurora & Night Sky Alerts — Main JS */

document.addEventListener('DOMContentLoaded', function () {

    // ── Navbar scroll effect ──
    var navbar = document.querySelector('.aurora-navbar');
    if (navbar) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 50) {
                navbar.style.background = 'rgba(10, 10, 26, 0.98)';
            } else {
                navbar.style.background = 'rgba(10, 10, 26, 0.92)';
            }
        });
    }

    // ── Chart instance (persists across updates) ──
    var kpChart = null;

    // ── Dynamic threshold from backend ──
    var kpThreshold = window.__kpThreshold || 5;
    var userLocation = window.__userLocation || 'your location';

    // ── Kp Severity label from numeric value ──
    function kpSeverityLabel(kp) {
        if (kp === null || kp === undefined) return 'Unknown';
        if (kp >= 8) return 'Extreme storm';
        if (kp >= 7) return 'Strong storm';
        if (kp >= 5) return 'Geomagnetic storm';
        if (kp >= 4) return 'Unsettled';
        if (kp >= 3) return 'Active';
        if (kp >= 2) return 'Quiet';
        return 'Very quiet';
    }

    // ── Accurate CSS moon phase rendering ──
    // phase_fraction: 0.0 = new moon, 0.25 = first quarter, 0.5 = full moon, 0.75 = last quarter
    function renderMoonPhase(phaseFraction) {
        var shadow = document.getElementById('moonShadow');
        if (!shadow) return;
        if (phaseFraction === null || phaseFraction === undefined) phaseFraction = 0;

        // Convert phase fraction to shadow clip-path
        // 0.0 = fully shadowed (new moon), 0.5 = no shadow (full moon)
        // Waxing (0–0.5): shadow retreats from right to left
        // Waning (0.5–1): shadow grows from right to left
        var p = phaseFraction % 1.0;
        var clipPath;

        if (p < 0.01 || p > 0.99) {
            // New moon — full shadow
            clipPath = 'ellipse(50% 50% at 50% 50%)';
        } else if (Math.abs(p - 0.5) < 0.01) {
            // Full moon — no shadow
            clipPath = 'ellipse(0% 50% at 50% 50%)';
        } else if (p < 0.25) {
            // Waxing crescent: shadow covers most, revealing a sliver on the right
            var t = p / 0.25; // 0 to 1 across this phase
            var cx = 50 - t * 50; // ellipse center moves from 50% to 0%
            var rx = 50 - t * 25; // x-radius shrinks
            clipPath = 'ellipse(' + rx + '% 50% at ' + cx + '% 50%)';
        } else if (p < 0.5) {
            // Waxing gibbous: shadow is a thin crescent on the left
            var t = (p - 0.25) / 0.25;
            var rx = 25 - t * 25; // x-radius shrinks to 0
            clipPath = 'ellipse(' + rx + '% 50% at 0% 50%)';
        } else if (p < 0.75) {
            // Waning gibbous: shadow grows from the right
            var t = (p - 0.5) / 0.25;
            var rx = t * 25;
            clipPath = 'ellipse(' + rx + '% 50% at 100% 50%)';
        } else {
            // Waning crescent: shadow covers most, revealing left sliver
            var t = (p - 0.75) / 0.25;
            var cx = 100 - t * 50; // move from 100% to 50%
            var rx = 25 + t * 25; // grow to full circle
            clipPath = 'ellipse(' + rx + '% 50% at ' + cx + '% 50%)';
        }

        shadow.style.clipPath = clipPath;
        shadow.style.webkitClipPath = clipPath;
    }

    // Render moon phase on page load
    var moonVisual = document.getElementById('moonVisual');
    if (moonVisual) {
        var initialPhase = parseFloat(moonVisual.getAttribute('data-phase')) || 0;
        renderMoonPhase(initialPhase);
    }

    // ── Aurora chance label using margin above threshold ──
    function auroraChanceLabel(kp, threshold) {
        threshold = threshold || kpThreshold;
        if (kp === null || kp === undefined) return { text: 'Unknown', level: 'unknown' };
        var margin = kp - threshold;
        if (margin >= 2) return { text: 'Likely visible \u2014 go outside!', level: 'high' };
        if (margin >= 1) return { text: 'Good chance \u2014 find a dark spot', level: 'high' };
        if (margin >= 0) return { text: 'Possible \u2014 check the northern horizon', level: 'medium' };
        if (margin >= -1) return { text: 'Unlikely \u2014 faint glow from very dark sites', level: 'low' };
        if (margin >= -2) return { text: 'Very unlikely', level: 'low' };
        return { text: 'No chance', level: 'none' };
    }

    // ── Kp colour for given value ──
    function kpColour(kp) {
        if (kp >= 7) return '#F44336';
        if (kp >= 5) return '#FF9800';
        if (kp >= 3) return '#FFC107';
        return '#4CAF50';
    }

    // ── Calculate rain animation angle from wind speed ──
    function calculateRainAngle(windSpeedKmh) {
        if (windSpeedKmh === null || windSpeedKmh === undefined || windSpeedKmh < 0) return 5;
        if (windSpeedKmh < 5)  return 2 + Math.random() * 3;           // calm: 2-5 deg
        if (windSpeedKmh < 20) return 10 + (windSpeedKmh - 5) * 0.67;  // light: 10-20 deg
        if (windSpeedKmh < 40) return 25 + (windSpeedKmh - 20) * 0.75; // moderate: 25-40 deg
        if (windSpeedKmh < 60) return 45 + (windSpeedKmh - 40) * 0.5;  // strong: 45-55 deg
        return 60 + Math.min(windSpeedKmh - 60, 20) * 0.5;             // gale: 60-70 deg
    }

    // ── Update wind display and rain angle CSS property ──
    function updateWindDisplay(weatherData) {
        var panel = document.querySelector('.cond-weather-now');
        if (!panel) return;

        var cw = weatherData || {};
        var windSpeed = cw.wind_speed;
        var windCompass = cw.wind_direction_compass || '';
        var windGusts = cw.wind_gusts;

        // Update wind speed value
        var windSpeedEl = document.getElementById('currentWindSpeed');
        if (windSpeedEl) {
            windSpeedEl.textContent = (windSpeed !== null && windSpeed !== undefined)
                ? windSpeed + ' km/h' : '-- km/h';
        }

        // Update wind direction label
        var windStatEl = panel.querySelector('.weather-stat-wind .weather-stat-label');
        if (windStatEl) {
            windStatEl.textContent = 'Wind' + (windCompass ? ' (' + windCompass + ')' : '');
        }

        // Update gust note
        var gustNote = document.getElementById('windGustNote');
        if (gustNote) {
            if (windGusts !== null && windGusts !== undefined && windSpeed !== null && windGusts > windSpeed + 10) {
                gustNote.textContent = 'Gusts ' + windGusts + ' km/h';
                gustNote.style.display = '';
            } else {
                gustNote.style.display = 'none';
            }
        }

        // Calculate rain angle from wind speed and set CSS custom property
        var angle = calculateRainAngle(windSpeed || 0);
        panel.style.setProperty('--rain-angle', angle + 'deg');
        panel.style.setProperty('--wind-speed', windSpeed || 0);
        panel.setAttribute('data-wind-speed', windSpeed || 0);
        panel.setAttribute('data-wind-dir', cw.wind_direction || 0);
    }

    // ── Update Aurora Conditions Tonight panel ──
    function updateAuroraTonightPanel(data) {
        if (!data || !data.aurora_tonight) return;
        var t = data.aurora_tonight;
        var panel = document.getElementById('auroraTonightPanel');
        if (!panel) return;

        // Update rating badge
        var ratingEl = document.getElementById('tonightRating');
        if (ratingEl) {
            ratingEl.textContent = t.rating || 'Unknown';
            ratingEl.className = 'tonight-rating tonight-rating-' + (t.rating_level || 'none');
        }

        // Update panel class (drives dynamic background + text colours)
        panel.className = 'cond-panel cond-aurora-tonight tonight-' + (t.rating_level || 'none');

        // Photography verdict
        var photoEl = document.getElementById('tonightPhotoVerdict');
        if (photoEl) photoEl.innerHTML = '<i class="bi bi-camera me-1"></i>' + (t.photography_verdict || '');

        // Peak Kp
        var kpEl = document.getElementById('tonightPeakKp');
        if (kpEl) {
            var kpHtml = 'Kp ' + (t.tonight_peak_kp != null ? t.tonight_peak_kp : '?');
            if (t.peak_kp_time) kpHtml += ' <small>at ~' + t.peak_kp_time + '</small>';
            kpEl.innerHTML = kpHtml;
        }

        // Dark hours
        var darkEl = document.getElementById('tonightDarkHours');
        if (darkEl) darkEl.textContent = t.dark_hours || '--';

        // Cloud outlook
        var cloudEl = document.getElementById('tonightCloudOutlook');
        if (cloudEl) cloudEl.textContent = t.cloud_outlook || '--';

        // Moon impact
        var moonEl = document.getElementById('tonightMoon');
        if (moonEl) moonEl.textContent = t.moon_impact || '--';

        // Location name in header
        var locEl = document.getElementById('tonightLocation');
        if (locEl && t.location_name) locEl.textContent = 'for ' + t.location_name;
    }

    // ═══════════════════════════════════════════════
    // RADIAL SVG Kp GAUGE
    // ═══════════════════════════════════════════════

    function renderRadialGauge(kp, containerId) {
        var container = document.getElementById(containerId || 'radialGauge');
        if (!container) return;

        kp = parseFloat(kp) || 0;
        if (kp < 0) kp = 0;
        if (kp > 9) kp = 9;

        var cx = 120, cy = 120, r = 95;
        var startAngle = Math.PI;      // 180deg = left (Kp 0)
        var totalAngle = Math.PI;      // 180deg sweep
        var endAngle = 0;              // 0deg = right (Kp 9)

        function arcPath(startA, endA, radius) {
            var x1 = cx + radius * Math.cos(startA);
            var y1 = cy - radius * Math.sin(startA);
            var x2 = cx + radius * Math.cos(endA);
            var y2 = cy - radius * Math.sin(endA);
            var sweep = endA < startA ? 1 : 0;
            var largeArc = Math.abs(startA - endA) > Math.PI ? 1 : 0;
            return 'M ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' ' + sweep + ' ' + x2 + ' ' + y2;
        }

        var frac = kp / 9;
        var kpAngle = startAngle - frac * totalAngle;
        var gaugeColour = kpColour(kp);
        var gradId = 'gaugeGrad_' + (containerId || 'radialGauge');
        var glowId = 'needleGlow_' + (containerId || 'radialGauge');

        var svg = '<svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">';

        // Defs: gradient + glow filter
        svg += '<defs>';
        svg += '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="0">';
        svg += '<stop offset="0%" stop-color="#4CAF50"/>';
        svg += '<stop offset="33%" stop-color="#FFC107"/>';
        svg += '<stop offset="55%" stop-color="#FF9800"/>';
        svg += '<stop offset="78%" stop-color="#F44336"/>';
        svg += '<stop offset="100%" stop-color="#D32F2F"/>';
        svg += '</linearGradient>';
        svg += '<filter id="' + glowId + '"><feGaussianBlur stdDeviation="2.5" result="blur"/>';
        svg += '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
        svg += '</defs>';

        // Full gradient semicircle background (always visible green → red)
        svg += '<path d="' + arcPath(startAngle, endAngle + 0.001, r) + '" stroke="url(#' + gradId + ')" stroke-width="14" fill="none" stroke-linecap="round" opacity="0.3"/>';
        svg += '<path d="' + arcPath(startAngle, endAngle + 0.001, r) + '" stroke="url(#' + gradId + ')" stroke-width="14" fill="none" stroke-linecap="round" opacity="0.7"/>';

        // Tick marks and labels (0-9)
        for (var t = 0; t <= 9; t++) {
            var tickAngle = startAngle - (t / 9) * totalAngle;
            var isMajor = (t % 3 === 0);
            var inner = r - (isMajor ? 18 : 14);
            var outer = r - 7;
            var tx1 = cx + inner * Math.cos(tickAngle);
            var ty1 = cy - inner * Math.sin(tickAngle);
            var tx2 = cx + outer * Math.cos(tickAngle);
            var ty2 = cy - outer * Math.sin(tickAngle);
            svg += '<line x1="' + tx1 + '" y1="' + ty1 + '" x2="' + tx2 + '" y2="' + ty2 + '" stroke="rgba(255,255,255,' + (isMajor ? '0.3' : '0.12') + ')" stroke-width="' + (isMajor ? '2' : '1.5') + '"/>';

            var labelR = r + 15;
            var lx = cx + labelR * Math.cos(tickAngle);
            var ly = cy - labelR * Math.sin(tickAngle);
            svg += '<text x="' + lx + '" y="' + ly + '" font-size="' + (isMajor ? '11' : '9') + '" font-weight="' + (isMajor ? '600' : '400') + '" fill="' + (isMajor ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)') + '" text-anchor="middle" dy="3.5">' + t + '</text>';
        }

        // Needle with glow
        var needleLen = r - 22;
        var nx = cx + needleLen * Math.cos(kpAngle);
        var ny = cy - needleLen * Math.sin(kpAngle);
        svg += '<g class="gauge-needle-wobble">';
        svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="' + gaugeColour + '" stroke-width="3" stroke-linecap="round" opacity="0.4" filter="url(#' + glowId + ')"/>';
        svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="' + gaugeColour + '" stroke-width="2.5" stroke-linecap="round"/>';
        svg += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + gaugeColour + '" filter="url(#' + glowId + ')"/>';
        svg += '<circle cx="' + cx + '" cy="' + cy + '" r="3.5" fill="#fff"/>';
        svg += '</g>';

        // Centre value text
        svg += '<text x="' + cx + '" y="' + (cy - 22) + '" font-size="40" font-weight="800" fill="' + gaugeColour + '" text-anchor="middle" dominant-baseline="central">' + kp.toFixed(1) + '</text>';

        svg += '</svg>';
        container.innerHTML = svg;
    }

    // ── Build / update the Kp timeline chart ──
    function renderKpChart(timeline) {
        var canvas = document.getElementById('kpTimelineChart');
        if (!canvas || !timeline || timeline.length === 0) return;
        if (typeof Chart === 'undefined') return;

        // Split into observed and predicted datasets
        var observedData = [];
        var predictedData = [];
        var allLabels = [];
        var now = new Date();
        var nowStr = now.toISOString().slice(0, 16).replace('T', ' ');

        // Find the transition point (last observed -> first predicted)
        var lastObservedIdx = -1;
        for (var i = 0; i < timeline.length; i++) {
            if (timeline[i].type === 'observed' || timeline[i].type === 'estimated') {
                lastObservedIdx = i;
            }
        }

        for (var i = 0; i < timeline.length; i++) {
            var entry = timeline[i];
            var timeLabel = entry.time;
            allLabels.push(timeLabel);

            if (entry.type === 'observed' || entry.type === 'estimated') {
                observedData.push(entry.kp);
                // Bridge: also add last observed point to predicted to connect lines
                if (i === lastObservedIdx) {
                    predictedData.push(entry.kp);
                } else {
                    predictedData.push(null);
                }
            } else {
                observedData.push(null);
                predictedData.push(entry.kp);
            }
        }

        // Find "now" index for annotation
        var nowIndex = 0;
        for (var i = 0; i < allLabels.length; i++) {
            if (allLabels[i] >= nowStr) {
                nowIndex = i;
                break;
            }
            nowIndex = i;
        }

        // Build nice short labels for x-axis
        var displayLabels = allLabels.map(function (t) {
            var parts = t.split(' ');
            if (parts.length === 2) {
                var dateParts = parts[0].split('-');
                var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                if (dateParts.length === 3) {
                    return parseInt(dateParts[2]) + ' ' + months[parseInt(dateParts[1]) - 1] + '\n' + parts[1];
                }
            }
            return t;
        });

        var chartData = {
            labels: displayLabels,
            datasets: [
                {
                    label: 'Observed Kp',
                    data: observedData,
                    borderColor: '#00E676',
                    backgroundColor: 'rgba(0, 230, 118, 0.1)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#00E676',
                    fill: true,
                    tension: 0.3,
                    spanGaps: false,
                },
                {
                    label: 'Predicted Kp',
                    data: predictedData,
                    borderColor: '#448AFF',
                    backgroundColor: 'rgba(68, 138, 255, 0.05)',
                    borderWidth: 2,
                    borderDash: [6, 3],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#448AFF',
                    fill: true,
                    tension: 0.3,
                    spanGaps: false,
                }
            ]
        };

        // Dynamic threshold line using user's location
        var thresholdLabel = userLocation + ' Kp ' + kpThreshold;

        // Colour band boxes for Kp severity zones
        var annotationBoxes = {
            quietZone: {
                type: 'box',
                yMin: 0, yMax: 3,
                backgroundColor: 'rgba(76, 175, 80, 0.06)',
                borderWidth: 0,
                drawTime: 'beforeDatasetsDraw',
            },
            activeZone: {
                type: 'box',
                yMin: 3, yMax: 5,
                backgroundColor: 'rgba(255, 193, 7, 0.06)',
                borderWidth: 0,
                drawTime: 'beforeDatasetsDraw',
            },
            stormZone: {
                type: 'box',
                yMin: 5, yMax: 7,
                backgroundColor: 'rgba(255, 152, 0, 0.06)',
                borderWidth: 0,
                drawTime: 'beforeDatasetsDraw',
            },
            severeZone: {
                type: 'box',
                yMin: 7, yMax: 9,
                backgroundColor: 'rgba(244, 67, 54, 0.06)',
                borderWidth: 0,
                drawTime: 'beforeDatasetsDraw',
            },
            locationThreshold: {
                type: 'line',
                yMin: kpThreshold, yMax: kpThreshold,
                borderColor: 'rgba(255, 152, 0, 0.5)',
                borderWidth: 1.5,
                borderDash: [4, 4],
                drawTime: 'beforeDatasetsDraw',
                label: {
                    display: true,
                    content: thresholdLabel,
                    position: 'end',
                    font: { size: 9, weight: 'bold' },
                    color: 'rgba(255, 152, 0, 0.8)',
                    backgroundColor: 'transparent',
                    padding: 2,
                }
            },
            nowLine: {
                type: 'line',
                xMin: nowIndex, xMax: nowIndex,
                borderColor: 'rgba(255, 255, 255, 0.5)',
                borderWidth: 1.5,
                borderDash: [3, 3],
                drawTime: 'afterDatasetsDraw',
                label: {
                    display: true,
                    content: 'Now',
                    position: 'start',
                    font: { size: 9 },
                    color: 'rgba(255, 255, 255, 0.8)',
                    backgroundColor: 'rgba(10, 10, 30, 0.7)',
                    padding: { top: 2, bottom: 2, left: 4, right: 4 },
                    borderRadius: 3,
                }
            }
        };

        var chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 10, 30, 0.9)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    titleFont: { size: 11 },
                    bodyFont: { size: 11 },
                    cornerRadius: 8,
                    padding: 8,
                    callbacks: {
                        title: function (items) {
                            return items[0].label.replace('\n', ' ');
                        },
                        label: function (context) {
                            var val = context.parsed.y;
                            if (val === null) return null;
                            return context.dataset.label + ': Kp ' + val.toFixed(1) + ' (' + kpSeverityLabel(val) + ')';
                        }
                    }
                },
                annotation: {
                    annotations: annotationBoxes
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                    },
                    ticks: {
                        color: 'rgba(160, 160, 184, 0.7)',
                        font: { size: 9 },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                        callback: function (value, index) {
                            var label = this.getLabelForValue(value);
                            if (typeof label === 'string' && label.indexOf('\n') > -1) {
                                var parts = label.split('\n');
                                if (parts[1] === '00:00') return parts[0];
                                return parts[1];
                            }
                            return label;
                        }
                    }
                },
                y: {
                    min: 0,
                    max: 9,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                    },
                    ticks: {
                        color: 'rgba(160, 160, 184, 0.7)',
                        font: { size: 9 },
                        stepSize: 1,
                        callback: function (value) {
                            if (value === 0) return '0';
                            if (value === 3) return '3';
                            if (value === 5) return '5';
                            if (value === 7) return '7';
                            if (value === 9) return '9';
                            return '';
                        }
                    }
                }
            }
        };

        if (kpChart) {
            // Update existing chart
            kpChart.data = chartData;
            kpChart.options.plugins.annotation.annotations.nowLine.xMin = nowIndex;
            kpChart.options.plugins.annotation.annotations.nowLine.xMax = nowIndex;
            kpChart.update('none');
        } else {
            // Create new chart
            kpChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: chartData,
                options: chartOptions,
            });
        }
    }

    // ── Fetch space weather status ──
    function updateAuroraStatus() {
        fetch('/api/space-weather')
            .then(function (r) { return r.json(); })
            .then(function (data) {

                // Update dynamic globals if they changed
                if (data.kp_threshold) kpThreshold = data.kp_threshold;
                if (data.location_name) userLocation = data.location_name;

                // ── Navbar status dot ──
                var dot = document.getElementById('auroraStatusDot');
                if (dot) {
                    dot.classList.remove('status-green', 'status-yellow', 'status-amber', 'status-red');
                    var status = (data.aurorawatch_status || '').toLowerCase();
                    if (status === 'red') {
                        dot.classList.add('status-red');
                        dot.title = 'Aurora alert: Red \u2014 aurora likely';
                    } else if (status === 'amber') {
                        dot.classList.add('status-amber');
                        dot.title = 'Aurora alert: Amber \u2014 aurora possible';
                    } else if (status === 'yellow') {
                        dot.classList.add('status-yellow');
                        dot.title = 'Minor activity detected';
                    } else if (status === 'green') {
                        dot.classList.add('status-green');
                        dot.title = 'Quiet \u2014 no significant activity';
                    }
                }

                // ── Kp Index — update radial gauge ──
                if (data.kp_index !== null && data.kp_index !== undefined) {
                    var kp = parseFloat(data.kp_index);

                    // Render the radial gauge
                    renderRadialGauge(kp, 'radialGauge');

                    // Update aurora chance indicator (use server's condition-aware label)
                    var chance = data.aurora_chance || data.cornwall_chance || auroraChanceLabel(kp);
                    var chanceIndicator = document.getElementById('chanceIndicator');
                    var chanceText = document.getElementById('chanceText');
                    if (chanceIndicator) {
                        chanceIndicator.className = 'chance-indicator chance-' + (chance.level || 'unknown');
                    }
                    if (chanceText) {
                        chanceText.textContent = chance.text || 'Unknown';
                    }
                }

                // ── Predicted Kp gauge ──
                if (data.kp_predicted_next !== null && data.kp_predicted_next !== undefined) {
                    var predKp = parseFloat(data.kp_predicted_next);
                    renderRadialGauge(predKp, 'radialGaugePredicted');
                } else {
                    renderRadialGauge(0, 'radialGaugePredicted');
                }

                // ── AuroraWatch badge ──
                var awEl = document.getElementById('awStatus');
                if (awEl) {
                    var st = (data.aurorawatch_status || 'unknown').toLowerCase();
                    awEl.textContent = st.charAt(0).toUpperCase() + st.slice(1);
                    awEl.className = 'weather-status-badge';
                    if (st) awEl.classList.add('status-' + st);
                }

                // ── Aurora note ──
                var noteEl = document.getElementById('cornwallNote');
                if (noteEl && (data.aurora_note || data.cornwall_note)) {
                    noteEl.textContent = data.aurora_note || data.cornwall_note;
                }

                // ── Moon phase ──
                if (data.moon_phase) {
                    var moonName = document.getElementById('moonPhaseName');
                    var moonIllum = document.getElementById('moonIllumination');
                    var moonNote = document.querySelector('.moon-note');

                    if (moonName) moonName.textContent = data.moon_phase.phase_name;
                    if (moonIllum) moonIllum.textContent = data.moon_phase.illumination + '% illuminated';
                    if (moonNote) {
                        moonNote.textContent = data.moon_phase.note;
                        moonNote.className = 'moon-note ' +
                            (data.moon_phase.is_favorable ? 'moon-favorable' : 'moon-unfavorable');
                    }

                    // Update CSS moon visual
                    if (data.moon_phase.phase_fraction !== undefined) {
                        var mv = document.getElementById('moonVisual');
                        if (mv) mv.setAttribute('data-phase', data.moon_phase.phase_fraction);
                        renderMoonPhase(data.moon_phase.phase_fraction);
                    }

                    // Update moonrise/moonset times
                    var moonRiseSet = document.querySelector('.moon-rise-set');
                    if (moonRiseSet) {
                        var rsHtml = '';
                        if (data.moon_phase.moonrise) {
                            rsHtml += '<span class="moon-time"><i class="bi bi-arrow-up-circle me-1"></i>Rises ' + data.moon_phase.moonrise + '</span>';
                        }
                        if (data.moon_phase.moonset) {
                            rsHtml += '<span class="moon-time"><i class="bi bi-arrow-down-circle me-1"></i>Sets ' + data.moon_phase.moonset + '</span>';
                        }
                        moonRiseSet.innerHTML = rsHtml;
                    }
                }

                // ── Darkness info ──
                if (data.darkness_info) {
                    var di = data.darkness_info;
                    var darkStatus = document.getElementById('darknessStatus');
                    if (darkStatus) {
                        darkStatus.textContent = di.darkness_label || 'Unknown';
                        darkStatus.className = 'darkness-status darkness-' + (di.darkness_status || 'unknown');
                    }
                    var darkTimes = document.getElementById('darknessTimes');
                    if (darkTimes) {
                        var dtHtml = '';
                        if (di.sunset) dtHtml += '<span class="dark-time"><i class="bi bi-sunset me-1"></i>Sunset ' + di.sunset + '</span>';
                        if (di.sunrise) dtHtml += '<span class="dark-time"><i class="bi bi-sunrise me-1"></i>Sunrise ' + di.sunrise + '</span>';
                        darkTimes.innerHTML = dtHtml;
                    }
                }

                // ── Current weather (right now) ──
                if (data.current_weather) {
                    var cw = data.current_weather;

                    var weatherIcon = document.getElementById('weatherIcon');
                    if (weatherIcon) {
                        weatherIcon.className = 'bi bi-' + (cw.weather_icon || 'question-circle');
                    }

                    var weatherDesc = document.getElementById('weatherDesc');
                    if (weatherDesc) weatherDesc.textContent = cw.weather_description || 'Unknown';

                    var currentCloud = document.getElementById('currentCloud');
                    if (currentCloud) currentCloud.textContent = (cw.cloud_cover !== null ? cw.cloud_cover + '%' : '--%');

                    var currentCloudBar = document.getElementById('currentCloudBar');
                    if (currentCloudBar) currentCloudBar.style.width = (cw.cloud_cover || 0) + '%';

                    // Update cloud layer breakdown
                    var layersMini = document.getElementById('cloudLayersMini');
                    if (cw.cloud_cover_high !== null && cw.cloud_cover_high !== undefined) {
                        if (!layersMini) {
                            // Create layers element if it doesn't exist yet (first UKMO response after generic)
                            var cloudStat = currentCloudBar ? currentCloudBar.closest('.weather-stat') : null;
                            if (cloudStat) {
                                var layersHtml = '<div class="cloud-layers-mini" id="cloudLayersMini">';
                                layersHtml += '<div class="cloud-layer-row"><span class="cloud-layer-label">High</span><div class="cloud-layer-bar"><div class="cloud-layer-fill cloud-layer-high" id="cloudLayerHighFill" style="width:0%"></div></div><span class="cloud-layer-pct" id="cloudLayerHighPct">--%</span></div>';
                                layersHtml += '<div class="cloud-layer-row"><span class="cloud-layer-label">Mid</span><div class="cloud-layer-bar"><div class="cloud-layer-fill cloud-layer-mid" id="cloudLayerMidFill" style="width:0%"></div></div><span class="cloud-layer-pct" id="cloudLayerMidPct">--%</span></div>';
                                layersHtml += '<div class="cloud-layer-row"><span class="cloud-layer-label">Low</span><div class="cloud-layer-bar"><div class="cloud-layer-fill cloud-layer-low" id="cloudLayerLowFill" style="width:0%"></div></div><span class="cloud-layer-pct" id="cloudLayerLowPct">--%</span></div>';
                                layersHtml += '</div>';
                                var barMini = cloudStat.querySelector('.cloud-bar-mini');
                                if (barMini) barMini.insertAdjacentHTML('afterend', layersHtml);
                                layersMini = document.getElementById('cloudLayersMini');
                            }
                        }
                        if (layersMini) {
                            var hFill = document.getElementById('cloudLayerHighFill');
                            var mFill = document.getElementById('cloudLayerMidFill');
                            var lFill = document.getElementById('cloudLayerLowFill');
                            var hPct = document.getElementById('cloudLayerHighPct');
                            var mPct = document.getElementById('cloudLayerMidPct');
                            var lPct = document.getElementById('cloudLayerLowPct');
                            if (hFill) hFill.style.width = (cw.cloud_cover_high || 0) + '%';
                            if (mFill) mFill.style.width = (cw.cloud_cover_mid || 0) + '%';
                            if (lFill) lFill.style.width = (cw.cloud_cover_low || 0) + '%';
                            if (hPct) hPct.textContent = (cw.cloud_cover_high !== null ? cw.cloud_cover_high + '%' : '--%');
                            if (mPct) mPct.textContent = (cw.cloud_cover_mid !== null ? cw.cloud_cover_mid + '%' : '--%');
                            if (lPct) lPct.textContent = (cw.cloud_cover_low !== null ? cw.cloud_cover_low + '%' : '--%');
                        }
                    }

                    // Update model badge
                    var modelBadge = document.getElementById('cloudModelBadge');
                    if (cw.cloud_model) {
                        if (!modelBadge) {
                            var cloudStat2 = currentCloudBar ? currentCloudBar.closest('.weather-stat') : null;
                            if (cloudStat2) {
                                cloudStat2.insertAdjacentHTML('beforeend', '<span class="cloud-model-badge" id="cloudModelBadge">' + cw.cloud_model + '</span>');
                            }
                        } else {
                            modelBadge.textContent = cw.cloud_model;
                        }
                    }

                    var currentTemp = document.getElementById('currentTemp');
                    if (currentTemp) currentTemp.innerHTML = (cw.temperature !== null ? cw.temperature + '&deg;C' : '--&deg;C');

                    var currentVis = document.getElementById('currentVisibility');
                    if (currentVis) currentVis.textContent = (cw.visibility_km !== null ? cw.visibility_km + ' km' : '-- km');

                    var viewingLabel = document.getElementById('currentViewingLabel');
                    if (viewingLabel) {
                        viewingLabel.textContent = cw.cloud_label || 'Unknown';
                        viewingLabel.className = 'weather-viewing-label weather-viewing-' + (cw.cloud_level || 'unknown');
                    }

                    // Update weather panel condition + time-of-day classes
                    var weatherPanel = document.querySelector('.cond-weather-now');
                    if (weatherPanel) {
                        // Remove old weather-wmo-* and weather-time-* classes
                        var cls = weatherPanel.className.split(' ').filter(function(c) {
                            return !c.startsWith('weather-wmo-') && !c.startsWith('weather-time-');
                        });
                        // Add current weather code class
                        if (cw.weather_code !== null && cw.weather_code !== undefined) {
                            cls.push('weather-wmo-' + cw.weather_code);
                        }
                        // Add darkness status class (from darkness_info if available)
                        if (data.darkness_info && data.darkness_info.darkness_status) {
                            cls.push('weather-time-' + data.darkness_info.darkness_status);
                        }
                        weatherPanel.className = cls.join(' ');
                        weatherPanel.setAttribute('data-weather-code', cw.weather_code || '');
                        weatherPanel.setAttribute('data-darkness', (data.darkness_info && data.darkness_info.darkness_status) || '');
                    }

                    // ── Update wind display and rain angle ──
                    updateWindDisplay(cw);
                }

                // ── Aurora Conditions Tonight panel ──
                updateAuroraTonightPanel(data);

                // ── Hourly cloud forecast mini-chart ──
                if (data.hourly_cloud_forecast && data.hourly_cloud_forecast.length > 0) {
                    var barsContainer = document.getElementById('hourlyCloudBars');
                    if (barsContainer) {
                        var cHtml = '';
                        for (var ci = 0; ci < data.hourly_cloud_forecast.length; ci++) {
                            var ch = data.hourly_cloud_forecast[ci];
                            var tooltip = ch.hour + ': ' + ch.cloud_pct + '% cloud';
                            if (ch.cloud_high !== null && ch.cloud_high !== undefined) {
                                tooltip += ' (H:' + ch.cloud_high + '% M:' + ch.cloud_mid + '% L:' + ch.cloud_low + '%)';
                            }
                            cHtml += '<div class="hourly-bar-col" title="' + tooltip + '">';
                            cHtml += '<span class="hourly-bar-pct">' + ch.cloud_pct + '</span>';
                            cHtml += '<div class="hourly-bar-bg"><div class="hourly-bar-fill" style="height:' + ch.cloud_pct + '%"></div></div>';
                            cHtml += '<span class="hourly-bar-time">' + ch.hour.slice(0, 2) + '</span>';
                            cHtml += '</div>';
                        }
                        barsContainer.innerHTML = cHtml;
                    }
                }

                // ── "Should I go outside?" verdict ──
                if (data.go_outside) {
                    var v = data.go_outside;
                    var verdictPanel = document.getElementById('verdictPanel');
                    if (verdictPanel) {
                        verdictPanel.className = 'cond-panel cond-verdict-panel verdict-' + (v.level || 'no');
                    }

                    var verdictAnswer = document.getElementById('verdictAnswer');
                    if (verdictAnswer) verdictAnswer.textContent = v.verdict || 'Checking...';

                    var verdictReasons = document.getElementById('verdictReasons');
                    if (verdictReasons && v.reasons) {
                        verdictReasons.innerHTML = '';
                        for (var ri = 0; ri < v.reasons.length; ri++) {
                            var li = document.createElement('li');
                            li.textContent = v.reasons[ri];
                            verdictReasons.appendChild(li);
                        }
                    }
                }

                // ── Best Viewing Window ──
                var bwEl = document.getElementById('bestWindow');
                if (data.best_viewing_window) {
                    var bw = data.best_viewing_window;
                    if (!bwEl) {
                        // Create the element if it doesn't exist
                        var verdictPanel = document.getElementById('verdictPanel');
                        if (verdictPanel) {
                            bwEl = document.createElement('div');
                            bwEl.id = 'bestWindow';
                            verdictPanel.appendChild(bwEl);
                        }
                    }
                    if (bwEl) {
                        if (bw.window) {
                            bwEl.className = 'best-window best-window-' + (bw.quality || 'marginal');
                            var bwHtml = '<i class="bi bi-clock-fill me-1"></i>Best window: <strong>' + bw.window + '</strong>';
                            if (bw.avg_cloud !== null && bw.avg_cloud !== undefined) {
                                bwHtml += ' <span class="bw-cloud">(~' + bw.avg_cloud + '% cloud)</span>';
                            }
                            bwEl.innerHTML = bwHtml;
                        } else {
                            bwEl.className = 'best-window best-window-none';
                            bwEl.innerHTML = '<i class="bi bi-clock me-1"></i>' + (bw.summary || 'No clear window tonight');
                        }
                    }
                }

                // ── Solar Wind ──
                if (data.solar_wind) {
                    var swSpeed = document.getElementById('solarWindSpeed');
                    var swDensity = document.getElementById('solarWindDensity');
                    var swLabel = document.getElementById('solarWindLabel');
                    var swPanel = document.querySelector('.cond-solar-wind');
                    var speedLevel = data.solar_wind.speed_level || 'unknown';
                    var newSpeedVal = data.solar_wind.speed || '--';
                    if (swSpeed) {
                        // Flash on value change
                        if (window.__prevSolarWindSpeed !== undefined && window.__prevSolarWindSpeed !== newSpeedVal) {
                            swSpeed.classList.add('sw-flash');
                            setTimeout(function() { swSpeed.classList.remove('sw-flash'); }, 500);
                        }
                        window.__prevSolarWindSpeed = newSpeedVal;
                        swSpeed.textContent = newSpeedVal;
                        var shimmer = (speedLevel === 'elevated' || speedLevel === 'high' || speedLevel === 'extreme') ? ' sw-shimmer' : '';
                        swSpeed.className = 'sw-value sw-speed-' + speedLevel + shimmer;
                    }
                    if (swDensity) swDensity.textContent = data.solar_wind.density || '--';
                    if (swLabel) {
                        swLabel.textContent = data.solar_wind.speed_label || 'No data';
                        swLabel.className = 'sw-level-label sw-speed-' + speedLevel;
                    }
                    // Update panel glow intensity based on speed level
                    if (swPanel) {
                        swPanel.classList.remove('sw-elevated', 'sw-high', 'sw-extreme');
                        if (speedLevel === 'elevated') swPanel.classList.add('sw-elevated');
                        else if (speedLevel === 'high') swPanel.classList.add('sw-high');
                        else if (speedLevel === 'extreme') swPanel.classList.add('sw-extreme');
                    }
                }

                // ── IMF Bz ──
                if (data.imf_data) {
                    var bzVal = data.imf_data.bz;
                    var imfBzEl = document.getElementById('imfBzValue');
                    var imfArrow = document.getElementById('imfArrow');
                    var imfLabel = document.getElementById('imfBzLabel');
                    var imfPanel = document.querySelector('.cond-imf');
                    if (imfBzEl) {
                        imfBzEl.textContent = bzVal != null ? bzVal.toFixed(1) : '--';
                        imfBzEl.className = 'imf-value imf-' + (data.imf_data.bz_level || 'unknown');
                    }
                    if (imfArrow) {
                        if (bzVal != null && bzVal <= 0) {
                            imfArrow.innerHTML = '&darr;';
                            imfArrow.className = 'imf-arrow imf-south';
                        } else {
                            imfArrow.innerHTML = '&uarr;';
                            imfArrow.className = 'imf-arrow imf-north';
                        }
                    }
                    if (imfLabel) {
                        imfLabel.textContent = data.imf_data.bz_label || 'No data';
                        imfLabel.className = 'imf-label imf-' + (data.imf_data.bz_level || 'unknown');
                    }
                    // Update IMF panel wave animation — speed scales with Bz magnitude
                    if (imfPanel) {
                        imfPanel.classList.remove('imf-south-weak', 'imf-south-moderate', 'imf-south-strong', 'imf-south-extreme');
                        if (bzVal != null && bzVal <= -20) {
                            imfPanel.classList.add('imf-south-extreme');
                        } else if (bzVal != null && bzVal <= -10) {
                            imfPanel.classList.add('imf-south-strong');
                        } else if (bzVal != null && bzVal <= -5) {
                            imfPanel.classList.add('imf-south-moderate');
                        } else if (bzVal != null && bzVal <= 0) {
                            imfPanel.classList.add('imf-south-weak');
                        }
                        // northward (Bz > 0): no class = base slow grey drift
                    }
                }

                // ── NOAA Storm Scale ──
                if (data.noaa_scales) {
                    var gBadge = document.getElementById('gScaleBadge');
                    var gText = document.getElementById('gScaleText');
                    var gsPanel = document.querySelector('.cond-scales');
                    var newGScale = data.noaa_scales.g_scale || 0;
                    if (gBadge) {
                        // Flash on value change
                        if (window.__prevGScale !== undefined && window.__prevGScale !== newGScale) {
                            gBadge.classList.add('g-flash');
                            setTimeout(function() { gBadge.classList.remove('g-flash'); }, 600);
                        }
                        window.__prevGScale = newGScale;
                        gBadge.textContent = 'G' + newGScale;
                        gBadge.className = 'g-scale-badge g-scale-' + newGScale + (newGScale >= 1 ? ' g-scale-active' : '');
                    }
                    if (gText) gText.textContent = data.noaa_scales.g_text || 'None';
                    // Update panel glow for active storms
                    if (gsPanel) {
                        if (newGScale >= 1) gsPanel.classList.add('gs-active');
                        else gsPanel.classList.remove('gs-active');
                    }
                }

                // ── Light Pollution (updates if user changed location) ──
                if (data.light_pollution) {
                    var lp = data.light_pollution;
                    var bortleClass = document.querySelector('.bortle-class');
                    if (bortleClass) bortleClass.textContent = 'Bortle ' + lp.bortle;
                    var bortleLabel = document.querySelector('.bortle-label');
                    if (bortleLabel) bortleLabel.textContent = lp.label || '';
                    var bortleAdvice = document.querySelector('.bortle-advice');
                    if (bortleAdvice) bortleAdvice.textContent = lp.advice || '';
                    var dots = document.querySelectorAll('.bortle-dot');
                    for (var di = 0; di < dots.length; di++) {
                        if (di < lp.bortle) {
                            dots[di].classList.add('bortle-filled');
                        } else {
                            dots[di].classList.remove('bortle-filled');
                        }
                        if (di === lp.bortle - 1) {
                            dots[di].classList.add('bortle-current');
                        } else {
                            dots[di].classList.remove('bortle-current');
                        }
                    }
                }

                // ── SWPC Alerts ──
                var alertsSection = document.getElementById('alertsSection');
                if (alertsSection) {
                    if (data.swpc_alerts && data.swpc_alerts.length > 0) {
                        alertsSection.style.display = 'block';
                        var html = '<div class="section-badge alert-badge">' +
                            '<i class="bi bi-exclamation-triangle-fill me-1"></i> SPACE WEATHER ALERTS</div>' +
                            '<div class="alerts-list">';
                        for (var ai = 0; ai < data.swpc_alerts.length; ai++) {
                            var a = data.swpc_alerts[ai];
                            html += '<div class="swpc-alert-card">' +
                                '<span class="alert-product-id">' + (a.product_id || '') + '</span>' +
                                '<div class="alert-content">' +
                                '<span class="alert-summary">' + (a.summary || '') + '</span>';
                            if (a.friendly_explanation) {
                                html += '<span class="alert-explanation">' + a.friendly_explanation + '</span>';
                            }
                            if (a.valid_from || a.valid_until) {
                                html += '<span class="alert-validity"><i class="bi bi-clock me-1"></i>' +
                                    (a.valid_from || '?') + ' &rarr; ' + (a.valid_until || '?') + '</span>';
                            }
                            html += '</div>' +
                                '<span class="alert-time">' + (a.issue_datetime || '').slice(0, 16) + '</span>' +
                                '</div>';
                        }
                        html += '</div>';
                        alertsSection.innerHTML = html;
                    } else {
                        alertsSection.style.display = 'none';
                    }
                }

                // ── Update Aurora View conditions on refresh ──
                var cwData = data.current_weather || {};
                var diData = data.darkness_info || {};
                var newViewData = {
                    kp: data.kp_index,
                    kpThreshold: kpThreshold,
                    cloudCover: cwData.cloud_cover || 0,
                    darknessStatus: diData.darkness_status || 'unknown',
                    moonIllumination: (data.moon_phase && data.moon_phase.illumination) || 0,
                    moonPhase: (data.moon_phase && data.moon_phase.phase_fraction) || 0,
                    lat: window.__userLat,
                    locationName: userLocation,
                    bortle: (data.light_pollution && data.light_pollution.bortle) || 5,
                    weatherCode: cwData.weather_code || 0,
                    weatherDescription: cwData.weather_description || '',
                    windSpeed: cwData.wind_speed || 0,
                    windDirection: cwData.wind_direction || 0,
                    windGusts: cwData.wind_gusts || 0,
                    windLevel: cwData.wind_classification || 'calm',
                    visibilityKm: cwData.visibility_km || 10,
                    temperature: cwData.temperature || 10,
                    sunset: diData.sunset || '',
                    sunrise: diData.sunrise || ''
                };
                window.__auroraViewData = newViewData;
                auroraViewState.conditions = newViewData;
                // Restart view animation with new data
                if (auroraViewState.animFrameId) {
                    cancelAnimationFrame(auroraViewState.animFrameId);
                    auroraViewState.animFrameId = null;
                }
                initAuroraView();

                // ── Update aurora oval map darkness status for time-of-day rendering ──
                var prevDarkness = auroraState.darknessStatus;
                auroraState.darknessStatus = diData.darkness_status || 'dark';
                if (auroraState.darknessStatus !== prevDarkness) {
                    // Rebuild static layers with new palette
                    var ovalCanvas = document.getElementById('auroraOvalCanvas');
                    if (ovalCanvas) {
                        var ow = ovalCanvas.width, oh = ovalCanvas.height;
                        var oLatMin = 40, oLatMax = 72, oLonMin = -30, oLonMax = 30;
                        function oLonToX(lon) { return ((lon - oLonMin) / (oLonMax - oLonMin)) * ow; }
                        function oLatToY(lat) { return ((oLatMax - lat) / (oLatMax - oLatMin)) * oh; }
                        buildLandLayer(ow, oh, oLonToX, oLatToY);
                        buildOverlayLayer(ow, oh, oLonToX, oLatToY, oLatMin, oLatMax, oLonMin, oLonMax);
                        if (cloudGridState.data) {
                            buildCloudLayer(ow, oh);
                        }
                    }
                }

                // ── Live timestamp (with relative time) ──
                var tsEl = document.getElementById('liveTimestamp');
                if (tsEl && data.kp_timestamp) {
                    var ts = data.kp_timestamp.slice(0, 16);
                    tsEl.textContent = 'Updated ' + ts;
                    // Store timestamp for relative time display
                    window.__lastUpdateTime = new Date();
                }

                // ── Update Kp timeline chart ──
                if (data.kp_timeline) {
                    renderKpChart(data.kp_timeline);
                }
            })
            .catch(function () {
                // Silently fail — space weather is non-critical
            });
    }

    // ═══════════════════════════════════════════════
    // LOCATION PICKER
    // ═══════════════════════════════════════════════

    function initLocationPicker() {
        var feedbackEl = document.getElementById('locationFeedback');
        var postcodeInput = document.getElementById('postcodeInput');
        var btnGeo = document.getElementById('btnGeolocate');
        var btnPostcode = document.getElementById('btnPostcodeLookup');

        if (!feedbackEl) return; // Modal not in DOM

        function showFeedback(msg, type) {
            feedbackEl.className = 'small text-' + (type || 'info');
            feedbackEl.textContent = msg;
        }

        function saveLocation(lat, lon, name, ruralUrban) {
            showFeedback('Saving ' + name + '...', 'info');
            fetch('/api/set-location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: lat, lon: lon, name: name, rural_urban: ruralUrban || '' })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error) {
                    showFeedback(data.error, 'danger');
                    return;
                }
                showFeedback('Location set to ' + name + '! Reloading...', 'success');
                setTimeout(function () { window.location.reload(); }, 600);
            })
            .catch(function () {
                showFeedback('Network error. Please try again.', 'danger');
            });
        }

        // "Use My Location" button
        if (btnGeo) {
            btnGeo.addEventListener('click', function () {
                if (!navigator.geolocation) {
                    showFeedback('Geolocation is not supported by your browser.', 'danger');
                    return;
                }
                showFeedback('Finding your location...', 'info');
                btnGeo.disabled = true;

                navigator.geolocation.getCurrentPosition(
                    function (pos) {
                        var lat = pos.coords.latitude;
                        var lon = pos.coords.longitude;
                        // Reverse geocode to get place name
                        fetch('/api/reverse-geocode?lat=' + lat + '&lon=' + lon)
                            .then(function (r) { return r.json(); })
                            .then(function (geo) {
                                var name = geo.name || 'Your Location';
                                saveLocation(lat, lon, name, geo.rural_urban || '');
                            })
                            .catch(function () {
                                saveLocation(lat, lon, 'Your Location', '');
                            });
                    },
                    function (err) {
                        btnGeo.disabled = false;
                        if (err.code === 1) {
                            showFeedback('Location access denied. Use a postcode instead.', 'danger');
                        } else {
                            showFeedback('Could not determine location. Try a postcode.', 'danger');
                        }
                    },
                    { enableHighAccuracy: false, timeout: 10000 }
                );
            });
        }

        // Unified location search (postcode or town/city)
        function doLocationSearch() {
            var query = (postcodeInput.value || '').trim();
            if (!query || query.length < 2) {
                showFeedback('Please enter a UK postcode or town name.', 'danger');
                return;
            }
            showFeedback('Searching for ' + query + '...', 'info');
            btnPostcode.disabled = true;
            var resultsDiv = document.getElementById('placeResults');
            if (resultsDiv) resultsDiv.innerHTML = '';

            fetch('/api/place-search/' + encodeURIComponent(query))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    btnPostcode.disabled = false;
                    if (data.error || !data.results || data.results.length === 0) {
                        showFeedback(data.error || 'No results found. Try a different search.', 'danger');
                        return;
                    }

                    // Single result — save directly
                    if (data.results.length === 1) {
                        var r = data.results[0];
                        saveLocation(r.lat, r.lon, r.name, r.rural_urban || '');
                        return;
                    }

                    // Multiple results — show clickable list
                    showFeedback('Select your location:', 'info');
                    if (resultsDiv) {
                        var rHtml = '';
                        for (var ri = 0; ri < data.results.length; ri++) {
                            var place = data.results[ri];
                            rHtml += '<div class="place-result-item" data-lat="' + place.lat +
                                '" data-lon="' + place.lon +
                                '" data-name="' + (place.name || '').replace(/"/g, '&quot;') +
                                '" data-ru="' + (place.rural_urban || '') + '">' +
                                '<i class="bi bi-geo-alt"></i>' +
                                '<span>' + (place.description || place.name) + '</span>' +
                                '</div>';
                        }
                        resultsDiv.innerHTML = rHtml;

                        // Add click handlers to results
                        var items = resultsDiv.querySelectorAll('.place-result-item');
                        items.forEach(function(item) {
                            item.addEventListener('click', function() {
                                var lat = parseFloat(this.getAttribute('data-lat'));
                                var lon = parseFloat(this.getAttribute('data-lon'));
                                var name = this.getAttribute('data-name');
                                var ru = this.getAttribute('data-ru');
                                resultsDiv.innerHTML = '';
                                saveLocation(lat, lon, name, ru);
                            });
                        });
                    }
                })
                .catch(function () {
                    btnPostcode.disabled = false;
                    showFeedback('Search failed. Please try again.', 'danger');
                });
        }

        if (btnPostcode) {
            btnPostcode.addEventListener('click', doLocationSearch);
        }

        // Allow Enter key in search input
        if (postcodeInput) {
            postcodeInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doLocationSearch();
                }
            });
        }

        // Auto-show modal on first visit (no location set)
        if (window.__hasLocation === false) {
            var locationModal = document.getElementById('locationModal');
            if (locationModal && typeof bootstrap !== 'undefined') {
                var modal = new bootstrap.Modal(locationModal);
                // Small delay so page renders first
                setTimeout(function () { modal.show(); }, 800);
            }
        }
    }

    // ── Initial radial gauge render from server-side data ──
    var gaugeContainer = document.getElementById('radialGauge');
    if (gaugeContainer) {
        var initialKp = parseFloat(gaugeContainer.getAttribute('data-kp')) || 0;
        renderRadialGauge(initialKp, 'radialGauge');
    }

    // ── Initial predicted gauge render ──
    var gaugeContainerPred = document.getElementById('radialGaugePredicted');
    if (gaugeContainerPred) {
        var initialKpPred = parseFloat(gaugeContainerPred.getAttribute('data-kp')) || 0;
        renderRadialGauge(initialKpPred, 'radialGaugePredicted');
    }

    // ── Initial chart render from server-side data ──
    if (window.__kpTimeline && window.__kpTimeline.length > 0) {
        renderKpChart(window.__kpTimeline);
    }

    // ── Initial wind angle calculation from data attribute ──
    (function() {
        var weatherPanel = document.querySelector('.cond-weather-now');
        if (weatherPanel) {
            var initialSpeed = parseFloat(weatherPanel.getAttribute('data-wind-speed')) || 0;
            var angle = calculateRainAngle(initialSpeed);
            weatherPanel.style.setProperty('--rain-angle', angle + 'deg');
            weatherPanel.style.setProperty('--wind-speed', initialSpeed);
        }
    })();

    // ── Location picker ──
    initLocationPicker();

    // ── Info tooltip toggle buttons ──
    document.querySelectorAll('.info-tooltip-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            // Find the next sibling .info-tooltip-content
            var content = btn.closest('.cond-panel, .chart-panel, .section-badge, .cond-status-header, .panel-header-row, .verdict-header, .cond-kp-label, .weather-now-label, .moon-header-row, .chart-title');
            if (content) {
                var tip = content.parentElement
                    ? content.parentElement.querySelector('.info-tooltip-content')
                    : null;
                // Also try sibling
                if (!tip) {
                    tip = content.nextElementSibling;
                    if (tip && !tip.classList.contains('info-tooltip-content')) tip = null;
                }
                if (tip) {
                    tip.classList.toggle('expanded');
                }
            }
        });
    });

    // ═══════════════════════════════════════════════
    // SKY EVENTS — expand/collapse + filter
    // ═══════════════════════════════════════════════

    // Accordion: click to expand/collapse event cards
    document.querySelectorAll('.event-card').forEach(function(card) {
        card.addEventListener('click', function() {
            // Close any other expanded card (accordion)
            document.querySelectorAll('.event-card.expanded').forEach(function(other) {
                if (other !== card) other.classList.remove('expanded');
            });
            card.classList.toggle('expanded');
        });
    });

    // Filter buttons: show/hide events by type
    document.querySelectorAll('.event-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var filter = btn.getAttribute('data-filter');

            // Update active button
            document.querySelectorAll('.event-filter-btn').forEach(function(b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');

            // Show/hide event cards
            document.querySelectorAll('.event-card').forEach(function(card) {
                if (filter === 'all' || card.getAttribute('data-event-type') === filter) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                    card.classList.remove('expanded');
                }
            });

            // Show/hide month headings if all events in that month are hidden
            document.querySelectorAll('.event-month').forEach(function(heading) {
                var next = heading.nextElementSibling;
                var hasVisible = false;
                while (next && !next.classList.contains('event-month')) {
                    if (next.classList.contains('event-card') && next.style.display !== 'none') {
                        hasVisible = true;
                    }
                    next = next.nextElementSibling;
                }
                heading.style.display = hasVisible ? '' : 'none';
            });
        });
    });

    // ═══════════════════════════════════════════════
    // DATA FRESHNESS — relative time display
    // ═══════════════════════════════════════════════

    window.__lastUpdateTime = new Date();
    setInterval(function() {
        var tsEl = document.getElementById('liveTimestamp');
        var refreshEl = document.getElementById('refreshCountdown');
        if (!tsEl) return;

        var elapsed = Math.floor((new Date() - window.__lastUpdateTime) / 1000);
        var mins = Math.floor(elapsed / 60);
        if (mins < 1) {
            tsEl.textContent = 'Updated just now';
        } else if (mins === 1) {
            tsEl.textContent = 'Updated 1 min ago';
        } else {
            tsEl.textContent = 'Updated ' + mins + ' min ago';
        }

        // Countdown to next refresh
        if (refreshEl) {
            var remaining = Math.max(0, 300 - elapsed);
            var rMin = Math.floor(remaining / 60);
            var rSec = remaining % 60;
            refreshEl.textContent = 'Next refresh ' + rMin + ':' + (rSec < 10 ? '0' : '') + rSec;
        }
    }, 10000); // Update every 10 seconds

    // ═══════════════════════════════════════════════
    // AURORA OVAL MAP (NOAA OVATION model)
    // Smooth multi-layer rendering with animation
    // ═══════════════════════════════════════════════

    // Persistent state for layered rendering + animation
    var auroraState = {
        auroraCanvas: null,   // offscreen: blurred aurora texture
        landCanvas: null,     // offscreen: land fills (below aurora)
        overlayCanvas: null,  // offscreen: coastlines + grid + marker
        cloudCanvas: null,    // offscreen: cloud overlay + wind arrows
        animFrameId: null,    // requestAnimationFrame handle
        animStartTime: 0,     // for sinusoidal shimmer timing
        darknessStatus: 'dark' // updated from API: dark/astronomical_twilight/nautical_twilight/civil_twilight/daylight
    };

    // Cloud grid state for map overlay
    var cloudGridState = {
        data: null,           // raw API response from /api/cloud-grid
        lastFetch: 0,         // timestamp of last successful fetch
        hourOffset: 0         // slider position (0 = now, up to 11)
    };

    // Seeded PRNG (mulberry32) — deterministic random per grid point
    function mulberry32(seed) {
        return function() {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // Accurate European coastline data — Natural Earth derived
    // Each region has: coast (stroke path) and fill (closed polygon)
    // ═══════════════════════════════════════════════════════════════
    var euroCoastData = {
        // NORWAY — 75 points: southern tip to Nordkapp with fjord indentations
        norwayCoast: [
            [5.0,58.1],[5.3,58.4],[5.6,58.8],[5.2,59.0],[5.3,59.2],[5.6,59.4],[5.2,59.6],
            [5.0,59.8],[5.3,60.0],[5.1,60.2],[5.3,60.4],[5.0,60.7],[4.9,60.9],[5.1,61.0],
            [5.4,61.2],[5.1,61.4],[4.8,61.6],[5.0,61.8],[5.2,62.0],[5.6,62.1],[5.3,62.3],
            [5.1,62.5],[5.5,62.7],[6.1,62.8],[6.5,62.7],[6.8,63.0],[7.2,63.1],[7.5,62.9],
            [8.0,63.2],[8.5,63.3],[9.0,63.5],[9.5,63.6],[9.8,63.4],[10.2,63.6],[10.8,63.5],
            [11.0,63.8],[11.5,64.0],[11.8,64.3],[12.2,64.6],[12.8,65.0],[13.2,65.2],
            [13.5,65.5],[14.0,65.8],[14.2,66.0],[14.5,66.3],[14.8,66.6],[15.0,67.0],
            [15.3,67.3],[15.0,67.5],[15.2,67.8],[15.5,68.0],[15.8,68.2],[16.0,68.4],
            [16.5,68.5],[17.0,68.6],[17.5,68.8],[18.0,69.0],[18.5,69.2],[19.0,69.3],
            [19.5,69.5],[20.0,69.6],[20.5,69.8],[21.0,69.9],[22.0,70.0],[23.0,70.1],
            [24.5,70.0],[25.5,70.1],[26.5,70.5],[27.5,70.6],[28.5,70.7],[29.5,70.8],
            [30.0,70.5],[31.0,70.2],[30.0,69.8]
        ],
        norwayFill: [
            [5.0,58.1],[5.3,58.4],[5.6,58.8],[5.2,59.0],[5.3,59.2],[5.6,59.4],[5.2,59.6],
            [5.0,59.8],[5.3,60.0],[5.1,60.2],[5.3,60.4],[5.0,60.7],[4.9,60.9],[5.1,61.0],
            [5.4,61.2],[5.1,61.4],[4.8,61.6],[5.0,61.8],[5.2,62.0],[5.6,62.1],[5.3,62.3],
            [5.1,62.5],[5.5,62.7],[6.1,62.8],[6.5,62.7],[6.8,63.0],[7.2,63.1],[7.5,62.9],
            [8.0,63.2],[8.5,63.3],[9.0,63.5],[9.5,63.6],[9.8,63.4],[10.2,63.6],[10.8,63.5],
            [11.0,63.8],[11.5,64.0],[11.8,64.3],[12.2,64.6],[12.8,65.0],[13.2,65.2],
            [13.5,65.5],[14.0,65.8],[14.2,66.0],[14.5,66.3],[14.8,66.6],[15.0,67.0],
            [15.3,67.3],[15.0,67.5],[15.2,67.8],[15.5,68.0],[15.8,68.2],[16.0,68.4],
            [16.5,68.5],[17.0,68.6],[17.5,68.8],[18.0,69.0],[18.5,69.2],[19.0,69.3],
            [19.5,69.5],[20.0,69.6],[20.5,69.8],[21.0,69.9],[22.0,70.0],[23.0,70.1],
            [24.5,70.0],[25.5,70.1],[26.5,70.5],[27.5,70.6],[28.5,70.7],[29.5,70.8],
            [30.0,70.5],[31.0,70.2],[30.0,69.8],
            // Close along top edge and back
            [30.0,72.0],[5.0,72.0]
        ],

        // SWEDEN/FINLAND — 48 points: Scania to Gulf of Bothnia, east coast detail
        swedenCoast: [
            // Southern Sweden (Scania, Malmö)
            [12.8,55.4],[13.0,55.5],[13.4,55.4],[14.0,55.4],[14.3,55.5],[14.2,55.7],
            // East coast Sweden — Blekinge, Kalmar
            [14.5,56.0],[15.5,56.1],[16.3,56.2],[16.5,56.5],[16.7,56.9],[16.5,57.2],
            [16.7,57.7],[16.5,58.0],[16.8,58.4],
            // Stockholm archipelago
            [17.0,58.7],[18.0,59.0],[18.3,59.3],[18.1,59.5],[18.5,59.8],
            // Uppland, Gävle
            [18.2,60.2],[17.8,60.5],[17.5,60.7],[17.2,61.0],[17.5,61.5],
            // Ångermanland, Västernorrland
            [17.8,62.0],[18.0,62.3],[17.8,62.6],[18.2,63.0],[18.5,63.3],
            // Västerbotten, Norrbotten
            [19.0,63.5],[19.5,64.0],[20.0,64.5],[20.5,65.0],[21.0,65.2],
            [21.5,65.5],[22.0,65.7],[22.5,65.8],
            // Gulf of Bothnia — Finnish side
            [23.5,65.8],[24.0,65.5],[24.5,65.2],[25.0,65.0],[25.5,65.2],
            [26.0,65.5],[26.5,65.3],[27.0,65.5],[28.0,65.7],
            // Northern Finland border
            [29.0,66.0],[29.5,67.0],[29.0,68.0],[28.5,69.0],[29.0,69.5],[30.0,69.8]
        ],
        swedenFill: [
            // Southern tip
            [12.8,55.4],[13.0,55.5],[13.4,55.4],[14.0,55.4],[14.3,55.5],[14.2,55.7],
            [14.5,56.0],[15.5,56.1],[16.3,56.2],[16.5,56.5],[16.7,56.9],[16.5,57.2],
            [16.7,57.7],[16.5,58.0],[16.8,58.4],
            [17.0,58.7],[18.0,59.0],[18.3,59.3],[18.1,59.5],[18.5,59.8],
            [18.2,60.2],[17.8,60.5],[17.5,60.7],[17.2,61.0],[17.5,61.5],
            [17.8,62.0],[18.0,62.3],[17.8,62.6],[18.2,63.0],[18.5,63.3],
            [19.0,63.5],[19.5,64.0],[20.0,64.5],[20.5,65.0],[21.0,65.2],
            [21.5,65.5],[22.0,65.7],[22.5,65.8],
            [23.5,65.8],[24.0,65.5],[24.5,65.2],[25.0,65.0],[25.5,65.2],
            [26.0,65.5],[26.5,65.3],[27.0,65.5],[28.0,65.7],
            [29.0,66.0],[29.5,67.0],[29.0,68.0],[28.5,69.0],[29.0,69.5],[30.0,69.8],
            // Close via top-right edge, down right edge to Baltic, then west along coast
            [30.0,72.0],[30.0,58.0],[29.0,57.8],[28.0,57.5],[27.0,57.0],
            [26.0,56.5],[25.0,56.0],[24.0,55.5],[23.0,55.0],[22.0,54.5],
            [21.0,54.8],[20.5,54.5],[19.5,54.2],[18.5,54.4],[17.0,54.5],
            [16.0,54.2],[14.0,54.0],[13.0,54.3],[12.0,54.2],[11.0,54.5],
            [10.8,55.0],[10.3,55.5],[10.5,55.8],[10.2,56.2],[10.0,56.6],[10.3,57.0],
            // West coast back north (overlap with Norway at mountain range ~12-15°E)
            [10.6,57.4],[11.0,58.5],[10.8,59.0],[10.5,60.5],
            [11.5,61.5],[12.5,62.5],[13.5,63.5],[14.5,64.5],[15.5,66.0],[16.5,67.5],
            [18.0,68.5],[20.0,69.5],[22.0,70.0],[25.0,70.1],[28.0,70.5],[30.0,70.5]
        ],

        // NW EUROPE — 58 points: Brittany to Skagen with Jutland
        europeCoast: [
            // Brittany — western tip
            [-4.8,48.4],[-4.5,48.3],[-4.2,48.4],[-3.8,48.6],[-3.5,48.5],[-3.0,48.6],
            [-2.5,48.5],[-2.0,48.6],[-1.5,48.6],[-1.2,48.8],
            // Normandy
            [-1.0,49.2],[-0.5,49.4],[0.0,49.4],[0.3,49.5],
            // Pas-de-Calais
            [0.8,49.9],[1.2,50.2],[1.6,50.7],[1.8,50.9],
            // Belgian coast
            [2.5,51.1],[3.2,51.4],[3.6,51.4],
            // Dutch coast — Zeeland, Holland
            [3.8,51.5],[4.0,51.8],[4.2,52.0],[4.5,52.3],[4.7,52.6],[4.8,52.8],
            // Frisian islands area
            [5.0,53.0],[5.4,53.2],[5.8,53.4],[6.2,53.5],[6.8,53.6],[7.2,53.6],
            // German Bight
            [7.5,53.7],[8.0,53.8],[8.3,54.0],[8.6,54.1],[8.8,54.3],[9.0,54.5],
            // Schleswig-Holstein
            [9.2,54.8],[9.5,55.0],[9.8,55.2],
            // Jutland — west coast
            [8.6,55.6],[8.2,55.9],[8.1,56.3],[8.0,56.6],[8.2,56.8],[8.6,57.0],
            [9.0,57.1],[9.5,57.4],[9.8,57.6],
            // Skagen (tip of Denmark)
            [10.2,57.7],[10.5,57.6],[10.6,57.4],
            // Jutland — east coast (Kattegat side)
            [10.3,57.0],[10.0,56.6],[10.2,56.2],[10.5,55.8],[10.3,55.5],
            [10.0,55.3],[9.8,55.0]
        ],
        europeFill: [
            // Start west beyond map edge at bottom
            [-30.0,48.0],[-4.8,48.4],[-4.5,48.3],[-4.2,48.4],[-3.8,48.6],[-3.5,48.5],
            [-3.0,48.6],[-2.5,48.5],[-2.0,48.6],[-1.5,48.6],[-1.2,48.8],
            [-1.0,49.2],[-0.5,49.4],[0.0,49.4],[0.3,49.5],
            [0.8,49.9],[1.2,50.2],[1.6,50.7],[1.8,50.9],
            [2.5,51.1],[3.2,51.4],[3.6,51.4],
            [3.8,51.5],[4.0,51.8],[4.2,52.0],[4.5,52.3],[4.7,52.6],[4.8,52.8],
            [5.0,53.0],[5.4,53.2],[5.8,53.4],[6.2,53.5],[6.8,53.6],[7.2,53.6],
            [7.5,53.7],[8.0,53.8],[8.3,54.0],[8.6,54.1],[8.8,54.3],[9.0,54.5],
            // Continue east along German/Polish/Baltic coast to map edge
            [9.5,54.5],[10.0,54.3],[10.8,54.2],[11.0,54.0],[12.0,54.2],
            [13.0,54.3],[14.0,54.0],[14.5,53.9],[16.0,54.2],[17.0,54.5],
            [18.5,54.4],[19.5,54.2],[20.5,54.5],[21.0,54.8],[22.0,54.5],
            [23.0,55.0],[24.0,55.5],[25.0,56.0],[26.0,56.5],[27.0,57.0],
            [28.0,57.5],[29.0,57.8],[30.0,58.0],
            // Close: along right edge down to bottom, then back to start
            [30.0,40.0],[-30.0,40.0]
        ],
        // Jutland peninsula — separate fill to avoid self-intersecting polygon
        jutlandFill: [
            // West coast (north from Schleswig)
            [9.0,54.5],[8.6,55.6],[8.2,55.9],[8.1,56.3],[8.0,56.6],[8.2,56.8],
            [8.6,57.0],[9.0,57.1],[9.5,57.4],[9.8,57.6],
            // Skagen tip
            [10.2,57.7],[10.5,57.6],[10.6,57.4],
            // East coast (Kattegat side back south)
            [10.3,57.0],[10.0,56.6],[10.2,56.2],[10.5,55.8],[10.3,55.5],
            [10.0,55.3],[9.8,55.0],[9.5,54.5],[9.0,54.5]
        ],

        // ICELAND — 38 points with Westfjords detail
        icelandCoast: [
            // South coast — Reykjanes to Höfn
            [-22.7,63.8],[-22.0,63.5],[-21.5,63.6],[-21.0,63.5],[-20.5,63.4],
            [-20.0,63.4],[-19.5,63.5],[-19.0,63.4],[-18.5,63.5],[-18.0,63.5],
            [-17.0,63.5],[-16.0,64.0],[-15.5,64.2],[-15.0,64.3],[-14.5,64.5],
            // East coast
            [-14.0,65.0],[-14.2,65.5],[-14.5,65.8],[-14.8,66.0],
            // North coast — Eyjafjörður area
            [-15.5,66.2],[-16.0,66.0],[-16.5,66.2],[-17.0,66.1],[-17.5,66.3],
            [-18.0,66.2],[-18.5,66.4],[-19.0,66.3],[-19.5,66.1],
            // Westfjords — jagged indentations
            [-20.0,66.0],[-20.5,66.2],[-21.0,66.3],[-21.5,66.0],[-22.0,66.2],
            [-22.5,66.1],[-23.0,65.8],[-23.5,65.5],[-24.0,65.2],[-23.5,64.8],
            [-23.2,64.5],[-22.7,63.8]
        ],
        icelandFill: [
            [-22.7,63.8],[-22.0,63.5],[-21.5,63.6],[-21.0,63.5],[-20.5,63.4],
            [-20.0,63.4],[-19.5,63.5],[-19.0,63.4],[-18.5,63.5],[-18.0,63.5],
            [-17.0,63.5],[-16.0,64.0],[-15.5,64.2],[-15.0,64.3],[-14.5,64.5],
            [-14.0,65.0],[-14.2,65.5],[-14.5,65.8],[-14.8,66.0],
            [-15.5,66.2],[-16.0,66.0],[-16.5,66.2],[-17.0,66.1],[-17.5,66.3],
            [-18.0,66.2],[-18.5,66.4],[-19.0,66.3],[-19.5,66.1],
            [-20.0,66.0],[-20.5,66.2],[-21.0,66.3],[-21.5,66.0],[-22.0,66.2],
            [-22.5,66.1],[-23.0,65.8],[-23.5,65.5],[-24.0,65.2],[-23.5,64.8],
            [-23.2,64.5],[-22.7,63.8]
        ],

        // Danish islands (Zealand, Funen) — separate from Jutland
        denmarkIslands: [
            // Zealand (Sjælland)
            [11.0,55.3],[11.5,55.5],[12.0,55.6],[12.3,55.8],[12.5,56.0],
            [12.3,56.1],[12.0,55.9],[11.5,55.8],[11.0,55.6],[11.0,55.3]
        ],
        denmarkIslandsFill: [
            [11.0,55.3],[11.5,55.5],[12.0,55.6],[12.3,55.8],[12.5,56.0],
            [12.3,56.1],[12.0,55.9],[11.5,55.8],[11.0,55.6],[11.0,55.3]
        ]
    };

    function createOffscreen(w, h) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    // Time-of-day colour palettes for aurora map
    function getTimeOfDayPalette(darknessStatus) {
        switch (darknessStatus) {
            case 'dark':
                return {
                    seaTop: '#040a14', seaMid: '#081220', seaBot: '#0c1628',
                    ukLand: 'rgba(22, 32, 20, 0.85)',
                    ireLand: 'rgba(20, 30, 18, 0.82)',
                    euroLand: 'rgba(18, 24, 16, 0.88)',
                    iceLand: 'rgba(25, 28, 30, 0.85)',
                    norLand: 'rgba(20, 26, 22, 0.86)',
                    ukCoastColor: 'rgba(255,255,255,0.55)', ukCoastWidth: 1.5,
                    euroCoastColor: 'rgba(255,255,255,0.35)', euroCoastWidth: 1,
                    gridColor: 'rgba(255,255,255,0.06)',
                    gridLabelColor: 'rgba(255,255,255,0.2)',
                    vignetteColor: 'rgba(0,0,0,0.15)',
                    ambientGlow: null
                };
            case 'astronomical_twilight':
                return {
                    seaTop: '#060e1c', seaMid: '#0a1626', seaBot: '#101c30',
                    ukLand: 'rgba(25, 35, 22, 0.82)',
                    ireLand: 'rgba(23, 33, 20, 0.80)',
                    euroLand: 'rgba(20, 26, 18, 0.85)',
                    iceLand: 'rgba(28, 30, 32, 0.83)',
                    norLand: 'rgba(22, 28, 24, 0.84)',
                    ukCoastColor: 'rgba(255,255,255,0.50)', ukCoastWidth: 1.5,
                    euroCoastColor: 'rgba(255,255,255,0.32)', euroCoastWidth: 1,
                    gridColor: 'rgba(255,255,255,0.06)',
                    gridLabelColor: 'rgba(255,255,255,0.2)',
                    vignetteColor: 'rgba(0,0,0,0.12)',
                    ambientGlow: null
                };
            case 'nautical_twilight':
                return {
                    seaTop: '#0c1830', seaMid: '#122240', seaBot: '#1a2c48',
                    ukLand: 'rgba(30, 42, 28, 0.78)',
                    ireLand: 'rgba(28, 40, 25, 0.76)',
                    euroLand: 'rgba(24, 32, 22, 0.80)',
                    iceLand: 'rgba(35, 38, 42, 0.78)',
                    norLand: 'rgba(26, 34, 28, 0.80)',
                    ukCoastColor: 'rgba(255,255,255,0.45)', ukCoastWidth: 1.5,
                    euroCoastColor: 'rgba(255,255,255,0.30)', euroCoastWidth: 1,
                    gridColor: 'rgba(255,255,255,0.07)',
                    gridLabelColor: 'rgba(255,255,255,0.22)',
                    vignetteColor: 'rgba(0,0,0,0.08)',
                    ambientGlow: {color: 'rgba(40, 30, 60, 0.08)', y: 1.0}
                };
            case 'civil_twilight':
                return {
                    seaTop: '#1a2848', seaMid: '#243858', seaBot: '#2e4460',
                    ukLand: 'rgba(38, 50, 32, 0.72)',
                    ireLand: 'rgba(35, 48, 30, 0.70)',
                    euroLand: 'rgba(30, 38, 26, 0.75)',
                    iceLand: 'rgba(42, 44, 48, 0.72)',
                    norLand: 'rgba(32, 40, 34, 0.74)',
                    ukCoastColor: 'rgba(255,255,240,0.40)', ukCoastWidth: 1.5,
                    euroCoastColor: 'rgba(255,255,240,0.28)', euroCoastWidth: 1,
                    gridColor: 'rgba(255,255,255,0.08)',
                    gridLabelColor: 'rgba(255,255,255,0.25)',
                    vignetteColor: 'rgba(0,0,0,0.05)',
                    ambientGlow: {color: 'rgba(80, 50, 30, 0.12)', y: 1.0}
                };
            case 'daylight':
                return {
                    seaTop: '#1e3a5c', seaMid: '#2a4e72', seaBot: '#365e82',
                    ukLand: 'rgba(48, 68, 40, 0.65)',
                    ireLand: 'rgba(45, 65, 38, 0.63)',
                    euroLand: 'rgba(40, 52, 34, 0.68)',
                    iceLand: 'rgba(55, 58, 62, 0.65)',
                    norLand: 'rgba(42, 54, 44, 0.66)',
                    ukCoastColor: 'rgba(255,255,255,0.35)', ukCoastWidth: 1.5,
                    euroCoastColor: 'rgba(255,255,255,0.22)', euroCoastWidth: 1,
                    gridColor: 'rgba(255,255,255,0.10)',
                    gridLabelColor: 'rgba(255,255,255,0.28)',
                    vignetteColor: 'rgba(0,0,0,0.0)',
                    ambientGlow: {color: 'rgba(180, 160, 120, 0.06)', y: 0.0}
                };
            default:
                return getTimeOfDayPalette('dark');
        }
    }

    // Interpolated aurora colour palette (real aurora colours)
    function auroraColor(val) {
        if (val <= 0) return null;
        var stops = [
            { t: 1,    r: 10,  g: 61,  b: 10,  a: 0.10 },
            { t: 5,    r: 0,   g: 140, b: 60,  a: 0.25 },
            { t: 10,   r: 0,   g: 204, b: 102, a: 0.38 },
            { t: 20,   r: 0,   g: 255, b: 136, a: 0.48 },
            { t: 35,   r: 0,   g: 221, b: 187, a: 0.55 },
            { t: 50,   r: 34,  g: 255, b: 170, a: 0.62 },
            { t: 65,   r: 136, g: 255, b: 68,  a: 0.70 },
            { t: 80,   r: 204, g: 68,  b: 255, a: 0.78 },
            { t: 100,  r: 255, g: 51,  b: 102, a: 0.85 }
        ];
        if (val <= stops[0].t) return null;
        if (val >= stops[stops.length - 1].t) {
            var s = stops[stops.length - 1];
            return { r: s.r, g: s.g, b: s.b, a: s.a };
        }
        for (var i = 0; i < stops.length - 1; i++) {
            if (val >= stops[i].t && val < stops[i + 1].t) {
                var f = (val - stops[i].t) / (stops[i + 1].t - stops[i].t);
                return {
                    r: Math.round(stops[i].r + f * (stops[i + 1].r - stops[i].r)),
                    g: Math.round(stops[i].g + f * (stops[i + 1].g - stops[i].g)),
                    b: Math.round(stops[i].b + f * (stops[i + 1].b - stops[i].b)),
                    a: stops[i].a + f * (stops[i + 1].a - stops[i].a)
                };
            }
        }
        return null;
    }

    // Build the aurora glow layer using radial gradient circles + additive blending
    function buildAuroraLayer(coords, W, H, lonToX, latToY, latMin, latMax, lonMin, lonMax) {
        if (!auroraState.auroraCanvas) auroraState.auroraCanvas = createOffscreen(W, H);
        var ac = auroraState.auroraCanvas;
        var actx = ac.getContext('2d');
        actx.clearRect(0, 0, W, H);

        // Additive blending — overlapping circles glow naturally
        actx.globalCompositeOperation = 'lighter';

        var cellW = W / (lonMax - lonMin);
        var cellH = H / (latMax - latMin);
        var radius = Math.max(cellW, cellH) * 1.3;

        for (var i = 0; i < coords.length; i++) {
            var lon = coords[i][0];
            var lat = coords[i][1];
            var val = coords[i][2];

            if (lon > 180) lon -= 360;
            if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) continue;
            if (val <= 0) continue;

            var color = auroraColor(val);
            if (!color) continue;

            var x = lonToX(lon);
            var y = latToY(lat);

            var grad = actx.createRadialGradient(x, y, 0, x, y, radius);
            grad.addColorStop(0, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + color.a + ')');
            grad.addColorStop(0.6, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + (color.a * 0.3) + ')');
            grad.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');

            actx.fillStyle = grad;
            actx.beginPath();
            actx.arc(x, y, radius, 0, Math.PI * 2);
            actx.fill();
        }

        actx.globalCompositeOperation = 'source-over';

        // Apply Gaussian blur for extra smoothness
        try {
            var temp = createOffscreen(W, H);
            var tctx = temp.getContext('2d');
            tctx.filter = 'blur(5px)';
            tctx.drawImage(ac, 0, 0);
            actx.clearRect(0, 0, W, H);
            actx.drawImage(temp, 0, 0);
        } catch (e) {
            // filter not supported — radial gradients are already smooth enough
        }
    }

    // Build the overlay layer (land fills, coastlines, grid, user marker)
    function buildLandLayer(W, H, lonToX, latToY) {
        if (!auroraState.landCanvas) auroraState.landCanvas = createOffscreen(W, H);
        var lc = auroraState.landCanvas;
        var lctx = lc.getContext('2d');
        lctx.clearRect(0, 0, W, H);
        var palette = getTimeOfDayPalette(auroraState.darknessStatus);
        drawLandFills(lctx, lonToX, latToY, palette);
    }

    function buildOverlayLayer(W, H, lonToX, latToY, latMin, latMax, lonMin, lonMax) {
        if (!auroraState.overlayCanvas) auroraState.overlayCanvas = createOffscreen(W, H);
        var oc = auroraState.overlayCanvas;
        var octx = oc.getContext('2d');
        octx.clearRect(0, 0, W, H);

        var palette = getTimeOfDayPalette(auroraState.darknessStatus);

        // Coastline strokes (land fills are on separate layer below aurora)
        drawCoastlines(octx, lonToX, latToY, palette);

        // Grid lines
        octx.strokeStyle = palette.gridColor;
        octx.lineWidth = 0.5;
        for (var gLat = 45; gLat <= 70; gLat += 5) {
            octx.beginPath();
            octx.moveTo(0, latToY(gLat));
            octx.lineTo(W, latToY(gLat));
            octx.stroke();
            octx.fillStyle = palette.gridLabelColor;
            octx.font = '9px sans-serif';
            octx.fillText(gLat + '\u00b0N', 3, latToY(gLat) - 2);
        }
        for (var gLon = -20; gLon <= 20; gLon += 10) {
            octx.beginPath();
            octx.moveTo(lonToX(gLon), 0);
            octx.lineTo(lonToX(gLon), H);
            octx.stroke();
            var lonLabel = gLon === 0 ? '0\u00b0' : (gLon > 0 ? gLon + '\u00b0E' : Math.abs(gLon) + '\u00b0W');
            octx.fillText(lonLabel, lonToX(gLon) + 2, H - 4);
        }

        // User location marker
        var uLat = window.__userLat || 55;
        var uLon = (window.__userLon !== undefined ? window.__userLon : -3);
        if (uLat >= latMin && uLat <= latMax && uLon >= lonMin && uLon <= lonMax) {
            var ux = lonToX(uLon);
            var uy = latToY(uLat);
            // Glow ring
            octx.beginPath();
            octx.arc(ux, uy, 8, 0, Math.PI * 2);
            octx.fillStyle = 'rgba(255,255,255,0.15)';
            octx.fill();
            // Solid dot
            octx.beginPath();
            octx.arc(ux, uy, 4, 0, Math.PI * 2);
            octx.fillStyle = '#ffffff';
            octx.fill();
            octx.strokeStyle = 'rgba(0,0,0,0.6)';
            octx.lineWidth = 1.5;
            octx.stroke();
            // Label
            octx.fillStyle = '#fff';
            octx.font = 'bold 10px sans-serif';
            octx.shadowColor = 'rgba(0,0,0,0.8)';
            octx.shadowBlur = 3;
            octx.fillText(userLocation, ux + 10, uy + 3);
            octx.shadowBlur = 0;
        }

        // Wind direction arrows — drawn on overlay for full opacity above clouds
        if (cloudGridState.data && cloudGridState.data.grid) {
            drawWindArrows(octx, cloudGridState.data.grid, cloudGridState.hourOffset, lonToX, latToY);
        }
    }

    // Animation loop — composites pre-rendered layers with shimmer effect
    function startAuroraAnimation(canvas) {
        if (auroraState.animFrameId) return; // already running
        auroraState.animStartTime = performance.now();

        var ctx = canvas.getContext('2d');
        var W = canvas.width;
        var H = canvas.height;

        function frame(timestamp) {
            var elapsed = (timestamp - auroraState.animStartTime) / 1000;

            ctx.clearRect(0, 0, W, H);

            // Ocean background — time-of-day aware
            var palette = getTimeOfDayPalette(auroraState.darknessStatus);
            var seaGrad = ctx.createLinearGradient(0, 0, 0, H);
            seaGrad.addColorStop(0, palette.seaTop);
            seaGrad.addColorStop(0.4, palette.seaMid);
            seaGrad.addColorStop(1, palette.seaBot);
            ctx.fillStyle = seaGrad;
            ctx.fillRect(0, 0, W, H);

            // Subtle depth variation — lighter patch in mid-ocean
            var depthGrad = ctx.createRadialGradient(W * 0.3, H * 0.6, 0, W * 0.3, H * 0.6, W * 0.6);
            depthGrad.addColorStop(0, 'rgba(20, 40, 80, 0.06)');
            depthGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = depthGrad;
            ctx.fillRect(0, 0, W, H);

            // Ambient glow at horizon (twilight states)
            if (palette.ambientGlow) {
                var glowY = palette.ambientGlow.y * H;
                var glow = ctx.createRadialGradient(W / 2, glowY, 0, W / 2, glowY, W * 0.8);
                glow.addColorStop(0, palette.ambientGlow.color);
                glow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = glow;
                ctx.fillRect(0, 0, W, H);
            }

            // Vignette for depth
            if (palette.vignetteColor && palette.vignetteColor !== 'rgba(0,0,0,0.0)') {
                var vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.8);
                vig.addColorStop(0, 'rgba(0,0,0,0)');
                vig.addColorStop(1, palette.vignetteColor);
                ctx.fillStyle = vig;
                ctx.fillRect(0, 0, W, H);
            }

            // Land fills below aurora (so aurora glows over land)
            if (auroraState.landCanvas) {
                ctx.drawImage(auroraState.landCanvas, 0, 0);
            }

            // Cloud overlay (between land and aurora)
            if (auroraState.cloudCanvas) {
                ctx.save();
                ctx.globalAlpha = 0.8;
                ctx.drawImage(auroraState.cloudCanvas, 0, 0);
                ctx.restore();
            }

            // Aurora layer with shimmer + drift
            if (auroraState.auroraCanvas) {
                var shimmer = 0.90 + 0.10 * Math.sin(elapsed * Math.PI * 2 / 4);
                var driftX = 0.6 * Math.sin(elapsed * Math.PI * 2 / 7);
                var driftY = 0.4 * Math.cos(elapsed * Math.PI * 2 / 5.5);

                ctx.save();
                ctx.globalAlpha = shimmer;
                ctx.drawImage(auroraState.auroraCanvas, driftX, driftY);
                ctx.restore();
            }

            // Overlay (coastlines, grid, marker) at full opacity
            if (auroraState.overlayCanvas) {
                ctx.drawImage(auroraState.overlayCanvas, 0, 0);
            }

            auroraState.animFrameId = requestAnimationFrame(frame);
        }

        auroraState.animFrameId = requestAnimationFrame(frame);
    }

    function renderAuroraOval() {
        var canvas = document.getElementById('auroraOvalCanvas');
        var loading = document.getElementById('ovalLoading');
        if (!canvas) return;

        var W = canvas.width;
        var H = canvas.height;

        var latMin = 40, latMax = 72;
        var lonMin = -30, lonMax = 30;

        function lonToX(lon) { return ((lon - lonMin) / (lonMax - lonMin)) * W; }
        function latToY(lat) { return ((latMax - lat) / (latMax - latMin)) * H; }

        // Store projection functions for reuse by overlay/cloud slider
        auroraState.lonToX = lonToX;
        auroraState.latToY = latToY;
        auroraState.mapW = W;
        auroraState.mapH = H;
        auroraState.mapLatMin = latMin;
        auroraState.mapLatMax = latMax;
        auroraState.mapLonMin = lonMin;
        auroraState.mapLonMax = lonMax;

        fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (loading) loading.style.display = 'none';

                var coords = data.coordinates || [];

                // Build land fills (below aurora)
                buildLandLayer(W, H, lonToX, latToY);

                // Build aurora glow texture (offscreen, expensive but only every 5 min)
                buildAuroraLayer(coords, W, H, lonToX, latToY, latMin, latMax, lonMin, lonMax);

                // Build overlay (coastlines, grid, user marker)
                buildOverlayLayer(W, H, lonToX, latToY, latMin, latMax, lonMin, lonMax);

                // Fetch cloud grid overlay (async, non-blocking)
                fetchCloudGrid();
                // Refresh cloud grid every 30 minutes
                setInterval(fetchCloudGrid, 1800000);

                // Show forecast time
                var timeEl = document.getElementById('ovalForecastTime');
                if (timeEl && data['Forecast Time']) {
                    timeEl.textContent = 'Forecast: ' + data['Forecast Time'].replace('T', ' ').slice(0, 16) + ' UTC';
                }

                // Start animation loop (idempotent — only starts once)
                startAuroraAnimation(canvas);
            })
            .catch(function(err) {
                if (loading) loading.textContent = 'Unable to load aurora oval';
                console.warn('Aurora oval fetch failed:', err);
            });
    }

    // Fill land masses as solid polygons (time-of-day palette colours)
    function drawLandFills(ctx, lonToX, latToY, palette) {
        palette = palette || getTimeOfDayPalette(auroraState.darknessStatus);

        function fillPoly(points, color) {
            if (points.length < 3) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(lonToX(points[0][0]), latToY(points[0][1]));
            for (var i = 1; i < points.length; i++) {
                ctx.lineTo(lonToX(points[i][0]), latToY(points[i][1]));
            }
            ctx.closePath();
            ctx.fill();
        }

        // UK mainland
        var uk = [
            [-5.72,50.07],[-5.68,50.04],[-5.53,50.05],[-5.45,50.08],[-5.34,50.07],
            [-5.22,50.06],[-5.15,50.10],[-5.07,50.07],[-5.04,50.04],[-4.96,50.07],
            [-4.80,50.23],[-4.67,50.33],[-4.52,50.34],[-4.38,50.36],[-4.20,50.35],
            [-4.10,50.37],[-3.99,50.37],[-3.85,50.40],[-3.68,50.45],[-3.53,50.55],
            [-3.47,50.62],[-3.38,50.63],[-3.22,50.68],[-3.07,50.70],[-2.95,50.72],
            [-2.78,50.72],[-2.56,50.71],[-2.44,50.72],[-2.05,50.73],[-1.95,50.75],
            [-1.75,50.73],[-1.55,50.72],[-1.30,50.77],[-1.16,50.73],[-1.10,50.76],
            [-1.02,50.79],[-0.88,50.78],[-0.77,50.80],[-0.59,50.80],[-0.26,50.83],
            [0.00,50.77],[0.11,50.76],[0.25,50.77],[0.37,50.82],[0.58,50.86],
            [0.74,50.92],[0.87,50.96],[0.97,51.00],[1.06,51.05],[1.20,51.10],
            [1.38,51.15],[1.43,51.28],[1.42,51.37],
            [1.26,51.45],[1.10,51.60],[1.04,51.73],[1.15,51.82],[1.29,51.88],
            [1.42,51.93],[1.60,52.00],[1.74,52.10],[1.75,52.30],[1.73,52.45],
            [1.75,52.57],[1.72,52.63],[1.65,52.73],[1.53,52.80],[1.32,52.93],
            [0.65,52.97],[0.35,52.98],[0.20,53.02],[0.10,53.10],[0.05,53.20],
            [0.08,53.30],[0.05,53.40],[0.00,53.48],
            [-0.15,53.52],[-0.25,53.62],[-0.30,53.72],[-0.10,53.73],[0.00,53.68],
            [0.05,53.58],[0.10,53.52],[0.15,53.55],[0.10,53.60],[-0.05,53.65],
            [-0.10,53.75],[-0.18,53.83],[-0.28,53.90],[-0.38,54.00],[-0.50,54.10],
            [-0.62,54.18],[-0.78,54.25],[-0.88,54.32],[-1.05,54.40],[-1.15,54.48],
            [-1.20,54.55],[-1.25,54.62],[-1.32,54.72],[-1.42,54.82],[-1.48,54.92],
            [-1.52,54.99],[-1.55,55.08],[-1.58,55.15],[-1.62,55.28],[-1.68,55.42],
            [-1.75,55.55],[-1.82,55.60],
            [-1.90,55.68],[-2.00,55.75],[-2.12,55.82],[-2.18,55.88],[-2.15,55.95],
            [-2.08,56.00],[-2.00,56.10],[-1.95,56.18],[-2.08,56.22],[-2.48,56.28],
            [-2.60,56.33],[-2.78,56.35],[-2.90,56.38],[-2.95,56.43],[-2.85,56.48],
            [-2.72,56.50],[-2.52,56.55],[-2.42,56.62],[-2.30,56.68],[-2.18,56.72],
            [-2.10,56.78],[-2.05,56.85],[-1.98,56.92],[-1.95,57.00],[-1.90,57.05],
            [-1.82,57.30],[-2.00,57.52],[-2.20,57.58],[-2.45,57.60],[-2.65,57.65],
            [-3.00,57.68],[-3.25,57.67],[-3.40,57.65],[-3.52,57.63],[-3.70,57.65],
            [-3.88,57.70],[-3.95,57.82],[-3.85,57.90],[-3.60,57.88],[-3.42,57.92],
            [-3.32,57.98],[-3.20,58.05],[-3.10,58.15],[-3.05,58.25],
            [-3.08,58.43],[-3.15,58.47],[-3.22,58.52],[-3.30,58.57],[-3.38,58.58],
            [-3.52,58.60],[-3.72,58.58],[-3.90,58.55],[-4.05,58.55],[-4.20,58.55],
            [-4.35,58.52],[-4.50,58.50],[-4.72,58.50],[-4.85,58.48],[-5.00,58.48],
            [-5.05,58.45],[-5.02,58.38],[-5.08,58.32],
            [-5.15,58.25],[-5.10,58.18],[-5.20,58.08],[-5.15,57.98],[-5.25,57.92],
            [-5.40,57.85],[-5.48,57.78],[-5.55,57.72],[-5.62,57.65],[-5.58,57.58],
            [-5.50,57.52],[-5.52,57.45],[-5.65,57.38],[-5.72,57.28],[-5.78,57.22],
            [-5.82,57.12],[-5.75,57.05],[-5.68,56.98],[-5.62,56.88],[-5.70,56.80],
            [-5.72,56.72],[-5.65,56.62],[-5.58,56.55],[-5.62,56.48],[-5.75,56.42],
            [-5.80,56.35],[-5.70,56.28],[-5.58,56.22],[-5.50,56.15],[-5.55,56.05],
            [-5.62,55.98],[-5.58,55.90],[-5.65,55.82],[-5.72,55.72],[-5.68,55.65],
            [-5.60,55.58],[-5.52,55.48],[-5.48,55.42],[-5.42,55.38],
            [-5.35,55.32],[-5.10,55.25],[-5.00,55.18],[-4.92,55.08],[-4.88,55.00],
            [-4.95,54.92],[-5.05,54.85],[-5.10,54.78],[-5.00,54.72],[-4.88,54.65],
            [-4.72,54.55],[-4.62,54.45],[-4.52,54.38],[-4.42,54.28],
            [-3.82,54.55],[-3.60,54.62],[-3.45,54.68],[-3.28,54.70],[-3.42,54.65],
            [-3.55,54.58],[-3.38,54.48],[-3.25,54.42],[-3.10,54.30],[-3.00,54.18],
            [-2.90,54.12],[-2.95,54.05],[-3.02,53.98],[-3.08,53.90],[-3.02,53.82],
            [-3.10,53.72],[-3.18,53.58],[-3.32,53.48],[-3.45,53.38],[-3.55,53.30],
            [-3.72,53.22],[-3.85,53.15],[-4.08,53.05],[-4.22,52.95],[-4.38,52.88],
            [-4.52,52.78],[-4.60,52.65],[-4.68,52.55],[-4.72,52.42],[-4.80,52.32],
            [-4.90,52.25],[-5.05,52.10],[-5.10,51.98],[-5.18,51.88],[-5.28,51.78],
            [-5.30,51.72],[-5.25,51.65],[-5.15,51.62],[-5.10,51.58],[-5.08,51.55],
            [-4.95,51.55],[-4.72,51.58],[-4.52,51.60],[-4.30,51.58],[-4.12,51.55],
            [-3.95,51.55],[-3.72,51.55],[-3.50,51.48],[-3.42,51.42],[-3.35,51.38],
            [-3.30,51.32],[-3.40,51.22],[-3.55,51.18],[-3.68,51.10],[-3.80,51.05],
            [-3.95,51.00],[-4.10,51.02],[-4.25,51.05],[-4.38,51.08],[-4.55,51.08],
            [-4.72,51.05],[-4.85,51.00],[-4.98,50.95],[-5.05,50.88],[-5.12,50.80],
            [-5.18,50.70],[-5.28,50.58],[-5.38,50.48],[-5.48,50.38],[-5.55,50.28],
            [-5.62,50.18],[-5.68,50.12],[-5.72,50.07]
        ];
        fillPoly(uk, palette.ukLand);

        // Islands
        var shetland = [[-1.30,60.15],[-1.20,60.10],[-1.08,60.15],[-1.02,60.25],[-1.10,60.35],[-1.05,60.43],[-1.10,60.50],[-1.22,60.50],[-1.30,60.45],[-1.35,60.38],[-1.32,60.30],[-1.28,60.22],[-1.30,60.15]];
        fillPoly(shetland, palette.ukLand);

        var orkney = [[-2.95,58.88],[-2.82,58.85],[-2.78,58.90],[-2.85,58.98],[-2.95,59.00],[-3.10,59.02],[-3.18,58.98],[-3.22,58.92],[-3.15,58.88],[-2.95,58.88]];
        fillPoly(orkney, palette.ukLand);

        var hebrides = [[-6.15,57.18],[-6.08,57.28],[-6.15,57.38],[-6.22,57.48],[-6.18,57.58],[-6.25,57.72],[-6.18,57.82],[-6.30,57.92],[-6.35,58.05],[-6.42,58.15],[-6.38,58.25],[-6.30,58.28],[-6.22,58.22],[-6.32,58.12],[-6.28,58.02],[-6.38,57.90],[-6.30,57.78],[-6.35,57.65],[-6.28,57.55],[-6.35,57.42],[-6.22,57.30],[-6.15,57.18]];
        fillPoly(hebrides, palette.ukLand);

        var skye = [[-5.80,57.08],[-5.72,57.12],[-5.65,57.18],[-5.75,57.25],[-5.88,57.28],[-6.02,57.30],[-6.12,57.27],[-6.18,57.22],[-6.12,57.15],[-5.98,57.10],[-5.88,57.08],[-5.80,57.08]];
        fillPoly(skye, palette.ukLand);

        var mull = [[-5.72,56.42],[-5.62,56.45],[-5.55,56.50],[-5.65,56.55],[-5.78,56.52],[-5.90,56.48],[-5.92,56.42],[-5.85,56.38],[-5.72,56.42]];
        fillPoly(mull, palette.ukLand);

        var iom = [[-4.35,54.08],[-4.30,54.12],[-4.32,54.20],[-4.38,54.28],[-4.42,54.35],[-4.48,54.38],[-4.55,54.35],[-4.58,54.28],[-4.55,54.20],[-4.50,54.12],[-4.42,54.08],[-4.35,54.08]];
        fillPoly(iom, palette.ukLand);

        var anglesey = [[-4.08,53.22],[-4.15,53.25],[-4.22,53.28],[-4.32,53.30],[-4.42,53.28],[-4.48,53.25],[-4.52,53.22],[-4.45,53.18],[-4.35,53.18],[-4.22,53.20],[-4.12,53.22],[-4.08,53.22]];
        fillPoly(anglesey, palette.ukLand);

        var iow = [[-1.10,50.65],[-1.18,50.68],[-1.28,50.70],[-1.42,50.70],[-1.52,50.68],[-1.55,50.65],[-1.48,50.63],[-1.38,50.62],[-1.25,50.62],[-1.15,50.63],[-1.10,50.65]];
        fillPoly(iow, palette.ukLand);

        // Ireland
        var ire = [
            [-6.05,53.35],[-5.98,53.25],[-6.02,53.18],[-5.98,53.08],[-6.05,52.98],
            [-6.12,52.85],[-6.20,52.72],[-6.15,52.58],[-6.22,52.48],[-6.18,52.35],
            [-6.25,52.22],[-6.35,52.15],[-6.55,52.08],[-6.72,52.05],[-6.88,52.10],
            [-7.05,52.08],[-7.18,52.15],[-7.35,52.12],[-7.50,52.08],
            [-7.65,51.98],[-7.82,51.88],[-8.00,51.78],[-8.18,51.72],[-8.35,51.68],
            [-8.55,51.62],[-8.72,51.58],[-8.85,51.60],[-9.05,51.58],[-9.22,51.55],
            [-9.42,51.58],[-9.55,51.62],[-9.72,51.68],[-9.85,51.72],
            [-10.02,51.78],[-10.15,51.85],[-10.22,51.95],[-10.28,52.08],[-10.32,52.15],
            [-10.25,52.28],[-10.18,52.42],[-10.22,52.55],
            [-10.08,52.65],[-9.92,52.75],[-9.72,52.85],[-9.55,53.00],[-9.68,53.08],
            [-9.88,53.12],[-10.05,53.18],[-10.12,53.28],[-10.08,53.38],[-9.95,53.48],
            [-9.82,53.55],[-9.95,53.62],[-10.05,53.55],[-10.15,53.52],[-10.08,53.45],
            [-10.02,53.62],[-9.88,53.72],[-9.78,53.85],[-9.65,53.92],[-9.55,54.05],
            [-9.45,54.12],[-9.35,54.18],[-9.15,54.22],[-8.95,54.25],[-8.78,54.30],
            [-8.60,54.38],[-8.45,54.42],[-8.28,54.48],[-8.18,54.55],[-8.05,54.62],
            [-7.88,54.72],[-7.72,54.78],[-7.55,54.85],[-7.42,54.95],[-7.48,55.05],
            [-7.55,55.15],[-7.42,55.22],[-7.32,55.25],[-7.22,55.20],[-7.08,55.22],
            [-6.88,55.18],[-6.72,55.15],[-6.58,55.12],[-6.42,55.08],[-6.25,55.05],
            [-6.12,55.08],[-5.98,55.12],[-5.88,55.10],[-5.78,55.02],[-5.72,54.92],
            [-5.68,54.82],[-5.75,54.72],[-5.82,54.62],[-5.88,54.52],[-5.92,54.42],
            [-5.98,54.32],[-6.02,54.22],[-6.08,54.12],[-6.12,54.02],[-6.08,53.88],
            [-6.02,53.72],[-6.05,53.58],[-6.10,53.48],[-6.05,53.35]
        ];
        fillPoly(ire, palette.ireLand);

        // European landmasses — accurate coastline fills
        // Norway (fjord-detailed filled shape extending to map edge)
        fillPoly(euroCoastData.norwayFill, palette.norLand);

        // Sweden/Finland (full Scandinavian peninsula with Gulf of Bothnia)
        fillPoly(euroCoastData.swedenFill, palette.euroLand);

        // NW Europe coast — Brittany to Baltic, fill to bottom edge
        fillPoly(euroCoastData.europeFill, palette.euroLand);

        // Jutland peninsula (separate to avoid self-intersection)
        fillPoly(euroCoastData.jutlandFill, palette.euroLand);

        // Denmark islands (Zealand, Funen)
        fillPoly(euroCoastData.denmarkIslandsFill, palette.euroLand);

        // Iceland (with Westfjords detail)
        fillPoly(euroCoastData.icelandFill, palette.iceLand);
    }

    function drawCoastlines(ctx, lonToX, latToY, palette) {
        palette = palette || getTimeOfDayPalette(auroraState.darknessStatus);
        // ── UK & Ireland (brighter, thicker) ──
        ctx.strokeStyle = palette.ukCoastColor;
        ctx.lineWidth = palette.ukCoastWidth;

        // UK mainland — detailed coastline (~180 points)
        var uk = [
            // Cornwall — Lands End to Lizard to south coast
            [-5.72,50.07],[-5.68,50.04],[-5.53,50.05],[-5.45,50.08],[-5.34,50.07],
            [-5.22,50.06],[-5.15,50.10],[-5.07,50.07],[-5.04,50.04],[-4.96,50.07],
            [-4.80,50.23],[-4.67,50.33],[-4.52,50.34],[-4.38,50.36],[-4.20,50.35],
            [-4.10,50.37],[-3.99,50.37],[-3.85,50.40],[-3.68,50.45],[-3.53,50.55],
            [-3.47,50.62],[-3.38,50.63],[-3.22,50.68],[-3.07,50.70],[-2.95,50.72],
            // South coast — Dorset, Hampshire, Sussex
            [-2.78,50.72],[-2.56,50.71],[-2.44,50.72],[-2.05,50.73],[-1.95,50.75],
            [-1.75,50.73],[-1.55,50.72],[-1.30,50.77],[-1.16,50.73],[-1.10,50.76],
            [-1.02,50.79],[-0.88,50.78],[-0.77,50.80],[-0.59,50.80],[-0.26,50.83],
            [0.00,50.77],[0.11,50.76],[0.25,50.77],[0.37,50.82],[0.58,50.86],
            // Kent — Dungeness to North Foreland
            [0.74,50.92],[0.87,50.96],[0.97,51.00],[1.06,51.05],[1.20,51.10],
            [1.38,51.15],[1.43,51.28],[1.42,51.37],
            // Essex, Suffolk, Norfolk — East Anglia
            [1.26,51.45],[1.10,51.60],[1.04,51.73],[1.15,51.82],[1.29,51.88],
            [1.42,51.93],[1.60,52.00],[1.74,52.10],[1.75,52.30],[1.73,52.45],
            [1.75,52.57],[1.72,52.63],[1.65,52.73],[1.53,52.80],[1.32,52.93],
            // The Wash
            [0.65,52.97],[0.35,52.98],[0.20,53.02],[0.10,53.10],[0.05,53.20],
            [0.08,53.30],[0.05,53.40],[0.00,53.48],
            // Lincolnshire, Humber, Yorkshire
            [-0.15,53.52],[-0.25,53.62],[-0.30,53.72],[-0.10,53.73],[0.00,53.68],
            [0.05,53.58],[0.10,53.52],[0.15,53.55],[0.10,53.60],[-0.05,53.65],
            [-0.10,53.75],[-0.18,53.83],[-0.28,53.90],[-0.38,54.00],[-0.50,54.10],
            [-0.62,54.18],[-0.78,54.25],[-0.88,54.32],[-1.05,54.40],[-1.15,54.48],
            // Northeast — Tees to Berwick
            [-1.20,54.55],[-1.25,54.62],[-1.32,54.72],[-1.42,54.82],[-1.48,54.92],
            [-1.52,54.99],[-1.55,55.08],[-1.58,55.15],[-1.62,55.28],[-1.68,55.42],
            [-1.75,55.55],[-1.82,55.60],
            // Scottish east coast — Berwick to Aberdeen
            [-1.90,55.68],[-2.00,55.75],[-2.12,55.82],[-2.18,55.88],[-2.15,55.95],
            [-2.08,56.00],[-2.00,56.10],[-1.95,56.18],[-2.08,56.22],[-2.48,56.28],
            [-2.60,56.33],[-2.78,56.35],[-2.90,56.38],[-2.95,56.43],[-2.85,56.48],
            [-2.72,56.50],[-2.52,56.55],[-2.42,56.62],[-2.30,56.68],[-2.18,56.72],
            [-2.10,56.78],[-2.05,56.85],[-1.98,56.92],[-1.95,57.00],[-1.90,57.05],
            // Moray Firth
            [-1.82,57.30],[-2.00,57.52],[-2.20,57.58],[-2.45,57.60],[-2.65,57.65],
            [-3.00,57.68],[-3.25,57.67],[-3.40,57.65],[-3.52,57.63],[-3.70,57.65],
            [-3.88,57.70],[-3.95,57.82],[-3.85,57.90],[-3.60,57.88],[-3.42,57.92],
            [-3.32,57.98],[-3.20,58.05],[-3.10,58.15],[-3.05,58.25],
            // North coast — Duncansby to Cape Wrath
            [-3.08,58.43],[-3.15,58.47],[-3.22,58.52],[-3.30,58.57],[-3.38,58.58],
            [-3.52,58.60],[-3.72,58.58],[-3.90,58.55],[-4.05,58.55],[-4.20,58.55],
            [-4.35,58.52],[-4.50,58.50],[-4.72,58.50],[-4.85,58.48],[-5.00,58.48],
            [-5.05,58.45],[-5.02,58.38],[-5.08,58.32],
            // West Highland coast — Cape Wrath down to Kintyre
            [-5.15,58.25],[-5.10,58.18],[-5.20,58.08],[-5.15,57.98],[-5.25,57.92],
            [-5.40,57.85],[-5.48,57.78],[-5.55,57.72],[-5.62,57.65],[-5.58,57.58],
            [-5.50,57.52],[-5.52,57.45],[-5.65,57.38],[-5.72,57.28],[-5.78,57.22],
            [-5.82,57.12],[-5.75,57.05],[-5.68,56.98],[-5.62,56.88],[-5.70,56.80],
            [-5.72,56.72],[-5.65,56.62],[-5.58,56.55],[-5.62,56.48],[-5.75,56.42],
            [-5.80,56.35],[-5.70,56.28],[-5.58,56.22],[-5.50,56.15],[-5.55,56.05],
            [-5.62,55.98],[-5.58,55.90],[-5.65,55.82],[-5.72,55.72],[-5.68,55.65],
            [-5.60,55.58],[-5.52,55.48],[-5.48,55.42],[-5.42,55.38],
            // Firth of Clyde, Ayrshire, Galloway
            [-5.35,55.32],[-5.10,55.25],[-5.00,55.18],[-4.92,55.08],[-4.88,55.00],
            [-4.95,54.92],[-5.05,54.85],[-5.10,54.78],[-5.00,54.72],[-4.88,54.65],
            [-4.72,54.55],[-4.62,54.45],[-4.52,54.38],[-4.42,54.28],
            // Solway Firth, Cumbria, Lancashire
            [-3.82,54.55],[-3.60,54.62],[-3.45,54.68],[-3.28,54.70],[-3.42,54.65],
            [-3.55,54.58],[-3.38,54.48],[-3.25,54.42],[-3.10,54.30],[-3.00,54.18],
            [-2.90,54.12],[-2.95,54.05],[-3.02,53.98],[-3.08,53.90],[-3.02,53.82],
            // North Wales coast, Dee estuary
            [-3.10,53.72],[-3.18,53.58],[-3.32,53.48],[-3.45,53.38],[-3.55,53.30],
            // Cardigan Bay — west Wales
            [-3.72,53.22],[-3.85,53.15],[-4.08,53.05],[-4.22,52.95],[-4.38,52.88],
            [-4.52,52.78],[-4.60,52.65],[-4.68,52.55],[-4.72,52.42],[-4.80,52.32],
            [-4.90,52.25],[-5.05,52.10],[-5.10,51.98],[-5.18,51.88],[-5.28,51.78],
            // Pembrokeshire, Carmarthen Bay, Gower, Bristol Channel
            [-5.30,51.72],[-5.25,51.65],[-5.15,51.62],[-5.10,51.58],[-5.08,51.55],
            [-4.95,51.55],[-4.72,51.58],[-4.52,51.60],[-4.30,51.58],[-4.12,51.55],
            [-3.95,51.55],[-3.72,51.55],[-3.50,51.48],[-3.42,51.42],[-3.35,51.38],
            [-3.30,51.32],[-3.40,51.22],[-3.55,51.18],[-3.68,51.10],[-3.80,51.05],
            // North Devon/Somerset coast
            [-3.95,51.00],[-4.10,51.02],[-4.25,51.05],[-4.38,51.08],[-4.55,51.08],
            [-4.72,51.05],[-4.85,51.00],[-4.98,50.95],[-5.05,50.88],[-5.12,50.80],
            // Back to Cornwall
            [-5.18,50.70],[-5.28,50.58],[-5.38,50.48],[-5.48,50.38],[-5.55,50.28],
            [-5.62,50.18],[-5.68,50.12],[-5.72,50.07]
        ];
        drawPath(ctx, uk, lonToX, latToY);

        // Shetland (mainland)
        var shetland = [
            [-1.30,60.15],[-1.20,60.10],[-1.08,60.15],[-1.02,60.25],[-1.10,60.35],
            [-1.05,60.43],[-1.10,60.50],[-1.22,60.50],[-1.30,60.45],[-1.35,60.38],
            [-1.32,60.30],[-1.28,60.22],[-1.30,60.15]
        ];
        drawPath(ctx, shetland, lonToX, latToY);

        // Orkney (mainland)
        var orkney = [
            [-2.95,58.88],[-2.82,58.85],[-2.78,58.90],[-2.85,58.98],[-2.95,59.00],
            [-3.10,59.02],[-3.18,58.98],[-3.22,58.92],[-3.15,58.88],[-2.95,58.88]
        ];
        drawPath(ctx, orkney, lonToX, latToY);

        // Outer Hebrides (Lewis/Harris/Uist chain)
        var hebrides = [
            [-6.15,57.18],[-6.08,57.28],[-6.15,57.38],[-6.22,57.48],[-6.18,57.58],
            [-6.25,57.72],[-6.18,57.82],[-6.30,57.92],[-6.35,58.05],[-6.42,58.15],
            [-6.38,58.25],[-6.30,58.28],[-6.22,58.22],[-6.32,58.12],[-6.28,58.02],
            [-6.38,57.90],[-6.30,57.78],[-6.35,57.65],[-6.28,57.55],[-6.35,57.42],
            [-6.22,57.30],[-6.15,57.18]
        ];
        drawPath(ctx, hebrides, lonToX, latToY);

        // Isle of Skye
        var skye = [
            [-5.80,57.08],[-5.72,57.12],[-5.65,57.18],[-5.75,57.25],[-5.88,57.28],
            [-6.02,57.30],[-6.12,57.27],[-6.18,57.22],[-6.12,57.15],[-5.98,57.10],
            [-5.88,57.08],[-5.80,57.08]
        ];
        drawPath(ctx, skye, lonToX, latToY);

        // Isle of Mull
        var mull = [
            [-5.72,56.42],[-5.62,56.45],[-5.55,56.50],[-5.65,56.55],[-5.78,56.52],
            [-5.90,56.48],[-5.92,56.42],[-5.85,56.38],[-5.72,56.42]
        ];
        drawPath(ctx, mull, lonToX, latToY);

        // Isle of Man
        var iom = [
            [-4.35,54.08],[-4.30,54.12],[-4.32,54.20],[-4.38,54.28],[-4.42,54.35],
            [-4.48,54.38],[-4.55,54.35],[-4.58,54.28],[-4.55,54.20],[-4.50,54.12],
            [-4.42,54.08],[-4.35,54.08]
        ];
        drawPath(ctx, iom, lonToX, latToY);

        // Anglesey
        var anglesey = [
            [-4.08,53.22],[-4.15,53.25],[-4.22,53.28],[-4.32,53.30],[-4.42,53.28],
            [-4.48,53.25],[-4.52,53.22],[-4.45,53.18],[-4.35,53.18],[-4.22,53.20],
            [-4.12,53.22],[-4.08,53.22]
        ];
        drawPath(ctx, anglesey, lonToX, latToY);

        // Isle of Wight
        var iow = [
            [-1.10,50.65],[-1.18,50.68],[-1.28,50.70],[-1.42,50.70],[-1.52,50.68],
            [-1.55,50.65],[-1.48,50.63],[-1.38,50.62],[-1.25,50.62],[-1.15,50.63],
            [-1.10,50.65]
        ];
        drawPath(ctx, iow, lonToX, latToY);

        // Ireland — detailed coastline (~65 points)
        var ire = [
            // East coast — Dublin, Wicklow
            [-6.05,53.35],[-5.98,53.25],[-6.02,53.18],[-5.98,53.08],[-6.05,52.98],
            [-6.12,52.85],[-6.20,52.72],[-6.15,52.58],[-6.22,52.48],[-6.18,52.35],
            // Southeast — Wexford, Waterford
            [-6.25,52.22],[-6.35,52.15],[-6.55,52.08],[-6.72,52.05],[-6.88,52.10],
            [-7.05,52.08],[-7.18,52.15],[-7.35,52.12],[-7.50,52.08],
            // South coast — Cork, Kerry
            [-7.65,51.98],[-7.82,51.88],[-8.00,51.78],[-8.18,51.72],[-8.35,51.68],
            [-8.55,51.62],[-8.72,51.58],[-8.85,51.60],[-9.05,51.58],[-9.22,51.55],
            [-9.42,51.58],[-9.55,51.62],[-9.72,51.68],[-9.85,51.72],
            // Southwest — Ring of Kerry, Dingle
            [-10.02,51.78],[-10.15,51.85],[-10.22,51.95],[-10.28,52.08],[-10.32,52.15],
            [-10.25,52.28],[-10.18,52.42],[-10.22,52.55],
            // West coast — Clare, Galway, Connemara
            [-10.08,52.65],[-9.92,52.75],[-9.72,52.85],[-9.55,53.00],[-9.68,53.08],
            [-9.88,53.12],[-10.05,53.18],[-10.12,53.28],[-10.08,53.38],[-9.95,53.48],
            [-9.82,53.55],[-9.95,53.62],[-10.05,53.55],[-10.15,53.52],[-10.08,53.45],
            // Mayo, Sligo, Donegal
            [-10.02,53.62],[-9.88,53.72],[-9.78,53.85],[-9.65,53.92],[-9.55,54.05],
            [-9.45,54.12],[-9.35,54.18],[-9.15,54.22],[-8.95,54.25],[-8.78,54.30],
            [-8.60,54.38],[-8.45,54.42],[-8.28,54.48],[-8.18,54.55],[-8.05,54.62],
            // North Donegal
            [-7.88,54.72],[-7.72,54.78],[-7.55,54.85],[-7.42,54.95],[-7.48,55.05],
            [-7.55,55.15],[-7.42,55.22],[-7.32,55.25],[-7.22,55.20],[-7.08,55.22],
            // Northeast — Derry, Antrim
            [-6.88,55.18],[-6.72,55.15],[-6.58,55.12],[-6.42,55.08],[-6.25,55.05],
            [-6.12,55.08],[-5.98,55.12],[-5.88,55.10],[-5.78,55.02],[-5.72,54.92],
            // East coast back down
            [-5.68,54.82],[-5.75,54.72],[-5.82,54.62],[-5.88,54.52],[-5.92,54.42],
            [-5.98,54.32],[-6.02,54.22],[-6.08,54.12],[-6.12,54.02],[-6.08,53.88],
            [-6.02,53.72],[-6.05,53.58],[-6.10,53.48],[-6.05,53.35]
        ];
        drawPath(ctx, ire, lonToX, latToY);

        // ── European coastlines (dimmer, thinner) ──
        ctx.strokeStyle = palette.euroCoastColor;
        ctx.lineWidth = palette.euroCoastWidth;

        // Norway — fjord-detailed coastline
        drawPath(ctx, euroCoastData.norwayCoast, lonToX, latToY);

        // Sweden/Finland — east coast with Gulf of Bothnia
        drawPath(ctx, euroCoastData.swedenCoast, lonToX, latToY);

        // NW Europe — Brittany to Jutland
        drawPath(ctx, euroCoastData.europeCoast, lonToX, latToY);

        // Denmark islands
        drawPath(ctx, euroCoastData.denmarkIslands, lonToX, latToY);

        // Iceland — with Westfjords
        drawPath(ctx, euroCoastData.icelandCoast, lonToX, latToY);
    }

    function drawPath(ctx, points, lonToX, latToY) {
        if (points.length < 2) return;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(lonToX(points[0][0]), latToY(points[0][1]));
        for (var i = 1; i < points.length; i++) {
            ctx.lineTo(lonToX(points[i][0]), latToY(points[i][1]));
        }
        ctx.stroke();
    }

    // ═══════════════════════════════════════════════
    // CLOUD GRID OVERLAY FOR AURORA MAP
    // Fetches 48-point cloud + wind grid from backend
    // ═══════════════════════════════════════════════

    function fetchCloudGrid() {
        fetch('/api/cloud-grid')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.grid && data.grid.length > 0) {
                    cloudGridState.data = data;
                    cloudGridState.lastFetch = Date.now();
                    var canvas = document.getElementById('auroraOvalCanvas');
                    if (canvas) {
                        buildCloudLayer(canvas.width, canvas.height);
                        // Rebuild overlay to show wind arrows above clouds
                        if (auroraState.lonToX) {
                            buildOverlayLayer(
                                auroraState.mapW, auroraState.mapH,
                                auroraState.lonToX, auroraState.latToY,
                                auroraState.mapLatMin, auroraState.mapLatMax,
                                auroraState.mapLonMin, auroraState.mapLonMax
                            );
                        }
                    }
                    // Show the cloud slider and legend
                    var slider = document.getElementById('cloudHourSlider');
                    if (slider) slider.style.display = 'block';
                    var legend = document.getElementById('cloudLegend');
                    if (legend) legend.style.display = '';
                }
            })
            .catch(function(err) {
                console.warn('Cloud grid fetch failed:', err);
            });
    }

    function buildCloudLayer(W, H) {
        if (!cloudGridState.data) return;
        if (!auroraState.cloudCanvas) auroraState.cloudCanvas = createOffscreen(W, H);

        var cc = auroraState.cloudCanvas;
        var cctx = cc.getContext('2d');
        cctx.clearRect(0, 0, W, H);

        var latMin = 40, latMax = 72, lonMin = -30, lonMax = 30;
        function cLonToX(lon) { return ((lon - lonMin) / (lonMax - lonMin)) * W; }
        function cLatToY(lat) { return ((latMax - lat) / (latMax - latMin)) * H; }

        var grid = cloudGridState.data.grid;
        var hourIdx = cloudGridState.hourOffset;

        // Grid cell dimensions for patch sizing
        var gridLonStep = 8;
        var gridLatStep = 6;
        var cellRadiusX = (gridLonStep / (lonMax - lonMin)) * W * 0.7;
        var cellRadiusY = (gridLatStep / (latMax - latMin)) * H * 0.7;
        var cellRadius = Math.max(cellRadiusX, cellRadiusY);

        // Procedural multi-patch cloud rendering
        for (var i = 0; i < grid.length; i++) {
            var point = grid[i];
            var hourData = point.hours && point.hours[hourIdx];
            if (!hourData) continue;

            var cloudPct = hourData.cloud_cover;
            if (cloudPct <= 5) continue;

            var x = cLonToX(point.lon);
            var y = cLatToY(point.lat);

            // Seeded RNG for deterministic texture per grid point
            var seed = Math.round(point.lat * 1000) * 31 + Math.round(point.lon * 1000);
            var rand = mulberry32(seed);

            var baseOpacity = (cloudPct / 100) * 0.33;
            var windSpeed = hourData.wind_speed || 0;
            var windDir = hourData.wind_direction || 0;
            var windRad = (windDir * Math.PI) / 180;
            var elongation = 1.0 + Math.min(0.8, windSpeed / 30);

            // Number of sub-patches: 3 for light cloud, 4-5 for dense
            var numPatches = cloudPct < 40 ? 3 : (cloudPct < 70 ? 4 : 5);

            for (var p = 0; p < numPatches; p++) {
                // Random offset from grid centre (within 60% of cell radius)
                var offX = (rand() - 0.5) * cellRadius * 1.2;
                var offY = (rand() - 0.5) * cellRadius * 1.2;
                var px = x + offX;
                var py = y + offY;

                // Varying size: small / medium / large
                var sizeRoll = rand();
                var patchSize;
                if (sizeRoll < 0.3) patchSize = cellRadius * (0.25 + rand() * 0.15);       // small
                else if (sizeRoll < 0.7) patchSize = cellRadius * (0.4 + rand() * 0.2);     // medium
                else patchSize = cellRadius * (0.65 + rand() * 0.2);                          // large

                // Per-patch opacity variation
                var patchOpacity = baseOpacity * (0.5 + rand() * 0.5);

                // Colour variation: warmer white to cooler grey
                var r = Math.round(185 + rand() * 25);
                var g = Math.round(195 + rand() * 20);
                var b = Math.round(205 + rand() * 15);

                // Apply wind elongation via canvas transform
                cctx.save();
                cctx.translate(px, py);
                cctx.rotate(windRad);
                cctx.scale(elongation, 1.0);

                // 5-stop radial gradient for natural falloff
                var grad = cctx.createRadialGradient(0, 0, 0, 0, 0, patchSize);
                grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + patchOpacity + ')');
                grad.addColorStop(0.2, 'rgba(' + r + ',' + g + ',' + b + ',' + (patchOpacity * 0.85) + ')');
                grad.addColorStop(0.5, 'rgba(' + r + ',' + g + ',' + b + ',' + (patchOpacity * 0.5) + ')');
                grad.addColorStop(0.75, 'rgba(' + r + ',' + g + ',' + b + ',' + (patchOpacity * 0.2) + ')');
                grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
                cctx.fillStyle = grad;
                cctx.beginPath();
                cctx.arc(0, 0, patchSize, 0, Math.PI * 2);
                cctx.fill();

                cctx.restore();
            }
        }

        // Soften with blur, then add density cores via screen blend
        try {
            var temp = createOffscreen(W, H);
            var tctx = temp.getContext('2d');
            tctx.filter = 'blur(5px)';
            tctx.drawImage(cc, 0, 0);
            cctx.clearRect(0, 0, W, H);
            // Base layer — softened clouds
            cctx.drawImage(temp, 0, 0);
            // Density cores — screen blended at reduced alpha for luminous centres
            cctx.globalCompositeOperation = 'screen';
            cctx.globalAlpha = 0.5;
            tctx.filter = 'blur(10px)';
            tctx.clearRect(0, 0, W, H);
            tctx.drawImage(cc, 0, 0);
            cctx.drawImage(temp, 0, 0);
            cctx.globalCompositeOperation = 'source-over';
            cctx.globalAlpha = 1.0;
        } catch (e) {
            // blur not supported — multi-patch rendering is already textured
        }
    }

    function drawWindArrows(ctx, grid, hourIdx, lonToX, latToY) {
        for (var i = 0; i < grid.length; i++) {
            var point = grid[i];
            var hourData = point.hours && point.hours[hourIdx];
            if (!hourData || hourData.wind_speed < 2) continue;

            var x = lonToX(point.lon);
            var y = latToY(point.lat);

            // Wind direction is FROM, arrow should point TO (add 180°)
            var dirRad = ((hourData.wind_direction + 180) % 360) * Math.PI / 180;

            // Arrow length scales with wind speed (5–20px)
            var len = Math.min(20, Math.max(5, hourData.wind_speed * 0.8));

            // Arrow opacity scales with wind speed
            var alpha = Math.min(0.6, 0.2 + hourData.wind_speed / 50);
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + alpha + ')';
            ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha + ')';
            ctx.lineWidth = 1.2;
            ctx.lineCap = 'round';

            // Shaft
            var endX = x + Math.sin(dirRad) * len;
            var endY = y - Math.cos(dirRad) * len;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // Arrowhead
            var headLen = 4;
            var headAngle = Math.PI / 6;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
                endX - headLen * Math.sin(dirRad - headAngle),
                endY + headLen * Math.cos(dirRad - headAngle)
            );
            ctx.lineTo(
                endX - headLen * Math.sin(dirRad + headAngle),
                endY + headLen * Math.cos(dirRad + headAngle)
            );
            ctx.closePath();
            ctx.fill();
        }
    }


    // ═══════════════════════════════════════════════
    // AURORA HORIZON VIEW — Realistic simulated view
    // from the user's location looking north
    // ═══════════════════════════════════════════════

    var auroraViewState = {
        animFrameId: null,
        startTime: 0,
        stars: [],        // pre-generated star positions
        raindrops: [],    // pre-generated rain particles
        snowflakes: [],   // pre-generated snow particles
        lightningFlash: 0,       // 0-1 brightness
        lightningCooldown: 5,    // seconds until next eligible flash
        lastLightningTime: 0,    // timestamp of last flash
        conditions: null  // cached conditions data
    };

    function initAuroraView() {
        var canvas = document.getElementById('auroraViewCanvas');
        if (!canvas) return;

        var data = window.__auroraViewData || {};
        auroraViewState.conditions = data;

        var W = canvas.width;
        var H = canvas.height;

        // Pre-generate stars (only once)
        if (auroraViewState.stars.length === 0) {
            for (var i = 0; i < 200; i++) {
                auroraViewState.stars.push({
                    x: Math.random() * W,
                    y: Math.random() * H * 0.7,  // stars only above horizon
                    size: Math.random() * 1.5 + 0.3,
                    brightness: Math.random() * 0.6 + 0.2,
                    twinkleSpeed: Math.random() * 3 + 1
                });
            }
        }

        // Pre-generate rain particles (only once)
        if (auroraViewState.raindrops.length === 0) {
            for (var ri = 0; ri < 150; ri++) {
                auroraViewState.raindrops.push({
                    x: Math.random() * W,
                    y: Math.random() * H * 0.82,
                    speed: 4 + Math.random() * 4,
                    length: 8 + Math.random() * 12,
                    opacity: 0.15 + Math.random() * 0.25
                });
            }
        }

        // Pre-generate snow particles (only once)
        if (auroraViewState.snowflakes.length === 0) {
            for (var si = 0; si < 120; si++) {
                auroraViewState.snowflakes.push({
                    x: Math.random() * W,
                    y: Math.random() * H * 0.82,
                    size: 1 + Math.random() * 2.5,
                    speed: 0.3 + Math.random() * 0.8,
                    drift: Math.random() * Math.PI * 2,
                    driftSpeed: 0.5 + Math.random() * 1.5,
                    driftAmp: 10 + Math.random() * 20,
                    opacity: 0.4 + Math.random() * 0.4
                });
            }
        }

        // Update condition summary text
        var condEl = document.getElementById('auroraViewConditions');
        if (condEl) {
            var parts = [];
            if (data.kp !== null && data.kp !== undefined) parts.push('Kp ' + parseFloat(data.kp).toFixed(1));
            if (data.cloudCover !== null && data.cloudCover !== undefined) parts.push(data.cloudCover + '% cloud');
            if (data.darknessStatus) parts.push(data.darknessStatus === 'dark' ? 'Dark' : data.darknessStatus.charAt(0).toUpperCase() + data.darknessStatus.slice(1));
            if (data.moonIllumination !== null && data.moonIllumination !== undefined) parts.push('Moon ' + data.moonIllumination + '%');
            if (data.bortle) parts.push('Bortle ' + data.bortle);
            condEl.textContent = parts.join(' \u00b7 ');
        }

        auroraViewState.startTime = performance.now();
        startAuroraViewAnimation(canvas);
    }
    // Expose globally so conditions can be overridden from console
    window.initAuroraView = function() {
        if (auroraViewState.animFrameId) {
            cancelAnimationFrame(auroraViewState.animFrameId);
            auroraViewState.animFrameId = null;
        }
        initAuroraView();
    };

    function startAuroraViewAnimation(canvas) {
        if (auroraViewState.animFrameId) return;

        var ctx = canvas.getContext('2d');
        var W = canvas.width;
        var H = canvas.height;
        var data = auroraViewState.conditions || {};

        var kp = parseFloat(data.kp) || 0;
        var threshold = parseFloat(data.kpThreshold) || 5;
        var cloud = parseFloat(data.cloudCover) || 0;
        var isDark = data.darknessStatus === 'dark';
        var isCivilTwilight = data.darknessStatus === 'civil_twilight';
        var isNauticalTwilight = data.darknessStatus === 'nautical_twilight';
        var isAstroTwilight = data.darknessStatus === 'astronomical_twilight';
        var isTwilight = data.darknessStatus === 'twilight' || isCivilTwilight || isNauticalTwilight || isAstroTwilight;
        var isDaylight = !isDark && !isTwilight;
        var moonIllum = parseFloat(data.moonIllumination) || 0;
        var lat = parseFloat(data.lat) || 52;
        var bortle = parseInt(data.bortle) || 5;

        // ── Weather classification from WMO weather code ──
        var weatherCode = parseInt(data.weatherCode) || 0;
        var windSpeed = parseFloat(data.windSpeed) || 0;
        var windLevelRaw = data.windLevel || 'calm';
        var windLevel = (typeof windLevelRaw === 'object') ? (windLevelRaw.level || 'calm') : windLevelRaw;
        var visibilityKm = parseFloat(data.visibilityKm) || 10;

        var isRaining = (weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82);
        var isSnowing = (weatherCode >= 71 && weatherCode <= 77) || (weatherCode >= 85 && weatherCode <= 86);
        var isDrizzle = weatherCode >= 51 && weatherCode <= 55;
        var isThunderstorm = weatherCode >= 95 && weatherCode <= 99;
        var isFog = weatherCode === 45 || weatherCode === 48;
        var isClearSky = weatherCode <= 1;
        var isOvercast = weatherCode === 3 || cloud > 80;

        // Precipitation intensity (0-1 scale from WMO code)
        var precipIntensity = 0;
        if (isRaining) {
            if (weatherCode === 51 || weatherCode === 61 || weatherCode === 80) precipIntensity = 0.3;
            else if (weatherCode === 53 || weatherCode === 63 || weatherCode === 81) precipIntensity = 0.6;
            else if (weatherCode === 55 || weatherCode === 65 || weatherCode === 67 || weatherCode === 82) precipIntensity = 1.0;
            else precipIntensity = 0.5;
        } else if (isSnowing) {
            if (weatherCode === 71 || weatherCode === 85) precipIntensity = 0.3;
            else if (weatherCode === 73) precipIntensity = 0.6;
            else if (weatherCode === 75 || weatherCode === 77 || weatherCode === 86) precipIntensity = 1.0;
            else precipIntensity = 0.5;
        }
        if (isThunderstorm) precipIntensity = Math.max(precipIntensity, 0.8);

        // Wind factor (0-1 from wind level)
        var windFactor = 0;
        if (windLevel === 'calm') windFactor = 0;
        else if (windLevel === 'light') windFactor = 0.2;
        else if (windLevel === 'moderate') windFactor = 0.5;
        else if (windLevel === 'strong') windFactor = 0.8;
        else if (windLevel === 'gale' || windLevel === 'storm') windFactor = 1.0;
        else windFactor = Math.min(1, windSpeed / 60);

        // Dawn vs dusk detection
        var isDawn = false, isDusk = false;
        if (isCivilTwilight || isNauticalTwilight) {
            var now = new Date();
            var currentHour = now.getHours() + now.getMinutes() / 60;
            var sunriseH = 6, sunsetH = 20; // defaults
            if (data.sunrise) {
                var sp = data.sunrise.split(':');
                if (sp.length >= 2) sunriseH = parseInt(sp[0]) + parseInt(sp[1]) / 60;
            }
            if (data.sunset) {
                var sp2 = data.sunset.split(':');
                if (sp2.length >= 2) sunsetH = parseInt(sp2[0]) + parseInt(sp2[1]) / 60;
            }
            var midday = (sunriseH + sunsetH) / 2;
            isDawn = currentHour < midday;
            isDusk = !isDawn;
        }

        // Calculate aurora intensity from Kp and threshold
        var margin = kp - threshold;
        var auroraIntensity = 0;
        if (isDark || isTwilight) {
            if (margin >= 3) auroraIntensity = 1.0;
            else if (margin >= 2) auroraIntensity = 0.85;
            else if (margin >= 1) auroraIntensity = 0.65;
            else if (margin >= 0) auroraIntensity = 0.45;
            else if (margin >= -1) auroraIntensity = 0.2;
            else if (margin >= -2) auroraIntensity = 0.08;
            else auroraIntensity = 0;
        }

        // How high the aurora extends above horizon (latitude dependent)
        // Higher latitude = aurora reaches higher in sky
        var auroraMaxHeight = 0.25; // fraction of canvas height from horizon up
        if (margin >= 3) auroraMaxHeight = 0.65;
        else if (margin >= 2) auroraMaxHeight = 0.50;
        else if (margin >= 1) auroraMaxHeight = 0.40;
        else if (margin >= 0) auroraMaxHeight = 0.30;
        else if (margin >= -1) auroraMaxHeight = 0.18;

        // Latitude bonus: further north = higher aurora
        var latBonus = Math.max(0, (lat - 50) / 20) * 0.1;
        auroraMaxHeight = Math.min(0.8, auroraMaxHeight + latBonus);

        // Twilight reduces intensity
        if (isTwilight) auroraIntensity *= 0.3;
        if (!isDark && !isTwilight) auroraIntensity = 0;

        // Moon washes out faint aurora
        if (moonIllum > 70) auroraIntensity *= 0.6;
        else if (moonIllum > 40) auroraIntensity *= 0.8;

        // Light pollution washes out faint aurora (Bortle 1=darkest, 9=brightest)
        // Bortle 7-9: heavy LP, only strong aurora visible
        // Bortle 5-6: moderate LP, slight reduction
        // Bortle 1-4: dark site, no penalty
        var lpFactor = 1.0;  // multiplier for aurora visibility
        if (bortle >= 8) lpFactor = 0.3;
        else if (bortle >= 7) lpFactor = 0.5;
        else if (bortle >= 6) lpFactor = 0.75;
        else if (bortle >= 5) lpFactor = 0.9;
        auroraIntensity *= lpFactor;

        // Cloud reduces visibility
        var cloudFactor = 1 - (cloud / 100) * 0.95;

        // Horizon line position (ground takes bottom 18%)
        var horizonY = H * 0.82;

        // Generate aurora curtain control points (fixed per session, animated over time)
        var curtainCount = margin >= 2 ? 5 : (margin >= 0 ? 3 : 2);
        var curtains = [];
        for (var c = 0; c < curtainCount; c++) {
            curtains.push({
                xOffset: (c / curtainCount) * W + W * 0.1,
                width: W / curtainCount * (0.6 + Math.random() * 0.6),
                phase: Math.random() * Math.PI * 2,
                speed: 0.3 + Math.random() * 0.4,
                drift: 0.2 + Math.random() * 0.3,
                // Per-curtain colour variation for realism
                hueShift: (Math.random() - 0.5) * 0.3,
                redBias: Math.random(),
                brightnessVar: 0.85 + Math.random() * 0.3
            });
        }

        // Helper: apply per-curtain colour variation (hue shift + brightness)
        function variedRGBA(r, g, b, alpha, cur) {
            var shift = cur.hueShift;
            var nr = Math.round(Math.min(255, Math.max(0, r)));
            var ng = Math.round(Math.min(255, Math.max(0, g * (1 - shift * 0.5))));
            var nb = Math.round(Math.min(255, Math.max(0, b * (1 + shift))));
            var na = Math.max(0, alpha * cur.brightnessVar);
            return 'rgba(' + nr + ',' + ng + ',' + nb + ',' + na.toFixed(3) + ')';
        }

        function frame(timestamp) {
            var elapsed = (timestamp - auroraViewState.startTime) / 1000;

            ctx.clearRect(0, 0, W, H);

            // ── Sky gradient (8 palettes based on time + weather) ──
            var skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
            if (isDark) {
                if (isOvercast && cloud > 80) {
                    // Overcast night — slightly lighter (cloud reflection)
                    skyGrad.addColorStop(0, '#121218');
                    skyGrad.addColorStop(0.4, '#181820');
                    skyGrad.addColorStop(0.7, '#1e1e28');
                    skyGrad.addColorStop(1, '#242430');
                } else if (bortle >= 7) {
                    // Heavy light pollution — washed-out orange-grey sky glow
                    skyGrad.addColorStop(0, '#0e0e18');
                    skyGrad.addColorStop(0.3, '#141420');
                    skyGrad.addColorStop(0.7, '#1e1828');
                    skyGrad.addColorStop(1, '#2a2030');
                } else if (bortle >= 5) {
                    // Moderate LP — slightly brighter near horizon
                    skyGrad.addColorStop(0, '#060512');
                    skyGrad.addColorStop(0.3, '#0a0a1a');
                    skyGrad.addColorStop(0.7, '#0e1224');
                    skyGrad.addColorStop(1, '#151a2e');
                } else {
                    // Dark site — truly dark skies
                    skyGrad.addColorStop(0, '#050510');
                    skyGrad.addColorStop(0.3, '#080818');
                    skyGrad.addColorStop(0.7, '#0a0e20');
                    skyGrad.addColorStop(1, '#0e1428');
                }
            } else if (isAstroTwilight) {
                // Astronomical twilight — near-dark with faint horizon glow
                skyGrad.addColorStop(0, '#060510');
                skyGrad.addColorStop(0.4, '#0a0a1a');
                skyGrad.addColorStop(0.7, '#10122e');
                skyGrad.addColorStop(1, '#1a2048');
            } else if (isNauticalTwilight) {
                // Nautical twilight — deep blue-purple
                skyGrad.addColorStop(0, '#0a0e28');
                skyGrad.addColorStop(0.3, '#101638');
                skyGrad.addColorStop(0.6, '#1e2050');
                skyGrad.addColorStop(1, '#3e3e70');
            } else if (isCivilTwilight) {
                if (isOvercast) {
                    // Civil twilight overcast — muted warm grey
                    skyGrad.addColorStop(0, '#1a1e30');
                    skyGrad.addColorStop(0.4, '#2a2830');
                    skyGrad.addColorStop(0.7, '#453e38');
                    skyGrad.addColorStop(1, '#605040');
                } else {
                    // Civil twilight clear — golden hour orange/pink/purple
                    skyGrad.addColorStop(0, '#1a2a5c');
                    skyGrad.addColorStop(0.25, '#2e2858');
                    skyGrad.addColorStop(0.45, '#6a3858');
                    skyGrad.addColorStop(0.65, '#c06838');
                    skyGrad.addColorStop(0.85, '#e09040');
                    skyGrad.addColorStop(1, '#f0a848');
                }
            } else if (isTwilight) {
                // Generic twilight fallback
                skyGrad.addColorStop(0, '#0a0e20');
                skyGrad.addColorStop(0.5, '#141830');
                skyGrad.addColorStop(0.8, '#1e2848');
                skyGrad.addColorStop(1, '#283058');
            } else {
                // Daylight
                if (isOvercast) {
                    // Overcast daylight — flat grey
                    skyGrad.addColorStop(0, '#8a8e96');
                    skyGrad.addColorStop(0.3, '#969aa4');
                    skyGrad.addColorStop(0.6, '#a8acb4');
                    skyGrad.addColorStop(1, '#b8bcc4');
                } else {
                    // Clear daylight — bright blue sky
                    skyGrad.addColorStop(0, '#1a6fd4');
                    skyGrad.addColorStop(0.3, '#4a8ee0');
                    skyGrad.addColorStop(0.6, '#88b8ec');
                    skyGrad.addColorStop(1, '#d4e8fa');
                }
            }
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, W, horizonY);

            // ── Dawn/dusk directional horizon glow ──
            if (isCivilTwilight && !isOvercast) {
                var glowX = isDawn ? W * 0.85 : W * 0.15; // East=right (dawn), West=left (dusk) looking north
                var glowGradTw = ctx.createRadialGradient(glowX, horizonY * 0.7, 0, glowX, horizonY * 0.7, W * 0.55);
                glowGradTw.addColorStop(0, 'rgba(240, 160, 60, 0.25)');
                glowGradTw.addColorStop(0.3, 'rgba(220, 120, 50, 0.15)');
                glowGradTw.addColorStop(0.6, 'rgba(180, 80, 40, 0.06)');
                glowGradTw.addColorStop(1, 'rgba(140, 60, 30, 0)');
                ctx.fillStyle = glowGradTw;
                ctx.fillRect(0, 0, W, horizonY);
            } else if (isNauticalTwilight) {
                var glowXn = isDawn ? W * 0.85 : W * 0.15;
                var glowGradNt = ctx.createRadialGradient(glowXn, horizonY * 0.8, 0, glowXn, horizonY * 0.8, W * 0.45);
                glowGradNt.addColorStop(0, 'rgba(140, 80, 100, 0.15)');
                glowGradNt.addColorStop(0.4, 'rgba(100, 60, 80, 0.08)');
                glowGradNt.addColorStop(1, 'rgba(60, 40, 60, 0)');
                ctx.fillStyle = glowGradNt;
                ctx.fillRect(0, 0, W, horizonY);
            }

            // ── Storm darkening overlay ──
            if (isThunderstorm) {
                var stormAlpha = isDaylight ? 0.4 : 0.2;
                ctx.fillStyle = 'rgba(15, 15, 25, ' + stormAlpha + ')';
                ctx.fillRect(0, 0, W, horizonY);
            }

            // ── Fog overlay ──
            if (isFog || visibilityKm < 2) {
                var fogAlpha = isFog ? 0.3 : Math.max(0, (2 - visibilityKm) / 2) * 0.25;
                if (isDaylight) {
                    ctx.fillStyle = 'rgba(180, 185, 190, ' + fogAlpha.toFixed(3) + ')';
                } else {
                    ctx.fillStyle = 'rgba(60, 65, 70, ' + (fogAlpha * 0.6).toFixed(3) + ')';
                }
                ctx.fillRect(0, 0, W, horizonY);
            }

            // ── Light pollution sky glow (warm haze near horizon) ──
            if ((isDark || isTwilight) && bortle >= 5) {
                var lpGlowAlpha = bortle >= 8 ? 0.18 : bortle >= 7 ? 0.12 : bortle >= 6 ? 0.06 : 0.03;
                var lpGlow = ctx.createRadialGradient(W * 0.5, horizonY, 0, W * 0.5, horizonY, H * 0.5);
                lpGlow.addColorStop(0, 'rgba(180, 140, 80, ' + lpGlowAlpha + ')');
                lpGlow.addColorStop(0.4, 'rgba(140, 100, 60, ' + (lpGlowAlpha * 0.5) + ')');
                lpGlow.addColorStop(1, 'rgba(100, 80, 50, 0)');
                ctx.fillStyle = lpGlow;
                ctx.fillRect(0, 0, W, horizonY);
            }

            // ── Sun disc + glow (daylight only) ──
            if (isDaylight && cloud < 90) {
                // Sun position: arc across sky based on time
                // Looking north, sun is behind the viewer — appears high and moves R→L
                var nowDate = new Date();
                var sunriseHr = 6, sunsetHr = 20;
                if (data.sunrise) { var ssp = data.sunrise.split(':'); if (ssp.length >= 2) sunriseHr = parseInt(ssp[0]) + parseInt(ssp[1]) / 60; }
                if (data.sunset) { var ssp2 = data.sunset.split(':'); if (ssp2.length >= 2) sunsetHr = parseInt(ssp2[0]) + parseInt(ssp2[1]) / 60; }
                var dayLength = sunsetHr - sunriseHr;
                var currentHr = nowDate.getHours() + nowDate.getMinutes() / 60;
                var dayProgress = Math.max(0, Math.min(1, (currentHr - sunriseHr) / dayLength));

                // Sun tracks behind viewer (looking north) — appears near top edges
                var sunX = W * (0.85 - dayProgress * 0.7); // right to left
                var sunArc = Math.sin(dayProgress * Math.PI); // peaks at midday
                var sunY = H * 0.05 + (1 - sunArc) * H * 0.25; // higher at midday

                var sunGlowAlpha = cloud > 50 ? 0.15 : 0.35;

                // Large soft glow
                ctx.save();
                var sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 80);
                sunGlow.addColorStop(0, 'rgba(255, 250, 220, ' + sunGlowAlpha.toFixed(2) + ')');
                sunGlow.addColorStop(0.2, 'rgba(255, 245, 200, ' + (sunGlowAlpha * 0.6).toFixed(2) + ')');
                sunGlow.addColorStop(0.5, 'rgba(255, 240, 180, ' + (sunGlowAlpha * 0.2).toFixed(2) + ')');
                sunGlow.addColorStop(1, 'rgba(255, 235, 160, 0)');
                ctx.fillStyle = sunGlow;
                ctx.beginPath();
                ctx.arc(sunX, sunY, 80, 0, Math.PI * 2);
                ctx.fill();

                // Bright disc
                if (cloud < 70) {
                    ctx.beginPath();
                    ctx.arc(sunX, sunY, 8, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 250, 230, 0.9)';
                    ctx.fill();
                    // White core
                    ctx.beginPath();
                    ctx.arc(sunX, sunY, 4, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
                    ctx.fill();
                }
                ctx.restore();
            }

            // ── Stars (only when dark/twilight) ──
            if (isDark || isTwilight) {
                var starAlpha = isDark ? 1 : (isAstroTwilight ? 0.7 : isNauticalTwilight ? 0.4 : 0.15);
                // Moon reduces star visibility
                if (moonIllum > 50) starAlpha *= 0.5;
                // Light pollution washes out faint stars
                if (bortle >= 8) starAlpha *= 0.15;
                else if (bortle >= 7) starAlpha *= 0.3;
                else if (bortle >= 6) starAlpha *= 0.55;
                else if (bortle >= 5) starAlpha *= 0.75;
                // Cloud reduces stars
                starAlpha *= cloudFactor;

                var twinkleTurb = 1 + windFactor * 2; // wind makes stars twinkle faster
                for (var s = 0; s < auroraViewState.stars.length; s++) {
                    var star = auroraViewState.stars[s];
                    var twinkle = 0.5 + 0.5 * Math.sin(elapsed * star.twinkleSpeed * twinkleTurb + s);
                    var alpha = star.brightness * twinkle * starAlpha;
                    if (alpha < 0.02) continue;
                    ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
                    ctx.beginPath();
                    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // ── Aurora curtains ──
            if (auroraIntensity > 0.01) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';

                for (var ci = 0; ci < curtains.length; ci++) {
                    var cur = curtains[ci];
                    var wave = Math.sin(elapsed * cur.speed + cur.phase);
                    var driftX = Math.sin(elapsed * cur.drift + ci) * 15;
                    var cx = cur.xOffset + driftX;
                    var cw = cur.width * (0.9 + 0.1 * wave);

                    // Aurora height oscillates
                    var heightFraction = auroraMaxHeight * (0.85 + 0.15 * Math.sin(elapsed * 0.4 + ci * 1.5));
                    var auroraTop = horizonY - H * heightFraction;

                    // Create aurora curtain gradient
                    var aGrad = ctx.createLinearGradient(0, auroraTop, 0, horizonY);
                    var intensity = auroraIntensity * cloudFactor;

                    // Colour varies by curtain and intensity — based on real aurora emission lines
                    // Oxygen green (557.7nm), Oxygen red (630nm), Nitrogen blue (427.8nm)
                    var a = intensity;
                    var cur = curtains[ci];

                    if (margin >= 2) {
                        // Strong: crimson-red tops (O 630nm) → warm green core (O 557.7nm) → pink lower edge (N₂+)
                        var rb = 0.5 + 0.5 * cur.redBias; // per-curtain red intensity at top
                        aGrad.addColorStop(0.0,  variedRGBA(180, 40, 50,   a * 0.10 * rb, cur));  // crimson red at extreme top
                        aGrad.addColorStop(0.05, variedRGBA(170, 35, 55,   a * 0.14 * rb, cur));  // deepening red
                        aGrad.addColorStop(0.10, variedRGBA(155, 30, 60,   a * 0.18 * rb, cur));  // red with slight magenta
                        aGrad.addColorStop(0.18, variedRGBA(120, 80, 55,   a * 0.22, cur));       // warm amber transition
                        aGrad.addColorStop(0.25, variedRGBA(80, 140, 50,   a * 0.30, cur));       // olive-green, red fading
                        aGrad.addColorStop(0.35, variedRGBA(60, 200, 70,   a * 0.42, cur));       // brightening natural green
                        aGrad.addColorStop(0.45, variedRGBA(70, 220, 75,   a * 0.52, cur));       // peak green
                        aGrad.addColorStop(0.50, variedRGBA(140, 240, 130, a * 0.55, cur));       // white-green core (brightest)
                        aGrad.addColorStop(0.55, variedRGBA(100, 230, 90,  a * 0.52, cur));       // bright, slightly less white
                        aGrad.addColorStop(0.65, variedRGBA(60, 200, 70,   a * 0.40, cur));       // returning to natural green
                        aGrad.addColorStop(0.80, variedRGBA(80, 130, 75,   a * 0.22, cur));       // green transitioning
                        aGrad.addColorStop(0.90, variedRGBA(140, 70, 100,  a * 0.12, cur));       // pink/magenta lower edge (N₂+)
                        aGrad.addColorStop(1.0,  variedRGBA(120, 50, 80,   a * 0.03, cur));       // fading magenta at horizon
                    } else if (margin >= 0) {
                        // Moderate: subtle lavender hint at top → natural green body
                        aGrad.addColorStop(0.0,  variedRGBA(70, 70, 90,    a * 0.04, cur));       // faint cool lavender
                        aGrad.addColorStop(0.10, variedRGBA(50, 100, 70,   a * 0.08, cur));       // grey-green transition
                        aGrad.addColorStop(0.25, variedRGBA(45, 160, 60,   a * 0.18, cur));       // green emerging
                        aGrad.addColorStop(0.40, variedRGBA(55, 190, 65,   a * 0.28, cur));       // natural green, warming
                        aGrad.addColorStop(0.55, variedRGBA(60, 200, 70,   a * 0.32, cur));       // peak natural green
                        aGrad.addColorStop(0.70, variedRGBA(50, 175, 60,   a * 0.24, cur));       // green dimming
                        aGrad.addColorStop(0.85, variedRGBA(40, 140, 55,   a * 0.12, cur));       // dim green
                        aGrad.addColorStop(1.0,  variedRGBA(30, 100, 45,   a * 0.02, cur));       // barely visible fade
                    } else {
                        // Faint: desaturated grey-green, barely perceptible
                        aGrad.addColorStop(0.0,  variedRGBA(30, 50, 35,    a * 0.02, cur));       // barely there grey-green
                        aGrad.addColorStop(0.30, variedRGBA(35, 80, 45,    a * 0.06, cur));       // slight green tint
                        aGrad.addColorStop(0.50, variedRGBA(40, 100, 50,   a * 0.09, cur));       // peak — desaturated green
                        aGrad.addColorStop(0.70, variedRGBA(35, 80, 45,    a * 0.06, cur));       // fading
                        aGrad.addColorStop(1.0,  variedRGBA(25, 55, 35,    a * 0.01, cur));       // nearly invisible
                    }

                    // Draw curtain as a wide soft column
                    ctx.fillStyle = aGrad;
                    ctx.beginPath();

                    // Wavy curtain shape using bezier curves
                    var leftX = cx - cw / 2;
                    var rightX = cx + cw / 2;
                    var waveAmp = 12 + margin * 3;

                    ctx.moveTo(leftX, horizonY);
                    // Left edge going up — wavy
                    for (var py = horizonY; py > auroraTop; py -= 10) {
                        var frac = (horizonY - py) / (horizonY - auroraTop);
                        var wx = leftX + Math.sin(frac * 4 + elapsed * 0.5 + ci) * waveAmp * frac;
                        ctx.lineTo(wx, py);
                    }
                    // Top edge
                    var topWave1 = auroraTop + Math.sin(elapsed * 0.3 + ci * 2) * 8;
                    ctx.lineTo(cx, topWave1);
                    // Right edge going down — wavy
                    for (var py2 = auroraTop; py2 < horizonY; py2 += 10) {
                        var frac2 = (horizonY - py2) / (horizonY - auroraTop);
                        var wx2 = rightX + Math.sin(frac2 * 4 - elapsed * 0.5 + ci + 1) * waveAmp * frac2;
                        ctx.lineTo(wx2, py2);
                    }
                    ctx.closePath();
                    ctx.fill();
                }

                // Add a subtle overall aurora glow near horizon — colour varies with intensity
                if (auroraIntensity > 0.2) {
                    var glowH = margin >= 2 ? 0.18 : 0.15;
                    var glowGrad = ctx.createLinearGradient(0, horizonY - H * glowH, 0, horizonY);
                    var glowA = auroraIntensity * cloudFactor * 0.15;

                    if (margin >= 2) {
                        // Strong: warm green glow with pink-tinted horizon
                        glowGrad.addColorStop(0, 'rgba(60, 180, 65, 0)');
                        glowGrad.addColorStop(0.3, 'rgba(70, 190, 70, ' + (glowA * 0.25).toFixed(3) + ')');
                        glowGrad.addColorStop(0.6, 'rgba(90, 180, 75, ' + (glowA * 0.5).toFixed(3) + ')');
                        glowGrad.addColorStop(0.85, 'rgba(110, 140, 80, ' + (glowA * 0.7).toFixed(3) + ')');
                        glowGrad.addColorStop(1, 'rgba(130, 100, 85, ' + glowA.toFixed(3) + ')');
                    } else if (margin >= 0) {
                        // Moderate: clean natural green glow
                        glowGrad.addColorStop(0, 'rgba(50, 170, 60, 0)');
                        glowGrad.addColorStop(0.5, 'rgba(55, 180, 65, ' + (glowA * 0.4).toFixed(3) + ')');
                        glowGrad.addColorStop(1, 'rgba(50, 160, 60, ' + (glowA * 0.8).toFixed(3) + ')');
                    } else {
                        // Faint: very subtle grey-green glow
                        glowGrad.addColorStop(0, 'rgba(35, 80, 45, 0)');
                        glowGrad.addColorStop(0.5, 'rgba(38, 90, 48, ' + (glowA * 0.3).toFixed(3) + ')');
                        glowGrad.addColorStop(1, 'rgba(35, 80, 45, ' + (glowA * 0.5).toFixed(3) + ')');
                    }

                    ctx.fillStyle = glowGrad;
                    ctx.fillRect(0, horizonY - H * glowH, W, H * glowH);
                }

                ctx.restore();
            }

            // ── Cloud overlay (time-aware colours + wind drift) ──
            if (cloud > 5) {
                var cloudAlpha = (cloud / 100) * 0.8;
                ctx.save();

                // Time-aware cloud colours
                var clR, clG, clB, clR2, clG2, clB2;
                if (isDaylight) {
                    // Bright grey-white clouds lit by sun
                    clR = 160 + Math.random() * 40; clG = 165 + Math.random() * 40; clB = 175 + Math.random() * 30;
                    clR2 = 140 + Math.random() * 40; clG2 = 145 + Math.random() * 40; clB2 = 155 + Math.random() * 30;
                } else if (isCivilTwilight) {
                    // Warm-tinted grey for twilight
                    clR = 80; clG = 70; clB = 75;
                    clR2 = 65; clG2 = 58; clB2 = 62;
                } else {
                    // Night: dark grey
                    clR = 40; clG = 45; clB = 55;
                    clR2 = 35; clG2 = 40; clB2 = 50;
                }

                var cloudDriftSpeed = 0.08 + windFactor * 0.15;
                var cloudDriftAmp = 30 + windFactor * 50;

                // Draw multiple cloud layers
                for (var cl = 0; cl < 4; cl++) {
                    var clY = H * 0.15 + cl * H * 0.15;
                    var clDrift = Math.sin(elapsed * cloudDriftSpeed + cl * 1.5) * cloudDriftAmp;
                    var clAlpha = cloudAlpha * (0.4 + cl * 0.15);

                    var cloudGrad = ctx.createRadialGradient(
                        W / 2 + clDrift + cl * 60, clY, 0,
                        W / 2 + clDrift + cl * 60, clY, W * 0.6
                    );
                    cloudGrad.addColorStop(0, 'rgba(' + Math.round(clR) + ',' + Math.round(clG) + ',' + Math.round(clB) + ',' + clAlpha.toFixed(3) + ')');
                    cloudGrad.addColorStop(0.4, 'rgba(' + Math.round(clR2) + ',' + Math.round(clG2) + ',' + Math.round(clB2) + ',' + (clAlpha * 0.7).toFixed(3) + ')');
                    cloudGrad.addColorStop(1, 'rgba(' + Math.round(clR2) + ',' + Math.round(clG2) + ',' + Math.round(clB2) + ', 0)');
                    ctx.fillStyle = cloudGrad;
                    ctx.fillRect(0, 0, W, horizonY);
                }

                // Dense cloud cover
                if (cloud > 70) {
                    var denseAlpha = ((cloud - 70) / 30) * 0.5;
                    if (isDaylight) {
                        ctx.fillStyle = 'rgba(130, 135, 145, ' + denseAlpha.toFixed(3) + ')';
                    } else {
                        ctx.fillStyle = 'rgba(25, 30, 40, ' + denseAlpha.toFixed(3) + ')';
                    }
                    ctx.fillRect(0, 0, W, horizonY);
                }
                ctx.restore();
            }

            // ── Moon glow (if bright moon) ──
            if (moonIllum > 20 && (isDark || isTwilight)) {
                var moonX = W * 0.82;
                var moonY = H * 0.15;
                var moonGlowR = 40 + moonIllum * 0.6;
                var moonAlpha = (moonIllum / 100) * 0.3 * cloudFactor;

                ctx.save();
                var moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonGlowR);
                moonGlow.addColorStop(0, 'rgba(255, 252, 230, ' + moonAlpha.toFixed(3) + ')');
                moonGlow.addColorStop(0.3, 'rgba(255, 252, 230, ' + (moonAlpha * 0.4).toFixed(3) + ')');
                moonGlow.addColorStop(1, 'rgba(255, 252, 230, 0)');
                ctx.fillStyle = moonGlow;
                ctx.beginPath();
                ctx.arc(moonX, moonY, moonGlowR, 0, Math.PI * 2);
                ctx.fill();

                // Moon disc
                var discR = 6 + moonIllum * 0.04;
                ctx.beginPath();
                ctx.arc(moonX, moonY, discR, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 252, 235, ' + (0.5 + moonIllum / 200).toFixed(2) + ')';
                ctx.fill();
                ctx.restore();
            }

            // ── Rain streaks ──
            if (isRaining || (isThunderstorm && precipIntensity > 0)) {
                ctx.save();
                var rainAngle = calculateRainAngle(windSpeed);
                var rainRad = rainAngle * Math.PI / 180;
                var activeRain = Math.floor(150 * precipIntensity);
                var rainR, rainG, rainB;
                if (isDaylight) { rainR = 180; rainG = 190; rainB = 210; }
                else { rainR = 140; rainG = 155; rainB = 180; }
                var rainLW = isDrizzle ? 0.5 : 1;

                for (var rd = 0; rd < activeRain; rd++) {
                    var drop = auroraViewState.raindrops[rd];
                    // Update position
                    drop.y += drop.speed;
                    drop.x += Math.sin(rainRad) * drop.speed * 0.5;
                    // Wrap around
                    if (drop.y > horizonY) { drop.y = -drop.length; drop.x = Math.random() * W; }
                    if (drop.x > W) drop.x -= W;
                    if (drop.x < 0) drop.x += W;

                    var endX = drop.x + Math.sin(rainRad) * drop.length;
                    var endY = drop.y + Math.cos(rainRad) * drop.length;

                    ctx.strokeStyle = 'rgba(' + rainR + ',' + rainG + ',' + rainB + ',' + drop.opacity.toFixed(2) + ')';
                    ctx.lineWidth = rainLW;
                    ctx.beginPath();
                    ctx.moveTo(drop.x, drop.y);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // ── Snow particles ──
            if (isSnowing) {
                ctx.save();
                var activeSnow = Math.floor(120 * precipIntensity);

                for (var sf = 0; sf < activeSnow; sf++) {
                    var flake = auroraViewState.snowflakes[sf];
                    // Update position
                    flake.y += flake.speed;
                    flake.x += Math.sin(elapsed * flake.driftSpeed + flake.drift) * 0.3 + windFactor * 1.5;
                    // Wrap around
                    if (flake.y > horizonY) { flake.y = -flake.size; flake.x = Math.random() * W; }
                    if (flake.x > W) flake.x -= W;
                    if (flake.x < 0) flake.x += W;

                    ctx.fillStyle = 'rgba(240, 245, 255, ' + flake.opacity.toFixed(2) + ')';
                    ctx.beginPath();
                    ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // ── Lightning flash (sky overlay) ──
            if (isThunderstorm) {
                // Decay existing flash
                auroraViewState.lightningFlash *= 0.6;
                if (auroraViewState.lightningFlash < 0.01) auroraViewState.lightningFlash = 0;

                // Cooldown timer
                var timeSinceLastFlash = elapsed - auroraViewState.lastLightningTime;
                if (timeSinceLastFlash > auroraViewState.lightningCooldown && auroraViewState.lightningFlash === 0) {
                    // Random trigger: ~1% chance per frame
                    if (Math.random() < 0.01) {
                        auroraViewState.lightningFlash = 0.7 + Math.random() * 0.3;
                        auroraViewState.lastLightningTime = elapsed;
                        auroraViewState.lightningCooldown = 8 + Math.random() * 12;

                        // 30% chance of double-flash
                        if (Math.random() < 0.3) {
                            setTimeout(function() {
                                auroraViewState.lightningFlash = 0.5 + Math.random() * 0.3;
                            }, 100 + Math.random() * 150);
                        }
                    }
                }

                // Render flash overlay
                if (auroraViewState.lightningFlash > 0.01) {
                    var flashA = auroraViewState.lightningFlash * 0.7;
                    ctx.fillStyle = 'rgba(220, 225, 255, ' + flashA.toFixed(3) + ')';
                    ctx.fillRect(0, 0, W, horizonY);
                }
            }

            // ── Ground / Landscape silhouette (time-aware colours) ──
            var gndR, gndG, gndB, gndR2, gndG2, gndB2;
            if (isDaylight) {
                gndR = 42; gndG = 64; gndB = 32; gndR2 = 34; gndG2 = 52; gndB2 = 26;
            } else if (isCivilTwilight) {
                gndR = 26; gndG = 42; gndB = 20; gndR2 = 20; gndG2 = 32; gndB2 = 14;
            } else {
                gndR = 10; gndG = 14; gndB = 8; gndR2 = 8; gndG2 = 12; gndB2 = 6;
            }
            var groundGrad = ctx.createLinearGradient(0, horizonY - 5, 0, H);
            groundGrad.addColorStop(0, 'rgb(' + gndR + ',' + gndG + ',' + gndB + ')');
            groundGrad.addColorStop(0.15, 'rgb(' + gndR2 + ',' + gndG2 + ',' + gndB2 + ')');
            var gndBottomR = Math.max(2, Math.round(gndR2 * 0.6));
            var gndBottomG = Math.max(2, Math.round(gndG2 * 0.6));
            var gndBottomB = Math.max(2, Math.round(gndB2 * 0.6));
            groundGrad.addColorStop(1, 'rgb(' + gndBottomR + ',' + gndBottomG + ',' + gndBottomB + ')');
            ctx.fillStyle = groundGrad;
            ctx.fillRect(0, horizonY, W, H - horizonY);

            // Rolling hills silhouette (time-aware)
            var hillR, hillG, hillB;
            if (isDaylight) { hillR = 30; hillG = 48; hillB = 24; }
            else if (isCivilTwilight) { hillR = 20; hillG = 30; hillB = 16; }
            else { hillR = 10; hillG = 14; hillB = 8; }
            ctx.fillStyle = 'rgb(' + hillR + ',' + hillG + ',' + hillB + ')';
            ctx.beginPath();
            ctx.moveTo(0, horizonY);
            for (var hx = 0; hx <= W; hx += 2) {
                var hill = Math.sin(hx * 0.008) * 8 + Math.sin(hx * 0.02 + 1) * 4 + Math.sin(hx * 0.05 + 2) * 2;
                ctx.lineTo(hx, horizonY - hill - 3);
            }
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();

            // Tree silhouettes with wind sway
            var treeR, treeG, treeB;
            if (isDaylight) { treeR = 20; treeG = 36; treeB = 16; }
            else if (isCivilTwilight) { treeR = 14; treeG = 22; treeB = 10; }
            else { treeR = 6; treeG = 10; treeB = 4; }
            ctx.fillStyle = 'rgb(' + treeR + ',' + treeG + ',' + treeB + ')';
            var trees = [40, 95, 150, 280, 350, 420, 510, 580, 650, 720, 760];
            for (var ti = 0; ti < trees.length; ti++) {
                var tx = trees[ti];
                var treeH = 8 + Math.sin(ti * 2.3) * 5;
                var hillOffset = Math.sin(tx * 0.008) * 8 + Math.sin(tx * 0.02 + 1) * 4 + Math.sin(tx * 0.05 + 2) * 2;
                var tBase = horizonY - hillOffset - 3;
                // Wind sway: apex moves, base stays fixed
                var sway = Math.sin(elapsed * (1.5 + windFactor * 2) + ti * 0.7) * windFactor * 3
                         + Math.sin(elapsed * (3 + windFactor * 3) + ti * 1.05) * windFactor * 0.9;
                ctx.beginPath();
                ctx.moveTo(tx - 3, tBase);
                ctx.lineTo(tx + sway, tBase - treeH);
                ctx.lineTo(tx + 3, tBase);
                ctx.closePath();
                ctx.fill();
            }

            // ── Lightning ground reflection ──
            if (isThunderstorm && auroraViewState.lightningFlash > 0.01) {
                var gndFlashA = auroraViewState.lightningFlash * 0.15;
                ctx.fillStyle = 'rgba(180, 190, 210, ' + gndFlashA.toFixed(3) + ')';
                ctx.fillRect(0, horizonY, W, H - horizonY);
            }

            // ── Compass label ──
            var compassAlpha = isDaylight ? 0.5 : 0.35;
            ctx.fillStyle = 'rgba(255,255,255,' + compassAlpha + ')';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('N', W / 2, horizonY + 14);
            ctx.fillText('NW', W * 0.15, horizonY + 14);
            ctx.fillText('NE', W * 0.85, horizonY + 14);
            ctx.textAlign = 'left';

            // ── Status text messages (weather-aware) ──
            var statusMsg = '';
            var statusMsg2 = '';
            var statusMsg3 = '';
            if (isDaylight) {
                if (isRaining || isThunderstorm) {
                    statusMsg = 'Rainy day \u2014 aurora only visible after dark';
                } else if (isSnowing) {
                    statusMsg = 'Snowy day \u2014 aurora only visible after dark';
                } else {
                    statusMsg = 'Daylight \u2014 aurora only visible after dark';
                }
            } else if (isDark || isTwilight) {
                if (isRaining || isSnowing || isThunderstorm) {
                    statusMsg = 'Precipitation blocking the sky';
                    statusMsg2 = (data.weatherDescription || 'Rain/snow') + ' \u2014 wait for clearer skies';
                } else if (cloud > 80) {
                    statusMsg = 'Heavy cloud cover blocking the sky';
                    statusMsg2 = cloud + '% cloud \u2014 aurora may be hidden';
                } else if (isFog) {
                    statusMsg = 'Fog reducing visibility';
                    statusMsg2 = 'Visibility ' + visibilityKm.toFixed(1) + ' km';
                } else if (auroraIntensity < 0.01) {
                    statusMsg = 'Aurora activity too low for ' + (data.locationName || 'your location');
                    statusMsg2 = 'Kp ' + kp.toFixed(1) + ' \u2014 need Kp ' + threshold + '+ for visible aurora';
                    if (bortle >= 7) {
                        statusMsg3 = 'Heavy light pollution \u2014 only strong aurora visible';
                    } else if (bortle >= 6) {
                        statusMsg3 = 'Moderate light pollution \u2014 find a darker spot for best views';
                    }
                }
            }

            if (statusMsg) {
                ctx.fillStyle = isDaylight ? 'rgba(40,40,60,0.5)' : 'rgba(255,255,255,0.25)';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(statusMsg, W / 2, H * 0.4);
                if (statusMsg2) {
                    ctx.font = '11px sans-serif';
                    ctx.fillText(statusMsg2, W / 2, H * 0.4 + 18);
                }
                if (statusMsg3) {
                    ctx.fillText(statusMsg3, W / 2, H * 0.4 + 34);
                }
                ctx.textAlign = 'left';
            }

            auroraViewState.animFrameId = requestAnimationFrame(frame);
        }

        auroraViewState.animFrameId = requestAnimationFrame(frame);
    }

    // ── Initial fetch and refresh every 5 minutes ──
    updateAuroraStatus();
    setInterval(updateAuroraStatus, 300000);

    // Render aurora oval (initial + refresh every 5 minutes)
    renderAuroraOval();
    setInterval(renderAuroraOval, 300000);
    window.renderAuroraOval = renderAuroraOval;  // expose for demo/testing

    // Cloud forecast slider — hourly stepping
    var cloudRange = document.getElementById('cloudHourRange');
    if (cloudRange) {
        cloudRange.addEventListener('input', function() {
            cloudGridState.hourOffset = parseInt(this.value, 10);
            var label = document.getElementById('cloudHourLabel');
            if (label) {
                label.textContent = this.value === '0' ? 'Now' : '+' + this.value + 'h';
            }
            var canvas = document.getElementById('auroraOvalCanvas');
            if (canvas) {
                buildCloudLayer(canvas.width, canvas.height);
                // Rebuild overlay to update wind arrows for new hour
                if (auroraState.lonToX) {
                    buildOverlayLayer(
                        auroraState.mapW, auroraState.mapH,
                        auroraState.lonToX, auroraState.latToY,
                        auroraState.mapLatMin, auroraState.mapLatMax,
                        auroraState.mapLonMin, auroraState.mapLonMax
                    );
                }
            }
        });
    }

    // Render aurora horizon view
    initAuroraView();

    // Pause/resume aurora animation when tab is hidden/visible
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            if (auroraState.animFrameId) {
                cancelAnimationFrame(auroraState.animFrameId);
                auroraState.animFrameId = null;
            }
            if (auroraViewState.animFrameId) {
                cancelAnimationFrame(auroraViewState.animFrameId);
                auroraViewState.animFrameId = null;
            }
        } else {
            var canvas = document.getElementById('auroraOvalCanvas');
            if (canvas && auroraState.auroraCanvas) {
                startAuroraAnimation(canvas);
            }
            var viewCanvas = document.getElementById('auroraViewCanvas');
            if (viewCanvas) {
                startAuroraViewAnimation(viewCanvas);
            }
        }
    });

});
