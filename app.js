/* ═══════════════════════════════════════════════════════════
   Storm Track Simulator — Dynamic Selection v4
   Color-graded track + Predict Radius cone tangent lines
   Fetching from TMD API: https://tmd.go.th/api/Weather/StormTrack
   ═══════════════════════════════════════════════════════════ */

// ══════ STATE ══════
let map, currentIdx = 0, isPlaying = false, playInterval = null;
let stormMeta = {};
let stormPath = [];

let trackLayers = L.layerGroup();
let markerLayers = L.layerGroup();
let radiusLayers = L.layerGroup();
let highlightLayers = L.layerGroup();
let labelLayers = L.layerGroup();

let showRadius = true;
let showLabels = false;
let showWindCircles = false;
let timeMode = 'local';

const $ = id => document.getElementById(id);
const STORM_API_BASE = '/api/storm';

function getPrimaryDateTime(point) {
    if (!point) return timeMode === 'utc' ? 'No data' : 'ไม่มีข้อมูล';
    return timeMode === 'utc' ? point.dateTimeEN : point.dateTimeTH;
}

function updateTimeModeButtons() {
    $('mode-local').classList.toggle('active', timeMode === 'local');
    $('mode-utc').classList.toggle('active', timeMode === 'utc');
    $('datetime-label').textContent = timeMode === 'utc' ? 'เวลา (UTC)' : 'เวลา (Local)';
}

function setTimeMode(mode) {
    timeMode = mode;
    updateTimeModeButtons();
    if (stormPath.length && stormPath[currentIdx]) {
        $('datetime-primary').textContent = getPrimaryDateTime(stormPath[currentIdx]);
        $('slider-label-current').textContent = getPrimaryDateTime(stormPath[currentIdx]);
    }
}

function setStormHeader(title, subtitle) {
    $('storm-title').textContent = title;
    $('storm-subtitle').innerHTML = subtitle;
}

function clearStormState(message) {
    stormMeta = {};
    stormPath = [];
    resetApp();
    trackLayers.clearLayers();
    markerLayers.clearLayers();
    radiusLayers.clearLayers();
    labelLayers.clearLayers();
    highlightLayers.clearLayers();
    $('datetime-primary').textContent = timeMode === 'utc' ? 'No data' : 'ไม่มีข้อมูล';
    $('status-chip').className = 'status-chip';
    $('status-label').textContent = 'NO DATA';
    $('predict-chip').style.display = 'none';
    $('gauge-arc').setAttribute('stroke-dasharray', '0 251.33');
    $('gauge-text').textContent = '0';
    $('wind-measured').textContent = '— kt';
    $('wind-predicted').textContent = '— kt';
    $('val-lat').textContent = '—';
    $('val-lon').textContent = '—';
    $('direction-text').textContent = '—';
    $('compass-arrow').style.transform = 'rotate(0deg)';
    $('val-move-speed').textContent = '— km/h';
    $('stat-move-speed').textContent = '— km/h';
    $('class-en').textContent = 'No data';
    $('class-th').textContent = 'ไม่มีข้อมูล';
    $('class-dot').style.background = 'transparent';
    $('class-dot').style.boxShadow = 'none';
    $('class-row').style.borderLeftColor = 'transparent';
    $('val-datatype').innerHTML = '<span class="tag tag-historical">No data</span>';
    $('val-area').textContent = '0.0 km';
    $('val-predict-radius').textContent = '0.0 km';
    $('val-strong-wind').textContent = '0.0 km';
    $('stat-max-wind').textContent = '0.0 kt';
    $('stat-distance').textContent = '— km';
    $('stat-points').textContent = '0';
    $('stat-peak-type').textContent = '—';
    $('stat-peak-type').style.color = '';
    $('stat-period').textContent = '—';
    $('slider-label-current').textContent = message.replace(/<[^>]*>/g, '');
    $('slider-track-bg').innerHTML = '';
    renderChart(-1);
    setStormHeader('ไม่พบข้อมูลพายุ', message);
}

const COLORS = {
    'Tropical Depression': { fill: '#00e5ff', glow: 'rgba(0,229,255,0.4)' },
    'Tropical Storm':      { fill: '#ffd740', glow: 'rgba(255,215,64,0.3)' },
    'Typhoon':             { fill: '#ff3b30', glow: 'rgba(255,59,48,0.35)' }
};

