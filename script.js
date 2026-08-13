(function(){

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let unit = 'c'; // 'c' | 'f'
  let lastData = null; // cache last fetch so unit toggle re-renders without refetch
  let lastPlace = null;
  let searchDebounce = null;
  let activeSuggestionIndex = -1;

  const elMain = document.getElementById('main');
  const elSearchInput = document.getElementById('searchInput');
  const elSuggestions = document.getElementById('suggestions');
  const elLocateBtn = document.getElementById('locateBtn');

  // ---------------------------------------------------------------
  // Weather code -> { label, group }
  // ---------------------------------------------------------------
  const WEATHER_CODES = {
    0:  ['Clear sky', 'clear'],
    1:  ['Mostly clear', 'clear'],
    2:  ['Partly cloudy', 'cloudy'],
    3:  ['Overcast', 'cloudy'],
    45: ['Fog', 'fog'],
    48: ['Icy fog', 'fog'],
    51: ['Light drizzle', 'rain'],
    53: ['Drizzle', 'rain'],
    55: ['Dense drizzle', 'rain'],
    56: ['Freezing drizzle', 'rain'],
    57: ['Freezing drizzle', 'rain'],
    61: ['Light rain', 'rain'],
    63: ['Rain', 'rain'],
    65: ['Heavy rain', 'rain'],
    66: ['Freezing rain', 'rain'],
    67: ['Freezing rain', 'rain'],
    71: ['Light snow', 'snow'],
    73: ['Snow', 'snow'],
    75: ['Heavy snow', 'snow'],
    77: ['Snow grains', 'snow'],
    80: ['Light showers', 'rain'],
    81: ['Showers', 'rain'],
    82: ['Violent showers', 'rain'],
    85: ['Snow showers', 'snow'],
    86: ['Heavy snow showers', 'snow'],
    95: ['Thunderstorm', 'storm'],
    96: ['Thunderstorm, hail', 'storm'],
    99: ['Thunderstorm, hail', 'storm'],
  };

  function weatherInfo(code){
    return WEATHER_CODES[code] || ['Unknown', 'cloudy'];
  }

  function iconIdFor(group, isDay){
    if(group === 'clear') return isDay ? 'ic-sun' : 'ic-moon';
    if(group === 'cloudy') return 'ic-cloud';
    if(group === 'fog') return 'ic-fog';
    if(group === 'rain') return 'ic-rain';
    if(group === 'snow') return 'ic-snow';
    if(group === 'storm') return 'ic-storm';
    return 'ic-cloud';
  }

  function skyKey(group, isDay){
    if(group === 'clear') return isDay ? 'clear-day' : 'clear-night';
    if(group === 'cloudy') return isDay ? 'cloudy-day' : 'cloudy-night';
    return group; // fog | rain | snow | storm share day/night
  }

  const SKY_PALETTES = {
    'clear-day':    ['#5B86C9', '#F7D488', '#C9933F'],
    'clear-night':  ['#0E1320', '#1B2438', '#2E3B57'],
    'cloudy-day':   ['#7C8A9C', '#9AA7B5', '#5E6B7A'],
    'cloudy-night': ['#1B2027', '#2A323D', '#3A4350'],
    'rain':         ['#2B3A4A', '#3E5266', '#1B252F'],
    'snow':         ['#B9C9D6', '#E8EEF2', '#8FA3B5'],
    'storm':        ['#221B33', '#3A2B4D', '#15101F'],
    'fog':          ['#8C8676', '#B5AE9C', '#6E695C'],
  };

  // ---------------------------------------------------------------
  // Unit helpers
  // ---------------------------------------------------------------
  function cToF(c){ return c * 9/5 + 32; }
  function fmtTemp(c){
    const v = unit === 'c' ? c : cToF(c);
    return Math.round(v);
  }

  // ---------------------------------------------------------------
  // Geocoding search
  // ---------------------------------------------------------------
  async function searchPlaces(query){
    if(!query || query.trim().length < 2){
      hideSuggestions();
      return;
    }
    try{
      const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(query.trim()) + '&count=6&language=en&format=json';
      const res = await fetch(url);
      const data = await res.json();
      renderSuggestions(data.results || []);
    }catch(err){
      hideSuggestions();
    }
  }

  function renderSuggestions(results){
    if(!results.length){
      hideSuggestions();
      return;
    }
    elSuggestions.innerHTML = results.map((r, i) => {
      const parts = [r.admin1, r.country].filter(Boolean).join(', ');
      return '<div class="suggestion" data-index="' + i + '" role="option">' +
        '<div>' + escapeHtml(r.name) + '</div>' +
        '<div class="place-country mono">' + escapeHtml(parts) + '</div>' +
      '</div>';
    }).join('');
    elSuggestions.classList.add('show');
    activeSuggestionIndex = -1;

    Array.from(elSuggestions.querySelectorAll('.suggestion')).forEach((node, i) => {
      node.addEventListener('click', () => {
        const r = results[i];
        elSearchInput.value = r.name;
        hideSuggestions();
        loadWeather({
          name: r.name,
          admin1: r.admin1,
          country: r.country,
          latitude: r.latitude,
          longitude: r.longitude,
        });
      });
    });

    elSuggestions._results = results;
  }

  function hideSuggestions(){
    elSuggestions.classList.remove('show');
    elSuggestions.innerHTML = '';
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  elSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const v = e.target.value;
    searchDebounce = setTimeout(() => searchPlaces(v), 280);
  });

  elSearchInput.addEventListener('keydown', (e) => {
    const items = Array.from(elSuggestions.querySelectorAll('.suggestion'));
    if(!items.length) return;
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
      updateActiveSuggestion(items);
    }else if(e.key === 'ArrowUp'){
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      updateActiveSuggestion(items);
    }else if(e.key === 'Enter'){
      if(activeSuggestionIndex >= 0 && items[activeSuggestionIndex]){
        items[activeSuggestionIndex].click();
      }
    }else if(e.key === 'Escape'){
      hideSuggestions();
    }
  });

  function updateActiveSuggestion(items){
    items.forEach(it => it.classList.remove('active'));
    if(items[activeSuggestionIndex]) items[activeSuggestionIndex].classList.add('active');
  }

  document.addEventListener('click', (e) => {
    if(!elSuggestions.contains(e.target) && e.target !== elSearchInput){
      hideSuggestions();
    }
  });

  // ---------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------
  elLocateBtn.addEventListener('click', () => {
    if(!navigator.geolocation){
      showStatus('No reading.', 'This browser cannot report a location.');
      return;
    }
    showStatus('Reading instruments…', 'Locating your position.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        loadWeather({
          name: 'Current location',
          admin1: '',
          country: '',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        showStatus('No reading.', 'Location permission was denied. Try searching a city instead.');
      },
      { timeout: 8000 }
    );
  });

  // ---------------------------------------------------------------
  // Fetch + render weather
  // ---------------------------------------------------------------
  async function loadWeather(place){
    lastPlace = place;
    showStatus('Reading instruments…', 'Fetching current conditions for ' + place.name + '.');

    const params = new URLSearchParams({
      latitude: place.latitude,
      longitude: place.longitude,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,pressure_msl,wind_speed_10m',
      hourly: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max',
      timezone: 'auto',
      forecast_days: '8',
    });

    try{
      const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString());
      if(!res.ok) throw new Error('bad response');
      const data = await res.json();
      lastData = data;
      renderWeather(place, data);
    }catch(err){
      showStatus('No reading.', 'Could not reach the forecast service. Check your connection and try again.');
    }
  }

  function showStatus(title, body){
    elMain.innerHTML =
      '<div class="status-msg fade-in"><span class="mono">' + escapeHtml(title) + '</span>' +
      escapeHtml(body) + '</div>';
  }

  function gaugeSvg(pct){
    pct = Math.max(0, Math.min(100, pct));
    return '<svg viewBox="0 0 100 56">' +
      '<path class="gauge-track" pathLength="100" d="M8,50 A42,42 0 0 1 92,50"></path>' +
      '<path class="gauge-fill" pathLength="100" stroke-dasharray="' + pct + ' 100" d="M8,50 A42,42 0 0 1 92,50"></path>' +
      '</svg>';
  }

  function renderWeather(place, data){
    const cur = data.current;
    const [condLabel, group] = weatherInfo(cur.weather_code);
    const isDay = cur.is_day === 1;
    const sky = skyKey(group, isDay);
    const iconId = iconIdFor(group, isDay);

    // ---- set sky gradient ----
    const pal = SKY_PALETTES[sky] || SKY_PALETTES['clear-day'];
    document.documentElement.style.setProperty('--sky-1', pal[0]);
    document.documentElement.style.setProperty('--sky-2', pal[1]);
    document.documentElement.style.setProperty('--sky-3', pal[2]);

    const placeLabel = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const coords = Math.abs(place.latitude).toFixed(2) + (place.latitude >= 0 ? '°N' : '°S') +
      ' · ' + Math.abs(place.longitude).toFixed(2) + (place.longitude >= 0 ? '°E' : '°W');

    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short' }).toUpperCase();
    const timeStr = now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });

    // ---- gauges ----
    const humidity = cur.relative_humidity_2m;
    const wind = cur.wind_speed_10m;
    const pressure = cur.pressure_msl;
    const uv = (data.daily.uv_index_max && data.daily.uv_index_max[0] != null) ? data.daily.uv_index_max[0] : null;

    const windPct = Math.min(100, (wind / 60) * 100);
    const pressurePct = Math.min(100, Math.max(0, ((pressure - 980) / (1040 - 980)) * 100));
    const uvPct = uv != null ? Math.min(100, (uv / 11) * 100) : 0;

    // ---- hourly: next 24h from now ----
    const nowIso = new Date().toISOString().slice(0,13);
    let startIdx = data.hourly.time.findIndex(t => t.slice(0,13) >= nowIso);
    if(startIdx < 0) startIdx = 0;
    const hourly = [];
    for(let i = startIdx; i < Math.min(startIdx + 12, data.hourly.time.length); i++){
      hourly.push({
        time: data.hourly.time[i],
        temp: data.hourly.temperature_2m[i],
        code: data.hourly.weather_code[i],
      });
    }

    // ---- daily: 7 days, compute week min/max for the range bars ----
    const dailyTimes = data.daily.time.slice(0,7);
    const dMax = data.daily.temperature_2m_max.slice(0,7);
    const dMin = data.daily.temperature_2m_min.slice(0,7);
    const dCode = data.daily.weather_code.slice(0,7);
    const weekMin = Math.min(...dMin);
    const weekMax = Math.max(...dMax);
    const weekSpan = Math.max(1, weekMax - weekMin);

    const html = `
      <div class="hero fade-in" data-sky="${sky}">
        <div class="hero-content">
          <div class="hero-top">
            <span class="mono">${dateStr} — ${timeStr} LOCAL</span>
            <div class="unit-toggle" id="unitToggle">
              <button data-unit="c" class="${unit==='c'?'active':''}">°C</button>
              <button data-unit="f" class="${unit==='f'?'active':''}">°F</button>
            </div>
          </div>
          <div class="hero-main">
            <div class="hero-location">
              <h1 class="serif">${escapeHtml(placeLabel)}</h1>
              <div class="hero-coords mono">${coords}</div>
              <div class="hero-condition">${escapeHtml(condLabel)}</div>
              <div class="hero-feelslike mono">Feels like ${fmtTemp(cur.apparent_temperature)}°</div>
            </div>
            <div class="hero-readout">
              <svg class="hero-icon" style="color:var(--paper)"><use href="#${iconId}"></use></svg>
              <div class="hero-temp serif">${fmtTemp(cur.temperature_2m)}<sup>°</sup></div>
            </div>
          </div>
        </div>
      </div>

      <div class="gauges">
        <div class="gauge-card">
          ${gaugeSvg(humidity)}
          <div class="gauge-value mono">${humidity}%</div>
          <div class="gauge-label">Humidity</div>
        </div>
        <div class="gauge-card">
          ${gaugeSvg(windPct)}
          <div class="gauge-value mono">${Math.round(wind)}</div>
          <div class="gauge-label">Wind km/h</div>
        </div>
        <div class="gauge-card">
          ${gaugeSvg(pressurePct)}
          <div class="gauge-value mono">${Math.round(pressure)}</div>
          <div class="gauge-label">Pressure hPa</div>
        </div>
        <div class="gauge-card">
          ${gaugeSvg(uvPct)}
          <div class="gauge-value mono">${uv != null ? uv.toFixed(1) : '—'}</div>
          <div class="gauge-label">UV Index</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Next hours</div>
        <div class="hourly-scroll">
          ${hourly.map(h => {
            const [, hg] = weatherInfo(h.code);
            const hIcon = iconIdFor(hg, true);
            const t = new Date(h.time);
            const label = t.toLocaleTimeString(undefined, { hour: 'numeric' });
            return `<div class="hour-card">
              <div class="hour-time mono">${label}</div>
              <svg class="hour-icon" style="color:var(--brass-bright)"><use href="#${hIcon}"></use></svg>
              <div class="hour-temp">${fmtTemp(h.temp)}°</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">7-day outlook</div>
        <div class="daily-list">
          ${dailyTimes.map((t, i) => {
            const [label, g] = weatherInfo(dCode[i]);
            const icon = iconIdFor(g, true);
            const d = new Date(t + 'T00:00:00');
            const dayName = i === 0 ? 'TODAY' : d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
            const leftPct = ((dMin[i] - weekMin) / weekSpan) * 100;
            const widthPct = ((dMax[i] - dMin[i]) / weekSpan) * 100;
            return `<div class="day-row">
              <div class="day-name mono">${dayName}</div>
              <svg class="day-icon" style="color:var(--brass-bright)"><use href="#${icon}"></use></svg>
              <div class="day-condition">${escapeHtml(label)}</div>
              <div class="day-range">
                <span class="day-min">${fmtTemp(dMin[i])}°</span>
                <div class="range-bar"><div class="range-bar-fill" style="left:${leftPct}%; width:${Math.max(6,widthPct)}%"></div></div>
                <span class="day-max">${fmtTemp(dMax[i])}°</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    elMain.innerHTML = html;

    document.getElementById('unitToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if(!btn) return;
      unit = btn.dataset.unit;
      if(lastData && lastPlace) renderWeather(lastPlace, lastData);
    });
  }

  // ---------------------------------------------------------------
  // Initial load — defaults to Bhubaneswar, India
  // ---------------------------------------------------------------
  loadWeather({
    name: 'Bhubaneswar',
    admin1: 'Odisha',
    country: 'India',
    latitude: 20.2961,
    longitude: 85.8245,
  });

})();
