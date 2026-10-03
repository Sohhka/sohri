/* ---------- Météo & heure ----------
   En haut, l'heure au Japon et en France (calculée par le téléphone, sans Internet : voir
   converter.js). En dessous, la météo de la semaine en cours (lundi → dimanche, la semaine suivante
   s'affiche le lundi) dans une ville au choix, Tokyo au départ. Elle vient d'Open-Meteo (gratuit,
   sans compte ni clé), est gardée sur le téléphone (consultable hors connexion) et mise à jour dès
   qu'il y a Internet : au lancement, au retour dans l'appli, au retour du réseau (même une minute
   suffit), puis toutes les 30 minutes. */
var WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
var GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
var WEATHER_FRESH = 30 * 60000;        // pas de nouvelle demande avant
var WEATHER_FRESH_ONLINE = 5 * 60000;  // retour du réseau : on en profite
var WEATHER_NOW_VALID = 3 * 3600000;   // « maintenant » : seulement si la mesure est récente
var DEFAULT_CITY = { name: 'Tokyo', country: 'Japon', lat: 35.6895, lon: 139.6917, timezone: 'Asia/Tokyo' };
// Villes proposées sans Internet (la recherche, elle, en a besoin).
var WEATHER_CITIES = [
  ['Tokyo', 35.6895, 139.6917], ['Kyoto', 35.0116, 135.7681], ['Osaka', 34.6937, 135.5023],
  ['Nara', 34.6851, 135.8048], ['Hiroshima', 34.3853, 132.4553], ['Hakone', 35.2324, 139.1069],
  ['Nikko', 36.7199, 139.6982], ['Kamakura', 35.3192, 139.5467], ['Yokohama', 35.4437, 139.638],
  ['Nagoya', 35.1815, 136.9066], ['Kanazawa', 36.5613, 136.6562], ['Takayama', 36.1461, 137.2522],
  ['Sapporo', 43.0618, 141.3545], ['Fukuoka', 33.5902, 130.4017], ['Naha (Okinawa)', 26.2124, 127.6809]
].map(function (c) { return { name: c[0], country: 'Japon', lat: c[1], lon: c[2], timezone: 'Asia/Tokyo' }; }).concat([
  { name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris' }
]);

var weatherCity = DEFAULT_CITY;
var weatherData = null;     // dernière météo reçue (voir readWeather), gardée dans « settings »
var weatherLoading = null;  // demande en cours
var weatherFailures = 0;
var weatherRetryTimer = null;
var weatherShownDate = null; // jour affiché (le lundi, la semaine change)
var weatherShownHour = null; // heure affichée (bande « heure par heure »)

defineView('weather', {
  el: 'view-weather',
  section: 'weather',
  title: 'Météo & heure',
  enter: function () {
    startClock();
    renderWeather();
    refreshWeather();
  },
  exit: stopClock,
  actions: function () {
    return [{ icon: '📍', label: 'Changer de ville', onClick: chooseWeatherCity }];
  }
});

/* Temps (code WMO d'Open-Meteo) : icône et mots. */
function weatherLook(code, night) {
  if (code === 0) return night ? ['🌙', 'Ciel dégagé'] : ['☀️', 'Ensoleillé'];
  if (code === 1) return night ? ['🌙', 'Peu nuageux'] : ['🌤️', 'Plutôt ensoleillé'];
  if (code === 2) return ['⛅', 'Partiellement nuageux'];
  if (code === 3) return ['☁️', 'Couvert'];
  if (code === 45 || code === 48) return ['🌫️', 'Brouillard'];
  if (code >= 51 && code <= 55) return ['🌦️', 'Bruine'];
  if (code === 56 || code === 57 || code === 66 || code === 67) return ['🌧️', 'Pluie verglaçante'];
  if (code === 61) return ['🌧️', 'Pluie faible'];
  if (code === 63) return ['🌧️', 'Pluie'];
  if (code === 65) return ['🌧️', 'Forte pluie'];
  if (code === 71 || code === 73 || code === 75 || code === 77) return ['🌨️', 'Neige'];
  if (code >= 80 && code <= 82) return ['🌦️', 'Averses'];
  if (code === 85 || code === 86) return ['🌨️', 'Averses de neige'];
  if (code === 95) return ['⛈️', 'Orage'];
  if (code === 96 || code === 99) return ['⛈️', 'Orage et grêle'];
  return ['🌡️', 'Temps inconnu'];
}

function sameCity(a, b) {
  return !!a && !!b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

/* ---------- La semaine dans le fuseau de la ville ---------- */
function cityOffset(now) {
  var fallbackMinutes = weatherData && sameCity(weatherData.city, weatherCity) ? weatherData.offset / 60 : 0;
  return zoneOffset(now, weatherCity.timezone || 'UTC', function () { return fallbackMinutes; });
}
function isoDay(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
/* Du lundi au dimanche de la semaine en cours là-bas : dates lues en « UTC » (voir zoneWall). */
function currentWeek(now) {
  var local = zoneWall(now, cityOffset(now));
  var fromMonday = (local.getUTCDay() + 6) % 7;
  var monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - fromMonday);
  var days = [];
  for (var i = 0; i < 7; i++) days.push(new Date(monday + i * 86400000));
  return { today: isoDay(local), days: days };
}

function weekIsComplete(data, week) {
  if (!data || !sameCity(data.city, weatherCity)) return false;
  var have = {};
  data.days.forEach(function (d) { have[d.date] = true; });
  return week.days.every(function (d) { return have[isoDay(d)]; });
}

/* ---------- Réception ---------- */
function weatherUrl(city) {
  return WEATHER_API + '?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
    '&timezone=auto&past_days=6&forecast_days=7';
}

function readWeather(json, city) {
  var daily = json.daily || {};
  var hourly = json.hourly || {};
  var current = json.current || null;
  var offset = json.utc_offset_seconds || 0;
  // Heure par heure : à partir d'aujourd'hui là-bas (heures locales « 2026-10-03T14:00 »).
  var today = isoDay(new Date(Date.now() + offset * 1000));
  var at = function (list, i) { return list ? list[i] : null; };
  return {
    city: city,
    fetchedAt: Date.now(),
    offset: offset,
    timezone: json.timezone || city.timezone,
    current: current && {
      temp: current.temperature_2m, feels: current.apparent_temperature,
      code: current.weather_code, night: current.is_day === 0
    },
    days: (daily.time || []).map(function (date, i) {
      return {
        date: date, code: daily.weather_code[i],
        max: daily.temperature_2m_max[i], min: daily.temperature_2m_min[i],
        rain: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null
      };
    }),
    hours: (hourly.time || []).map(function (time, i) {
      return {
        time: time, temp: at(hourly.temperature_2m, i), rain: at(hourly.precipitation_probability, i),
        code: at(hourly.weather_code, i), night: at(hourly.is_day, i) === 0
      };
    }).filter(function (hour) { return hour.time.slice(0, 10) >= today; })
  };
}

/* Les prochaines heures là-bas, à partir de l'heure en cours (24 au plus). */
var WEATHER_HOURS = 24;
function nextHours(data, now) {
  var local = zoneWall(now, cityOffset(now));
  var current = isoDay(local) + 'T' + pad2(local.getUTCHours()) + ':00';
  return (data.hours || []).filter(function (hour) { return hour.time >= current; }).slice(0, WEATHER_HOURS);
}

/* maxAge : pas de nouvelle demande si la météo gardée est plus récente (sauf semaine incomplète). */
function refreshWeather(maxAge) {
  if (weatherLoading) return weatherLoading;
  if (navigator.onLine === false) return Promise.resolve();
  var city = weatherCity;
  var fresh = weatherData && sameCity(weatherData.city, city) && Date.now() - weatherData.fetchedAt < (maxAge === undefined ? WEATHER_FRESH : maxAge);
  if (fresh && weekIsComplete(weatherData, currentWeek(new Date()))) return Promise.resolve();
  clearTimeout(weatherRetryTimer);
  weatherLoading = fetchJson(weatherUrl(city)).then(function (json) {
    if (!sameCity(city, weatherCity)) return null; // ville changée entre-temps
    weatherData = readWeather(json, city);
    weatherFailures = 0;
    if (currentViewName() === 'schedule-day') refreshView(); // météo du jour dans le programme
    return dbPut('settings', { key: 'weather', value: weatherData });
  }).then(null, function (err) {
    // Réseau sans Internet (Wi-Fi d'hôtel pas encore ouvert...) : nouvel essai dans une minute.
    console.warn('Météo pas encore reçue', err);
    if (++weatherFailures <= 5) weatherRetryTimer = setTimeout(function () { refreshWeather(0); }, 60000);
  }).then(function () {
    weatherLoading = null;
    renderWeatherIfShown();
  });
  renderWeatherIfShown(); // « mise à jour… »
  return weatherLoading;
}

function loadWeather() {
  return Promise.all([dbGet('settings', 'weatherCity'), dbGet('settings', 'weather')]).then(function (r) {
    if (r[0] && r[0].value) weatherCity = r[0].value;
    if (r[1] && r[1].value) weatherData = r[1].value;
    renderWeatherIfShown();
  })['catch'](function (err) { console.error(err); });
}

/* ---------- Choix de la ville ---------- */
function chooseWeatherCity() {
  var items = WEATHER_CITIES.map(function (city) {
    return { icon: city.country === 'Japon' ? '🗾' : '🇫🇷', label: city.name, sub: city.country, value: city, selected: sameCity(city, weatherCity) };
  });
  return pickFromList('Météo : quelle ville ?', items, { search: true, createLabel: 'Autre ville… (avec Internet)' }).then(function (choice) {
    if (!choice) return null;
    if (choice.create) return searchWeatherCity();
    return setWeatherCity(choice.value);
  });
}

function searchWeatherCity() {
  if (navigator.onLine === false) {
    return uiAlert("Il faut Internet pour chercher une ville (celles de la liste marchent sans).");
  }
  return uiPrompt('Chercher une ville', { placeholder: 'Ex. : Kyoto, Lyon, Séoul…', okLabel: 'Chercher' }).then(function (answer) {
    if (!answer || !answer.value) return null;
    return fetchJson(GEOCODING_API + '?count=10&language=fr&format=json&name=' + encodeURIComponent(answer.value)).then(function (json) {
      var results = (json && json.results) || [];
      if (!results.length) return uiAlert('Aucune ville trouvée pour « ' + answer.value + ' ».');
      return pickFromList('Quelle ville ?', results.map(function (r) {
        return {
          icon: '📍', label: r.name, sub: [r.admin1, r.country].filter(Boolean).join(', '),
          value: { name: r.name, country: r.country || '', lat: r.latitude, lon: r.longitude, timezone: r.timezone || 'UTC' }
        };
      })).then(function (choice) {
        return choice && choice.value ? setWeatherCity(choice.value) : null;
      });
    }, function () {
      return uiAlert('Recherche impossible pour le moment (connexion ?).');
    });
  });
}

function setWeatherCity(city) {
  weatherCity = city;
  weatherFailures = 0;
  return dbPut('settings', { key: 'weatherCity', value: city }).then(function () {
    renderWeatherIfShown();
    return refreshWeather(0);
  });
}

/* ---------- Affichage ---------- */
function renderWeatherIfShown() {
  if (currentViewName() === 'weather') renderWeather();
}

function temp(value) {
  return value === null || value === undefined ? '—' : Math.round(value) + '°';
}

function renderWeather() {
  var box = byId('weatherContent');
  var now = new Date();
  var week = currentWeek(now);
  weatherShownDate = week.today;
  weatherShownHour = zoneWall(now, cityOffset(now)).getUTCHours();
  var data = weatherData && sameCity(weatherData.city, weatherCity) ? weatherData : null;
  var byDate = {};
  if (data) data.days.forEach(function (d) { byDate[d.date] = d; });
  box.innerHTML = '';

  box.appendChild(h('div', { className: 'weather-head' }, [
    h('h2', { className: 'weather-city', text: 'Météo · ' + weatherCity.name }),
    h('button', { type: 'button', className: 'link-btn', text: 'Changer de ville', onclick: chooseWeatherCity })
  ]));

  // Maintenant (mesure récente), sinon la prévision du jour.
  var today = byDate[week.today];
  var nowFresh = data && data.current && now.getTime() - data.fetchedAt < WEATHER_NOW_VALID;
  if (nowFresh || today) {
    var look = nowFresh ? weatherLook(data.current.code, data.current.night) : weatherLook(today.code, false);
    box.appendChild(h('div', { className: 'weather-now' }, [
      h('span', { className: 'weather-now-icon', text: look[0] }),
      h('div', { className: 'weather-now-main' }, [
        h('p', { className: 'weather-now-temp', text: nowFresh ? temp(data.current.temp) : temp(today.max) + ' / ' + temp(today.min) }),
        h('p', { className: 'weather-now-text', text: look[1] + (nowFresh ? ' · ressenti ' + temp(data.current.feels) : ' · aujourd\'hui') })
      ]),
      today ? h('div', { className: 'weather-now-side' }, [
        nowFresh ? h('span', { text: '↑ ' + temp(today.max) + '  ↓ ' + temp(today.min) }) : null,
        today.rain !== null ? h('span', { text: '💧 ' + today.rain + ' %' }) : null
      ]) : null
    ]));
  }

  // Les prochaines heures (pluie, température), à faire défiler sur le côté.
  var hours = data ? nextHours(data, now) : [];
  if (hours.length) {
    box.appendChild(h('div', { className: 'weather-hours', role: 'list', 'aria-label': 'Météo des prochaines heures' }, hours.map(function (hour, i) {
      var look = weatherLook(hour.code, hour.night);
      var clock = parseInt(hour.time.slice(11, 13), 10);
      return h('div', { className: 'weather-hour' + (i === 0 ? ' is-now' : ''), role: 'listitem', title: look[1] }, [
        h('span', { className: 'weather-hour-time', text: clock === 0 && i > 0 ? 'Demain' : clock + ' h' }),
        h('span', { className: 'weather-hour-icon', text: look[0], 'aria-label': look[1] }),
        h('span', { className: 'weather-hour-temp', text: temp(hour.temp) }),
        h('span', { className: 'weather-hour-rain' + (hour.rain >= 50 ? ' is-likely' : ''), text: hour.rain !== null && hour.rain !== undefined ? '💧' + hour.rain + '%' : '' })
      ]);
    })));
  }

  // La semaine, du lundi au dimanche.
  box.appendChild(h('div', { className: 'weather-week', role: 'list', 'aria-label': 'Météo de la semaine' }, week.days.map(function (d) {
    var date = isoDay(d);
    var day = byDate[date];
    var look = day ? weatherLook(day.code, false) : ['·', ''];
    var state = date === week.today ? ' is-today' : date < week.today ? ' is-past' : '';
    return h('div', { className: 'weather-day' + state, role: 'listitem', title: look[1] }, [
      h('span', { className: 'weather-day-name', text: date === week.today ? 'Aujourd\'hui' : CLOCK_DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() }),
      h('span', { className: 'weather-day-icon', text: look[0], 'aria-label': look[1] }),
      h('span', { className: 'weather-day-rain', text: day && day.rain !== null ? '💧 ' + day.rain + ' %' : '' }),
      h('span', { className: 'weather-day-temps' }, day ? [temp(day.max) + ' ', h('span', { className: 'weather-min', text: temp(day.min) })] : ['—'])
    ]);
  })));

  box.appendChild(h('p', { className: 'footnote weather-status', text: weatherStatusText(data, week) }));
  box.appendChild(h('p', { className: 'footnote weather-credit', text: 'Météo : Open-Meteo.com' }));
}

function weatherStatusText(data, week) {
  if (weatherLoading) return '🔄 Mise à jour de la météo…';
  var offline = navigator.onLine === false;
  if (!data) {
    return offline ? 'Pas encore de météo pour ' + weatherCity.name + ' : elle arrivera toute seule dès que tu auras Internet, même un instant.'
      : 'Pas encore de météo pour ' + weatherCity.name + ' : nouvel essai dans un instant.';
  }
  var at = new Date(data.fetchedAt);
  var when = at.toDateString() === new Date().toDateString()
    ? 'aujourd\'hui à ' + pad2(at.getHours()) + ':' + pad2(at.getMinutes())
    : 'le ' + CLOCK_DAYS[at.getDay()] + ' ' + at.getDate() + ' ' + CLOCK_MONTHS[at.getMonth()] + ' à ' + pad2(at.getHours()) + ':' + pad2(at.getMinutes());
  var text = 'Mise à jour ' + when + '.';
  if (!weekIsComplete(data, week)) text += ' Prévisions de cette semaine à recevoir : elles arrivent dès que tu as Internet.';
  else if (offline) text += ' Hors connexion : elle se met à jour dès que tu as Internet.';
  return text;
}

/* ---------- Mises à jour ---------- */
// Nouveau jour (ou nouvelle semaine, le lundi) pendant que la page est affichée ; nouvelle heure :
// la bande « heure par heure » repart de l'heure en cours.
clockListeners.push(function (now) {
  if (currentViewName() !== 'weather') return;
  if (currentWeek(now).today !== weatherShownDate) {
    renderWeather();
    refreshWeather();
  } else if (zoneWall(now, cityOffset(now)).getUTCHours() !== weatherShownHour) {
    renderWeather();
  }
});
// Internet revient (même une minute) : la météo en profite aussitôt.
window.addEventListener('online', function () {
  weatherFailures = 0;
  refreshWeather(WEATHER_FRESH_ONLINE);
});
window.addEventListener('offline', renderWeatherIfShown);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') refreshWeather();
});
setInterval(function () {
  if (document.visibilityState === 'visible') refreshWeather();
}, 10 * 60000);

loadWeather().then(function () {
  setTimeout(function () { refreshWeather(); }, 1500); // après le démarrage de l'appli
});