const DIR_DEG = { 'N':0,'NNE':22.5,'NE':45,'ENE':67.5,'E':90,'ESE':112.5,'SE':135,'SSE':157.5,'S':180,'SSW':202.5,'SW':225,'WSW':247.5,'W':270,'WNW':292.5,'NW':315,'NNW':337.5 };

function getColor(t) { return COLORS[t] || COLORS['Tropical Depression']; }
function getWind(p) { return p.windSpeed > 0 ? p.windSpeed : (p.windSpeedPredict || 0); }

// Haversine distance in km
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ══════ INIT ══════
function init() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([15, 105], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    trackLayers.addTo(map);
    radiusLayers.addTo(map);
    markerLayers.addTo(map);
    labelLayers.addTo(map);
    highlightLayers.addTo(map);

    bindEvents();
    updateTimeModeButtons();
    
    // Load initial storm (NAKRI #267)
    $('storm-select').value = '267';
    loadStorm(267);
}

// ══════ FETCH DATA ══════
async function loadStorm(id) {
    const stormId = String(id);

    // Try local data first if not '0' (Current Storm)
    let data = null;
    
    if (stormId !== '0') {
        try {
            const localUrl = `data/storm_${stormId}.json`;
            const localRes = await fetch(localUrl);
            if (localRes.ok) {
                data = await localRes.json();
                console.log(`Loaded storm ${stormId} from local data.`);
            }
        } catch (e) {
            console.warn(`Local data for storm ${stormId} not found, trying API...`);
        }
    }

    // Fallback to API if no local data
    if (!data) {
        const apiUrl = `${STORM_API_BASE}?stormId=${encodeURIComponent(stormId)}`;
        try {
            const apiRes = await fetch(apiUrl);
            if (!apiRes.ok) throw new Error('API response was not ok');
            data = await apiRes.json();
            console.log(`Loaded storm ${stormId} from backend API.`);
        } catch (err) {
            console.error('Error loading storm data:', err);

            clearStormState(
                stormId === '0'
                    ? 'พายุที่กำลังเกิดขึ้น &nbsp;|&nbsp; ไม่สามารถอ่านข้อมูลจาก API ได้ในขณะนี้'
                    : `Storm ID: <span class="mono">#${stormId}</span> &nbsp;|&nbsp; ไม่สามารถโหลดข้อมูลได้`
            );
            return;
        }
    }

    if (data && data.stormTrackingData && data.stormTrackingData.length > 0) {
        const raw = data.stormTrackingData[0];
        stormMeta = {
            name: raw.name,
            nameEN: raw.nameEN,
            id: raw.id,
            startDate: raw.startDate,
            endDate: raw.endDate
        };
        stormPath = raw.path;
        
        // Re-render everything
        resetApp();
        computeStats();
        drawAll();
        drawWindChart();
        updateDisplay(0);
        
        // Update Title
        setStormHeader(
            `${stormMeta.nameEN} — ${stormMeta.name}`,
            `Storm ID: <span class="mono">#${stormMeta.id}</span> &nbsp;|&nbsp; อัปเดตล่าสุด ${raw.endDate || raw.startDate || 'ตอนนี้'}`
        );
        $('storm-select').value = stormId;
        return;
    }

    clearStormState(
        stormId === '0'
            ? 'พายุที่กำลังเกิดขึ้น &nbsp;|&nbsp; ไม่มีข้อมูลในขณะนี้ อัปเดตตอนนี้'
            : `Storm ID: <span class="mono">#${stormId}</span> &nbsp;|&nbsp; ไม่มีข้อมูล`
    );
}

function resetApp() {
    stopPlayback();
    currentIdx = 0;
    $('time-slider').max = Math.max(stormPath.length - 1, 0);
    $('time-slider').value = 0;
    $('point-total').textContent = stormPath.length;
    $('point-current').textContent = stormPath.length ? 1 : 0;
    $('point-progress').style.width = stormPath.length ? `${100 / stormPath.length}%` : '0%';
}

function stopPlayback() {
    isPlaying = false;
    $('btn-play').textContent = '▶';
    $('btn-play').classList.remove('playing');
    if (playInterval) clearInterval(playInterval);
}

