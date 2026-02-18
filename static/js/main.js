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
                            cHtml += '<div class="hourly-bar-col" title="' + ch.hour + ': ' + ch.cloud_pct + '% cloud">';
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
                var newViewData = {
                    kp: data.kp_index,
                    kpThreshold: kpThreshold,
                    cloudCover: (data.current_weather && data.current_weather.cloud_cover) || 0,
                    darknessStatus: (data.darkness_info && data.darkness_info.darkness_status) || 'unknown',
                    moonIllumination: (data.moon_phase && data.moon_phase.illumination) || 0,
                    moonPhase: (data.moon_phase && data.moon_phase.phase_fraction) || 0,
                    lat: window.__userLat,
                    locationName: userLocation,
                    bortle: (data.light_pollution && data.light_pollution.bortle) || 5
                };
                window.__auroraViewData = newViewData;
                auroraViewState.conditions = newViewData;
                // Restart view animation with new data
                if (auroraViewState.animFrameId) {
                    cancelAnimationFrame(auroraViewState.animFrameId);
                    auroraViewState.animFrameId = null;
                }
                initAuroraView();

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
        animFrameId: null,    // requestAnimationFrame handle
        animStartTime: 0      // for sinusoidal shimmer timing
    };

    function createOffscreen(w, h) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    // Interpolated aurora colour palette (real aurora colours)
    function auroraColor(val) {
        if (val <= 0) return null;
        var stops = [
            { t: 0.5,  r: 10,  g: 61,  b: 10,  a: 0.12 },
            { t: 2,    r: 0,   g: 140, b: 60,  a: 0.30 },
            { t: 4,    r: 0,   g: 204, b: 102, a: 0.45 },
            { t: 6,    r: 0,   g: 255, b: 136, a: 0.55 },
            { t: 8,    r: 0,   g: 221, b: 187, a: 0.62 },
            { t: 10,   r: 34,  g: 255, b: 170, a: 0.68 },
            { t: 12,   r: 136, g: 255, b: 68,  a: 0.72 },
            { t: 14,   r: 204, g: 68,  b: 255, a: 0.78 },
            { t: 16,   r: 255, g: 51,  b: 102, a: 0.85 }
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
        drawLandFills(lctx, lonToX, latToY);
    }

    function buildOverlayLayer(W, H, lonToX, latToY, latMin, latMax, lonMin, lonMax) {
        if (!auroraState.overlayCanvas) auroraState.overlayCanvas = createOffscreen(W, H);
        var oc = auroraState.overlayCanvas;
        var octx = oc.getContext('2d');
        octx.clearRect(0, 0, W, H);

        // Coastline strokes (land fills are on separate layer below aurora)
        drawCoastlines(octx, lonToX, latToY);

        // Grid lines
        octx.strokeStyle = 'rgba(255,255,255,0.06)';
        octx.lineWidth = 0.5;
        for (var gLat = 45; gLat <= 70; gLat += 5) {
            octx.beginPath();
            octx.moveTo(0, latToY(gLat));
            octx.lineTo(W, latToY(gLat));
            octx.stroke();
            octx.fillStyle = 'rgba(255,255,255,0.2)';
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

            // Ocean background — dark blue gradient
            var seaGrad = ctx.createLinearGradient(0, 0, 0, H);
            seaGrad.addColorStop(0, '#060d18');   // deep navy at top (high latitudes)
            seaGrad.addColorStop(0.4, '#0a1422'); // mid ocean blue
            seaGrad.addColorStop(1, '#0c1628');   // slightly lighter at bottom
            ctx.fillStyle = seaGrad;
            ctx.fillRect(0, 0, W, H);

            // Land fills below aurora (so aurora glows over land)
            if (auroraState.landCanvas) {
                ctx.drawImage(auroraState.landCanvas, 0, 0);
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

    // Fill land masses as solid polygons (subtle dark land colour)
    function drawLandFills(ctx, lonToX, latToY) {
        var landColor = 'rgba(22, 28, 20, 0.85)';       // dark earthy green-grey
        var landColorBright = 'rgba(28, 35, 25, 0.80)';  // UK/Ireland slightly brighter

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
        fillPoly(uk, landColorBright);

        // Islands
        var shetland = [[-1.30,60.15],[-1.20,60.10],[-1.08,60.15],[-1.02,60.25],[-1.10,60.35],[-1.05,60.43],[-1.10,60.50],[-1.22,60.50],[-1.30,60.45],[-1.35,60.38],[-1.32,60.30],[-1.28,60.22],[-1.30,60.15]];
        fillPoly(shetland, landColorBright);

        var orkney = [[-2.95,58.88],[-2.82,58.85],[-2.78,58.90],[-2.85,58.98],[-2.95,59.00],[-3.10,59.02],[-3.18,58.98],[-3.22,58.92],[-3.15,58.88],[-2.95,58.88]];
        fillPoly(orkney, landColorBright);

        var hebrides = [[-6.15,57.18],[-6.08,57.28],[-6.15,57.38],[-6.22,57.48],[-6.18,57.58],[-6.25,57.72],[-6.18,57.82],[-6.30,57.92],[-6.35,58.05],[-6.42,58.15],[-6.38,58.25],[-6.30,58.28],[-6.22,58.22],[-6.32,58.12],[-6.28,58.02],[-6.38,57.90],[-6.30,57.78],[-6.35,57.65],[-6.28,57.55],[-6.35,57.42],[-6.22,57.30],[-6.15,57.18]];
        fillPoly(hebrides, landColorBright);

        var skye = [[-5.80,57.08],[-5.72,57.12],[-5.65,57.18],[-5.75,57.25],[-5.88,57.28],[-6.02,57.30],[-6.12,57.27],[-6.18,57.22],[-6.12,57.15],[-5.98,57.10],[-5.88,57.08],[-5.80,57.08]];
        fillPoly(skye, landColorBright);

        var mull = [[-5.72,56.42],[-5.62,56.45],[-5.55,56.50],[-5.65,56.55],[-5.78,56.52],[-5.90,56.48],[-5.92,56.42],[-5.85,56.38],[-5.72,56.42]];
        fillPoly(mull, landColorBright);

        var iom = [[-4.35,54.08],[-4.30,54.12],[-4.32,54.20],[-4.38,54.28],[-4.42,54.35],[-4.48,54.38],[-4.55,54.35],[-4.58,54.28],[-4.55,54.20],[-4.50,54.12],[-4.42,54.08],[-4.35,54.08]];
        fillPoly(iom, landColorBright);

        var anglesey = [[-4.08,53.22],[-4.15,53.25],[-4.22,53.28],[-4.32,53.30],[-4.42,53.28],[-4.48,53.25],[-4.52,53.22],[-4.45,53.18],[-4.35,53.18],[-4.22,53.20],[-4.12,53.22],[-4.08,53.22]];
        fillPoly(anglesey, landColorBright);

        var iow = [[-1.10,50.65],[-1.18,50.68],[-1.28,50.70],[-1.42,50.70],[-1.52,50.68],[-1.55,50.65],[-1.48,50.63],[-1.38,50.62],[-1.25,50.62],[-1.15,50.63],[-1.10,50.65]];
        fillPoly(iow, landColorBright);

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
        fillPoly(ire, landColorBright);

        // European landmasses — fill with dimmer colour
        // Norway (simplified filled shape extending to map edge)
        var norFill = [
            [5.0,58.0],[6.0,58.0],[7.0,58.0],[8.0,58.5],[8.5,59.0],[9.0,59.5],[10.0,59.0],
            [11.0,59.0],[12.0,58.5],[12.0,59.0],[11.5,59.5],[11.0,60.0],[10.5,60.5],
            [9.0,61.0],[7.0,62.0],[6.0,62.5],[5.5,63.0],[6.0,63.5],[7.0,64.0],
            [9.0,64.5],[10.0,65.0],[12.0,65.5],[14.0,66.5],[15.0,67.5],[16.0,68.5],
            [18.0,69.0],[20.0,69.5],[22.0,69.8],[25.0,70.0],[28.0,70.5],[30.0,70.0],
            [30.0,72.0],[5.0,72.0]
        ];
        fillPoly(norFill, landColor);

        // Sweden/Finland
        var sweFill = [
            [12.0,56.0],[12.5,56.5],[13.0,57.0],[12.5,57.5],[12.0,58.0],[12.0,58.5],
            [12.0,59.0],[11.5,59.5],[11.0,60.0],[10.5,60.5],[11.0,60.0],[12.0,59.5],
            [13.0,59.0],[14.0,58.5],[14.5,58.0],[14.0,57.5],[13.0,56.5],[12.0,56.0]
        ];
        fillPoly(sweFill, landColor);

        // NW Europe coast — fill below the coastline to bottom of map
        var eurFill = [
            [-30.0,48.0],[-4.0,48.0],[-3.0,48.5],[-2.0,48.5],[-1.5,48.6],[-1.0,49.0],[0.0,49.5],
            [1.0,50.0],[1.6,50.8],[2.5,51.0],[3.5,51.3],[4.0,51.5],[4.5,51.8],
            [5.0,52.0],[5.5,52.5],[5.0,53.0],[5.5,53.3],[6.0,53.5],[7.0,53.5],
            [8.0,54.0],[8.5,54.5],[9.0,55.0],[9.5,55.5],[10.0,55.5],[10.5,55.0],
            [10.0,54.5],[9.5,54.5],[9.0,54.0],[8.5,53.5],[8.0,54.0],[7.0,53.5],
            [7.0,40.0],[-30.0,40.0]
        ];
        fillPoly(eurFill, landColor);

        // Iceland
        var ice = [
            [-22.0,64.0],[-21.0,63.5],[-19.0,63.3],[-17.0,63.5],[-15.0,64.0],
            [-14.0,64.5],[-14.0,65.5],[-15.0,66.0],[-17.0,66.3],[-19.0,66.5],
            [-21.0,66.3],[-23.0,66.0],[-24.0,65.5],[-23.0,64.5],[-22.0,64.0]
        ];
        fillPoly(ice, landColor);
    }

    function drawCoastlines(ctx, lonToX, latToY) {
        // ── UK & Ireland (brighter, thicker) ──
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.5;

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
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;

        // Norway
        var nor = [
            [5.0,58.0],[6.0,58.0],[7.0,58.0],[8.0,58.5],[8.5,59.0],[9.0,59.5],[10.0,59.0],
            [11.0,59.0],[12.0,58.5],[12.0,59.0],[11.5,59.5],[11.0,60.0],[10.5,60.5],
            [9.0,61.0],[7.0,62.0],[6.0,62.5],[5.5,63.0],[6.0,63.5],[7.0,64.0],
            [9.0,64.5],[10.0,65.0],[12.0,65.5],[14.0,66.5],[15.0,67.5],[16.0,68.5],
            [18.0,69.0],[20.0,69.5],[22.0,69.8],[25.0,70.0],[28.0,70.5],[30.0,70.0]
        ];
        drawPath(ctx, nor, lonToX, latToY);

        // Sweden/Finland west coast
        var swe = [
            [12.0,56.0],[12.5,56.5],[13.0,57.0],[12.5,57.5],[12.0,58.0],[12.0,58.5],
            [12.0,59.0],[11.5,59.5],[11.0,60.0],[10.5,60.5],[11.0,60.0],[12.0,59.5],
            [13.0,59.0],[14.0,58.5],[14.5,58.0],[14.0,57.5],[13.0,56.5],[12.0,56.0]
        ];
        drawPath(ctx, swe, lonToX, latToY);

        // NW Europe (France/Belgium/Netherlands coast)
        var eur = [
            [-4.0,48.0],[-3.0,48.5],[-2.0,48.5],[-1.5,48.6],[-1.0,49.0],[0.0,49.5],
            [1.0,50.0],[1.6,50.8],[2.5,51.0],[3.5,51.3],[4.0,51.5],[4.5,51.8],
            [5.0,52.0],[5.5,52.5],[5.0,53.0],[5.5,53.3],[6.0,53.5],[7.0,53.5],
            [8.0,54.0],[8.5,54.5],[9.0,55.0],[9.5,55.5],[10.0,55.5],[10.5,55.0],
            [10.0,54.5],[9.5,54.5],[9.0,54.0],[8.5,53.5],[8.0,54.0],[7.0,53.5]
        ];
        drawPath(ctx, eur, lonToX, latToY);

        // Iceland
        var ice = [
            [-22.0,64.0],[-21.0,63.5],[-19.0,63.3],[-17.0,63.5],[-15.0,64.0],
            [-14.0,64.5],[-14.0,65.5],[-15.0,66.0],[-17.0,66.3],[-19.0,66.5],
            [-21.0,66.3],[-23.0,66.0],[-24.0,65.5],[-23.0,64.5],[-22.0,64.0]
        ];
        drawPath(ctx, ice, lonToX, latToY);
    }

    function drawPath(ctx, points, lonToX, latToY) {
        if (points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(lonToX(points[0][0]), latToY(points[0][1]));
        for (var i = 1; i < points.length; i++) {
            ctx.lineTo(lonToX(points[i][0]), latToY(points[i][1]));
        }
        ctx.stroke();
    }

    // ═══════════════════════════════════════════════
    // AURORA HORIZON VIEW — Realistic simulated view
    // from the user's location looking north
    // ═══════════════════════════════════════════════

    var auroraViewState = {
        animFrameId: null,
        startTime: 0,
        stars: [],       // pre-generated star positions
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
        var isTwilight = data.darknessStatus === 'twilight' || data.darknessStatus === 'civil_twilight' || data.darknessStatus === 'nautical_twilight';
        var moonIllum = parseFloat(data.moonIllumination) || 0;
        var lat = parseFloat(data.lat) || 52;
        var bortle = parseInt(data.bortle) || 5;

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
                drift: 0.2 + Math.random() * 0.3
            });
        }

        function frame(timestamp) {
            var elapsed = (timestamp - auroraViewState.startTime) / 1000;

            ctx.clearRect(0, 0, W, H);

            // ── Sky gradient (dark sky or twilight) ──
            // Light pollution brightens the sky (especially near horizon)
            var skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
            if (isDark) {
                if (bortle >= 7) {
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
            } else if (isTwilight) {
                skyGrad.addColorStop(0, '#0a0e20');
                skyGrad.addColorStop(0.5, '#141830');
                skyGrad.addColorStop(0.8, '#1e2848');
                skyGrad.addColorStop(1, '#283058');
            } else {
                // Daylight — brighter sky, no aurora
                skyGrad.addColorStop(0, '#1a2040');
                skyGrad.addColorStop(0.5, '#2a3868');
                skyGrad.addColorStop(1, '#4a5888');
            }
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, W, horizonY);

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

            // ── Stars (only when dark) ──
            if (isDark || isTwilight) {
                var starAlpha = isDark ? 1 : 0.3;
                // Moon reduces star visibility
                if (moonIllum > 50) starAlpha *= 0.5;
                // Light pollution washes out faint stars
                if (bortle >= 8) starAlpha *= 0.15;
                else if (bortle >= 7) starAlpha *= 0.3;
                else if (bortle >= 6) starAlpha *= 0.55;
                else if (bortle >= 5) starAlpha *= 0.75;
                // Cloud reduces stars
                starAlpha *= cloudFactor;

                for (var s = 0; s < auroraViewState.stars.length; s++) {
                    var star = auroraViewState.stars[s];
                    var twinkle = 0.5 + 0.5 * Math.sin(elapsed * star.twinkleSpeed + s);
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

                    // Colour varies by curtain and intensity
                    if (margin >= 2) {
                        // Strong: green/cyan with purple tops
                        aGrad.addColorStop(0, 'rgba(160, 60, 200, ' + (intensity * 0.15).toFixed(3) + ')');
                        aGrad.addColorStop(0.15, 'rgba(100, 40, 180, ' + (intensity * 0.2).toFixed(3) + ')');
                        aGrad.addColorStop(0.3, 'rgba(0, 200, 120, ' + (intensity * 0.35).toFixed(3) + ')');
                        aGrad.addColorStop(0.5, 'rgba(0, 230, 130, ' + (intensity * 0.5).toFixed(3) + ')');
                        aGrad.addColorStop(0.7, 'rgba(0, 210, 150, ' + (intensity * 0.4).toFixed(3) + ')');
                        aGrad.addColorStop(1, 'rgba(0, 180, 100, ' + (intensity * 0.05).toFixed(3) + ')');
                    } else if (margin >= 0) {
                        // Moderate: green/teal
                        aGrad.addColorStop(0, 'rgba(0, 160, 100, ' + (intensity * 0.08).toFixed(3) + ')');
                        aGrad.addColorStop(0.3, 'rgba(0, 200, 110, ' + (intensity * 0.3).toFixed(3) + ')');
                        aGrad.addColorStop(0.6, 'rgba(0, 220, 130, ' + (intensity * 0.35).toFixed(3) + ')');
                        aGrad.addColorStop(1, 'rgba(0, 150, 80, ' + (intensity * 0.03).toFixed(3) + ')');
                    } else {
                        // Faint: dim green glow
                        aGrad.addColorStop(0, 'rgba(0, 120, 60, ' + (intensity * 0.04).toFixed(3) + ')');
                        aGrad.addColorStop(0.4, 'rgba(0, 160, 80, ' + (intensity * 0.12).toFixed(3) + ')');
                        aGrad.addColorStop(1, 'rgba(0, 100, 50, ' + (intensity * 0.02).toFixed(3) + ')');
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

                // Add a subtle overall aurora glow near horizon
                if (auroraIntensity > 0.2) {
                    var glowGrad = ctx.createLinearGradient(0, horizonY - H * 0.15, 0, horizonY);
                    var glowA = auroraIntensity * cloudFactor * 0.15;
                    glowGrad.addColorStop(0, 'rgba(0, 200, 120, 0)');
                    glowGrad.addColorStop(0.5, 'rgba(0, 200, 120, ' + (glowA * 0.5).toFixed(3) + ')');
                    glowGrad.addColorStop(1, 'rgba(0, 200, 120, ' + glowA.toFixed(3) + ')');
                    ctx.fillStyle = glowGrad;
                    ctx.fillRect(0, horizonY - H * 0.15, W, H * 0.15);
                }

                ctx.restore();
            }

            // ── Cloud overlay ──
            if (cloud > 5) {
                var cloudAlpha = (cloud / 100) * 0.8;
                ctx.save();

                // Draw multiple cloud layers
                for (var cl = 0; cl < 4; cl++) {
                    var clY = H * 0.15 + cl * H * 0.15;
                    var clDrift = Math.sin(elapsed * 0.08 + cl * 1.5) * 30;
                    var clAlpha = cloudAlpha * (0.4 + cl * 0.15);

                    // Cloud band
                    var cloudGrad = ctx.createRadialGradient(
                        W / 2 + clDrift + cl * 60, clY, 0,
                        W / 2 + clDrift + cl * 60, clY, W * 0.6
                    );
                    cloudGrad.addColorStop(0, 'rgba(40, 45, 55, ' + clAlpha.toFixed(3) + ')');
                    cloudGrad.addColorStop(0.4, 'rgba(35, 40, 50, ' + (clAlpha * 0.7).toFixed(3) + ')');
                    cloudGrad.addColorStop(1, 'rgba(30, 35, 45, 0)');
                    ctx.fillStyle = cloudGrad;
                    ctx.fillRect(0, 0, W, horizonY);
                }

                // Dense cloud cover
                if (cloud > 70) {
                    var denseAlpha = ((cloud - 70) / 30) * 0.5;
                    ctx.fillStyle = 'rgba(25, 30, 40, ' + denseAlpha.toFixed(3) + ')';
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

            // ── Ground / Landscape silhouette ──
            var groundGrad = ctx.createLinearGradient(0, horizonY - 5, 0, H);
            groundGrad.addColorStop(0, '#0a0e08');
            groundGrad.addColorStop(0.15, '#080c06');
            groundGrad.addColorStop(1, '#050804');
            ctx.fillStyle = groundGrad;
            ctx.fillRect(0, horizonY, W, H - horizonY);

            // Rolling hills silhouette
            ctx.fillStyle = '#0a0e08';
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

            // Tree silhouettes (small clusters)
            ctx.fillStyle = '#060a04';
            var trees = [40, 95, 150, 280, 350, 420, 510, 580, 650, 720, 760];
            for (var ti = 0; ti < trees.length; ti++) {
                var tx = trees[ti];
                var treeH = 8 + Math.sin(ti * 2.3) * 5;
                var hillOffset = Math.sin(tx * 0.008) * 8 + Math.sin(tx * 0.02 + 1) * 4 + Math.sin(tx * 0.05 + 2) * 2;
                var tBase = horizonY - hillOffset - 3;
                // Simple triangular tree
                ctx.beginPath();
                ctx.moveTo(tx - 3, tBase);
                ctx.lineTo(tx, tBase - treeH);
                ctx.lineTo(tx + 3, tBase);
                ctx.closePath();
                ctx.fill();
            }

            // ── Compass label ──
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('N', W / 2, horizonY + 14);
            ctx.fillText('NW', W * 0.15, horizonY + 14);
            ctx.fillText('NE', W * 0.85, horizonY + 14);
            ctx.textAlign = 'left';

            // ── "No aurora" message when conditions are poor ──
            if (auroraIntensity < 0.01 && (isDark || isTwilight)) {
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Aurora activity too low for ' + (data.locationName || 'your location'), W / 2, H * 0.4);
                ctx.font = '11px sans-serif';
                ctx.fillText('Kp ' + kp.toFixed(1) + ' \u2014 need Kp ' + threshold + '+ for visible aurora', W / 2, H * 0.4 + 18);
                if (bortle >= 7) {
                    ctx.fillText('Heavy light pollution at this location \u2014 only strong aurora visible', W / 2, H * 0.4 + 34);
                } else if (bortle >= 6) {
                    ctx.fillText('Moderate light pollution \u2014 find a darker spot for best views', W / 2, H * 0.4 + 34);
                }
                ctx.textAlign = 'left';
            } else if (!isDark && !isTwilight) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Daylight \u2014 aurora only visible after dark', W / 2, H * 0.4);
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