// ══════ STATISTICS ══════
function computeStats() {
    let totalDist = 0, maxWind = 0, peakType = 'Tropical Depression';
    const rank = { 'Tropical Depression': 0, 'Tropical Storm': 1, 'Typhoon': 2 };

    for (let i = 0; i < stormPath.length; i++) {
        const p = stormPath[i];
        const w = getWind(p);
        if (w > maxWind) maxWind = w;
        if (rank[p.typeEN] > rank[peakType]) peakType = p.typeEN;
        if (i > 0) totalDist += haversine(stormPath[i-1].latitude, stormPath[i-1].longitude, p.latitude, p.longitude);
    }

    $('stat-max-wind').textContent = `${maxWind.toFixed(1)} kt`;
    $('stat-distance').textContent = `${totalDist.toFixed(0)} km`;
    $('stat-points').textContent = stormPath.length;
    $('stat-peak-type').textContent = peakType;
    $('stat-peak-type').style.color = getColor(peakType).fill;

    const d1 = new Date(stormPath[0].time), d2 = new Date(stormPath[stormPath.length-1].time);
    const formatDate = d => `${d.getDate()}/${d.getMonth()+1}`;
    $('stat-period').textContent = `${formatDate(d1)} — ${formatDate(d2)}`;
}

// ══════ DRAW ALL ══════
function drawAll() {
    markerLayers.clearLayers();
    trackLayers.clearLayers();
    radiusLayers.clearLayers();
    labelLayers.clearLayers();

    drawColorGradedTrack();
    drawPredictCone();
    drawMarkers();

    if (stormPath.length > 0) {
        map.fitBounds(stormPath.map(p => [p.latitude, p.longitude]), { padding: [40, 40] });
    }
}

function drawColorGradedTrack() {
    const historical = stormPath.filter(p => !p.isPredictData);
    for (let i = 1; i < historical.length; i++) {
        const prev = historical[i - 1], curr = historical[i];
        L.polyline([[prev.latitude, prev.longitude], [curr.latitude, curr.longitude]], {
            color: getColor(curr.typeEN).fill, weight: 2.5, opacity: 0.85, smoothFactor: 1
        }).addTo(trackLayers);
    }

    const predicted = stormPath.filter(p => p.isPredictData);
    if (predicted.length > 0 && historical.length > 0) {
        const lastHist = historical[historical.length - 1];
        const predPts = [[lastHist.latitude, lastHist.longitude], ...predicted.map(p => [p.latitude, p.longitude])];
        L.polyline(predPts, { color: getColor(predicted[0].typeEN).fill, weight: 1.5, opacity: 0.35, dashArray: '8,6' }).addTo(trackLayers);
    }
}

function drawPredictCone() {
    const predicted = stormPath.filter(p => p.isPredictData && p.predictRadius > 0);
    if (predicted.length === 0) return;

    const firstPredIdx = stormPath.findIndex(p => p.isPredictData);
    const lastHist = stormPath[firstPredIdx - 1];
    if (!lastHist) return;

    predicted.forEach(p => {
        L.circle([p.latitude, p.longitude], {
            radius: p.predictRadius * 1000,
            color: 'rgba(255, 59, 48, 0.4)', weight: 1.5,
            fillColor: 'rgba(255, 59, 48, 0.12)', fillOpacity: 1, dashArray: '5, 4', interactive: false
        }).addTo(radiusLayers);
    });

    const chain = [{ lat: lastHist.latitude, lon: lastHist.longitude, r: 0 }, ...predicted.map(p => ({ lat: p.latitude, lon: p.longitude, r: p.predictRadius }))];
    const upperPts = [], lowerPts = [];
    upperPts.push([chain[0].lat, chain[0].lon]);
    lowerPts.push([chain[0].lat, chain[0].lon]);

    for (let i = 1; i < chain.length; i++) {
        const prev = chain[i - 1], curr = chain[i];
        const angle = Math.atan2(curr.lat - prev.lat, curr.lon - prev.lon);
        const perpAngle = angle + Math.PI / 2;
        const rLat = curr.r / 111.32, rLon = curr.r / (111.32 * Math.cos(curr.lat * Math.PI / 180));
        upperPts.push([curr.lat + rLat * Math.sin(perpAngle), curr.lon + rLon * Math.cos(perpAngle)]);
        lowerPts.push([curr.lat - rLat * Math.sin(perpAngle), curr.lon - rLon * Math.cos(perpAngle)]);
    }

    L.polyline(upperPts, { color: 'rgba(255, 59, 48, 0.35)', weight: 1.5, dashArray: '6,4', interactive: false }).addTo(radiusLayers);
    L.polyline(lowerPts, { color: 'rgba(255, 59, 48, 0.35)', weight: 1.5, dashArray: '6,4', interactive: false }).addTo(radiusLayers);
}

function drawMarkers() {
    stormPath.forEach((p, i) => {
        const col = getColor(p.typeEN);
        const opacity = p.isPredictData ? 0.4 : 0.85;
        const marker = L.circleMarker([p.latitude, p.longitude], {
            radius: p.isPredictData ? 5 : 6, color: col.fill, weight: 1.5, fillColor: col.fill, fillOpacity: opacity, opacity: opacity
        });
        marker.bindPopup(buildPopup(p, i), { className: 'storm-popup', maxWidth: 300 });
        marker.on('click', () => updateDisplay(i));
        marker.addTo(markerLayers);

        if (showLabels && i % 4 === 0) {
            const icon = L.divIcon({ html: `<div style="font-size:9px;color:#8a9bb5;font-family:JetBrains Mono;white-space:nowrap;transform:translate(12px,-8px)">${p.dateTimeTH.split(' ')[0]}</div>`, iconSize: [1, 1], className: '' });
            L.marker([p.latitude, p.longitude], { icon, interactive: false }).addTo(labelLayers);
        }
    });
}

function buildPopup(p, i) {
    const w = getWind(p);
    return `<div>
        <div class="popup-title">#${i+1} — ${p.typeEN}</div>
        <div class="popup-row"><span class="popup-key">เวลา (TH)</span><span class="popup-val">${p.dateTimeTH}</span></div>
        <div class="popup-row"><span class="popup-key">Lat / Lon</span><span class="popup-val">${p.latitude.toFixed(5)}°, ${p.longitude.toFixed(5)}°</span></div>
        <div class="popup-row"><span class="popup-key">Wind Speed</span><span class="popup-val">${w.toFixed(1)} kt</span></div>
        <div class="popup-row"><span class="popup-key">Visual Radius</span><span class="popup-val">${(p.area / 1000).toFixed(1)} km</span></div>
        <div class="popup-row"><span class="popup-key">Direction</span><span class="popup-val">${p.direction}</span></div>
        <div class="popup-row"><span class="popup-key">Predict R.</span><span class="popup-val">${p.predictRadius > 0 ? p.predictRadius+' km' : '—'}</span></div>
        <div class="popup-row"><span class="popup-key">Data Type</span><span class="popup-val">${p.isPredictData ? '🟢 Predicted' : '🔵 Historical'}</span></div>
    </div>`;
}

// ══════ UPDATE DISPLAY ══════
function updateDisplay(idx) {
    if (!stormPath[idx]) return;
    currentIdx = idx;
    const p = stormPath[idx], col = getColor(p.typeEN), w = getWind(p);

    $('datetime-primary').textContent = getPrimaryDateTime(p);
    const chip = $('status-chip');
    chip.className = 'status-chip';
    $('status-label').textContent = p.typeEN.toUpperCase();
    if (p.typeEN === 'Typhoon') chip.classList.add('typhoon-active');
    else if (p.typeEN === 'Tropical Storm') chip.classList.add('storm-active');
    $('predict-chip').style.display = p.isPredictData ? 'flex' : 'none';

    const pct = Math.min(w / 120, 1);
    $('gauge-arc').setAttribute('stroke-dasharray', `${pct * 251.33} 251.33`);
    $('gauge-text').textContent = w.toFixed(0);
    $('wind-measured').textContent = `${p.windSpeed.toFixed(1)} kt`;
    $('wind-predicted').textContent = p.windSpeedPredict > 0 ? `${p.windSpeedPredict.toFixed(1)} kt` : '— kt';

    $('val-lat').textContent = `${p.latitude.toFixed(5)}°N`;
    $('val-lon').textContent = `${p.longitude.toFixed(5)}°E`;
    $('direction-text').textContent = p.direction;
    $('compass-arrow').style.transform = `rotate(${DIR_DEG[p.direction] || 0}deg)`;

    if (idx > 0) {
        const prev = stormPath[idx - 1], dist = haversine(prev.latitude, prev.longitude, p.latitude, p.longitude);
        const dt = (new Date(p.time) - new Date(prev.time)) / 3600000;
        const spd = dt > 0 ? dist / dt : 0;
        $('val-move-speed').textContent = `${spd.toFixed(1)} km/h`;
        $('stat-move-speed').textContent = `${spd.toFixed(1)} km/h`;
    } else {
        $('val-move-speed').textContent = '— km/h';
        $('stat-move-speed').textContent = '— km/h';
    }

    $('class-en').textContent = p.typeEN;
    $('class-th').textContent = p.type;
    $('class-dot').style.background = col.fill;
    $('class-dot').style.boxShadow = `0 0 10px ${col.glow}`;
    $('class-row').style.borderLeftColor = col.fill;
    $('val-datatype').innerHTML = p.isPredictData ? '<span class="tag tag-predicted">Predicted</span>' : '<span class="tag tag-historical">Historical</span>';
    $('val-area').textContent = `${(p.area / 1000).toFixed(1)} km`;
    $('val-predict-radius').textContent = p.predictRadius > 0 ? `${p.predictRadius.toFixed(1)} km` : '0.0 km';
    $('val-strong-wind').textContent = p.strongWindRadius > 0 ? `${p.strongWindRadius.toFixed(1)} km` : '0.0 km';

    $('point-current').textContent = idx + 1;
    const progress = ((idx + 1) / stormPath.length) * 100;
    $('point-progress').style.width = `${progress}%`;
    $('time-slider').value = idx;
    $('slider-label-current').textContent = getPrimaryDateTime(p);
    $('slider-track-bg').innerHTML = `<div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#00e5ff,#ffd740,#ff3b30);border-radius:3px;transition:width 0.15s ease;"></div>`;

    highlightLayers.clearLayers();
    L.circleMarker([p.latitude, p.longitude], { radius: 20, color: col.fill, weight: 1, fillColor: col.fill, fillOpacity: 0.06, opacity: 0.2 }).addTo(highlightLayers);
    L.circleMarker([p.latitude, p.longitude], { radius: 12, color: '#ffffff', weight: 2.5, fillColor: col.fill, fillOpacity: 0.3, opacity: 0.8 }).addTo(highlightLayers);

    highlightChartPoint(idx);
    map.panTo([p.latitude, p.longitude], { animate: true, duration: 0.3 });
}

// ══════ WIND CHART ══════
let chartCtx, chartCanvas;
function drawWindChart() {
    chartCanvas = $('wind-chart');
    chartCtx = chartCanvas.getContext('2d');
    const rect = chartCanvas.getBoundingClientRect();
    chartCanvas.width = rect.width * 2; chartCanvas.height = rect.height * 2;
    chartCtx.setTransform(1, 0, 0, 1, 0, 0);
    chartCtx.scale(2, 2);
    renderChart(-1);
}

function renderChart(hlIdx) {
    const ctx = chartCtx, w = chartCanvas.width / 2, h = chartCanvas.height / 2;
    ctx.clearRect(0, 0, w, h);
    if (!stormPath.length) return;
    const pad = { top: 8, bottom: 14, left: 28, right: 8 }, pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;

    const winds = stormPath.map(p => getWind(p)), maxW = Math.max(...winds, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (ph / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pw, y); ctx.stroke();
    }
    ctx.fillStyle = '#5a6a80'; ctx.font = '7px Inter'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText(Math.round(maxW - (maxW / 4) * i), pad.left - 3, pad.top + (ph / 4) * i + 3);

    for (let i = 1; i < stormPath.length; i++) {
        const x0 = pad.left + ((i - 1) / (stormPath.length - 1)) * pw, y0 = pad.top + ph - (getWind(stormPath[i-1]) / maxW) * ph;
        const x1 = pad.left + (i / (stormPath.length - 1)) * pw, y1 = pad.top + ph - (getWind(stormPath[i]) / maxW) * ph;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = getColor(stormPath[i].typeEN).fill; ctx.lineWidth = 1.5; ctx.stroke();
    }

    ctx.beginPath();
    stormPath.forEach((p, i) => {
        const x = pad.left + (i / (stormPath.length - 1)) * pw, y = pad.top + ph - (getWind(p) / maxW) * ph;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + pw, pad.top + ph); ctx.lineTo(pad.left, pad.top + ph); ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
    grad.addColorStop(0, 'rgba(255, 215, 64, 0.1)'); grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = grad; ctx.fill();

    stormPath.forEach((p, i) => {
        const x = pad.left + (i / (stormPath.length - 1)) * pw, y = pad.top + ph - (getWind(p) / maxW) * ph;
        ctx.beginPath(); ctx.arc(x, y, i === hlIdx ? 4 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = p.isPredictData ? '#69f0ae' : getColor(p.typeEN).fill; ctx.fill();
        if (i === hlIdx) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    });
}

function highlightChartPoint(idx) { renderChart(idx); }

// ══════ EVENTS ══════
function bindEvents() {
    $('time-slider').addEventListener('input', e => updateDisplay(parseInt(e.target.value)));
    $('btn-play').addEventListener('click', togglePlay);
    $('btn-prev').addEventListener('click', () => { if (currentIdx > 0) updateDisplay(currentIdx - 1); });
    $('btn-next').addEventListener('click', () => { if (currentIdx < stormPath.length - 1) updateDisplay(currentIdx + 1); });
    $('btn-start').addEventListener('click', () => updateDisplay(0));
    $('btn-end').addEventListener('click', () => updateDisplay(stormPath.length - 1));
    $('mode-local').addEventListener('click', () => setTimeMode('local'));
    $('mode-utc').addEventListener('click', () => setTimeMode('utc'));

    $('btn-toggle-radius').addEventListener('click', toggleRadius);
    $('btn-toggle-labels').addEventListener('click', toggleLabelsBtn);
    $('btn-toggle-wind-circles').addEventListener('click', toggleWindCircles);

    $('storm-select').addEventListener('change', e => {
        stopPlayback();
        loadStorm(e.target.value);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' && currentIdx < stormPath.length - 1) updateDisplay(currentIdx + 1);
        if (e.key === 'ArrowLeft' && currentIdx > 0) updateDisplay(currentIdx - 1);
        if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });

    // Mobile: sidebar drawer toggle
    $('btn-sidebar-toggle').addEventListener('click', toggleMobileSidebar);
    $('sidebar-backdrop').addEventListener('click', closeMobileSidebar);

    // Mobile: legend/stats panels toggle
    $('btn-panels-toggle').addEventListener('click', toggleMobilePanels);
}

function toggleRadius() {
    showRadius = !showRadius;
    $('btn-toggle-radius').classList.toggle('active', showRadius);
    showRadius ? radiusLayers.addTo(map) : map.removeLayer(radiusLayers);
}
function toggleLabelsBtn() {
    showLabels = !showLabels;
    $('btn-toggle-labels').classList.toggle('active', showLabels);
    drawMarkers();
    if (stormPath.length) updateDisplay(currentIdx);
}
function toggleWindCircles() {
    showWindCircles = !showWindCircles;
    $('btn-toggle-wind-circles').classList.toggle('active', showWindCircles);
    drawAll();
    if (stormPath.length) updateDisplay(currentIdx);
}

function togglePlay() {
    if (!stormPath.length) return;
    isPlaying = !isPlaying;
    $('btn-play').textContent = isPlaying ? '⏸' : '▶';
    $('btn-play').classList.toggle('playing', isPlaying);
    if (isPlaying) {
        const speed = parseInt($('speed-select').value);
        playInterval = setInterval(() => {
            if (currentIdx < stormPath.length - 1) updateDisplay(currentIdx + 1);
            else stopPlayback();
        }, speed);
    } else clearInterval(playInterval);
}

// ══════ MOBILE TOGGLES ══════
function toggleMobileSidebar() {
    const sidebar = $('sidebar');
    const btn = $('btn-sidebar-toggle');
    const backdrop = $('sidebar-backdrop');
    const isOpen = sidebar.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
    backdrop.classList.toggle('visible', isOpen);
    setTimeout(() => map.invalidateSize(), 350);
}

function closeMobileSidebar() {
    $('sidebar').classList.remove('open');
    $('btn-sidebar-toggle').classList.remove('active');
    $('sidebar-backdrop').classList.remove('visible');
    setTimeout(() => map.invalidateSize(), 350);
}

function toggleMobilePanels() {
    $('legend-panel').classList.toggle('mob-visible');
    $('stats-panel').classList.toggle('mob-visible');
}

document.addEventListener('DOMContentLoaded', init);
