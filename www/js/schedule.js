/* ---------- Programme du voyage ----------
   Le voyage jour par jour : chaque étape (vol, train, hôtel, visite, repas…) a sa date, son heure
   (facultative, comme celle de fin), un lieu du carnet d'adresses, des notes (n° de réservation,
   quai…) et ses billets (pièces jointes). L'écran d'une journée (« Aujourd'hui » pendant le voyage)
   montre tout en grand : l'étape en cours et la suivante, l'itinéraire et l'adresse pour le taxi,
   les billets à ouvrir d'un toucher, la météo. Dates et heures sont celles du téléphone (qui passe
   à l'heure du Japon sur place). Magasin « schedule » : dans les sauvegardes, synchronisé entre mes
   appareils (sync.js) et partageable avec mes proches, en lecture seule (voir scheduleSource). */
var EVENT_TYPES = [
  { id: 'vol', icon: '✈️', label: 'Vol' },
  { id: 'train', icon: '🚄', label: 'Train' },
  { id: 'transport', icon: '🚇', label: 'Transport' },
  { id: 'hebergement', icon: '🏨', label: 'Hébergement' },
  { id: 'repas', icon: '🍜', label: 'Repas' },
  { id: 'visite', icon: '⛩️', label: 'Visite' },
  { id: 'activite', icon: '🎫', label: 'Activité' },
  { id: 'shopping', icon: '🛍️', label: 'Shopping' },
  { id: 'autre', icon: '📌', label: 'Autre' }
];
// Étape créée depuis la fiche d'un lieu : type deviné d'après sa catégorie.
var EVENT_TYPE_OF_PLACE = { hebergement: 'hebergement', restaurant: 'repas', visite: 'visite', shopping: 'shopping', transport: 'transport' };
var editingEvent = null;      // étape ouverte dans le formulaire (null : nouvelle)
var eventDraft = null;        // { type, addressId }
var currentEventFiles = [];   // ses pièces jointes
var eventFormSnapshot = '';
var eventEditorSession = 0;
var savingEvent = false;
var scheduleRenderId = 0;
var scheduleTimer = null;

function eventType(id) {
  return EVENT_TYPES.filter(function (t) { return t.id === id; })[0] || EVENT_TYPES[EVENT_TYPES.length - 1];
}

/* ---------- Jours (« AAAA-MM-JJ », heure du téléphone) et heures (« HH:MM ») ---------- */
function dayFromKey(key) {
  var p = key.split('-');
  return new Date(+p[0], p[1] - 1, +p[2], 12);
}
function shiftDay(key, days) {
  var d = dayFromKey(key);
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
}
function daysBetween(from, to) {
  return Math.round((dayFromKey(to) - dayFromKey(from)) / 86400000);
}
/* « Mardi 14 octobre » (avec l'année si ce n'est pas l'année en cours). */
function dayTitle(key) {
  var d = dayFromKey(key);
  var options = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  var text = d.toLocaleDateString('fr-FR', options);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function minutesOf(time) {
  var m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  return m ? +m[1] * 60 + +m[2] : null;
}
function nowMinutes() {
  var d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function eventTimeText(e) {
  if (!e.time) return 'Dans la journée';
  return e.endTime ? e.time + ' – ' + e.endTime : e.time;
}
function untilText(minutes) {
  if (minutes < 60) return 'dans ' + Math.max(1, minutes) + ' min';
  var rest = minutes % 60;
  return 'dans ' + Math.floor(minutes / 60) + ' h' + (rest ? ' ' + pad2(rest) : '');
}
/* Par jour, puis les étapes sans heure d'abord, puis par heure. */
function byEventTime(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  var ta = minutesOf(a.time);
  var tb = minutesOf(b.time);
  if (ta === null && tb !== null) return -1;
  if (tb === null && ta !== null) return 1;
  if (ta !== tb) return ta - tb;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

/* Aujourd'hui : l'étape en cours (la dernière commencée, sauf si elle est finie), la suivante, et
   celles passées. { status: { id : 'past' | 'now' | 'next' }, next, current, now }. */
function todayStatus(events) {
  var now = nowMinutes();
  var timed = events.filter(function (e) { return minutesOf(e.time) !== null; });
  var status = {};
  var current = null;
  var next = null;
  timed.forEach(function (e) {
    var start = minutesOf(e.time);
    if (start <= now) current = e;
    else if (!next) next = e;
  });
  if (current) {
    var start = minutesOf(current.time);
    var end = minutesOf(current.endTime);
    if (end !== null && end < start) end += 24 * 60; // fin après minuit
    if (end !== null && end <= now) current = null;
  }
  timed.forEach(function (e) {
    if (e === current) status[e.id] = 'now';
    else if (e === next) status[e.id] = 'next';
    else if (minutesOf(e.time) <= now) status[e.id] = 'past';
  });
  return { status: status, current: current, next: next, now: now };
}

/* Programme affiché : le mien (modifiable), ou celui d'un proche (lecture seule : voir
   sharedScheduleSource, sharing.js). load() : promesse de { events, addresses (par identifiant) }. */
function scheduleSource(owner) {
  if (owner) return window.sharedScheduleSource ? sharedScheduleSource(owner) : { readOnly: true, owner: owner, load: function () { return Promise.resolve({ events: [], addresses: {} }); } };
  return {
    readOnly: false,
    load: function () {
      return Promise.all([dbGetAll('schedule'), dbGetAll('addresses')]).then(function (r) {
        return { events: r[0], addresses: mapById(r[1]) };
      });
    },
    openAddress: function (address) { openView('address', { id: address.id }); }
  };
}

/* Les étapes réparties par jour : [{ date, events }]. */
function eventsByDay(events) {
  var days = [];
  events.forEach(function (e) {
    var last = days[days.length - 1];
    if (!last || last.date !== e.date) days.push(last = { date: e.date, events: [] });
    last.events.push(e);
  });
  return days;
}

/* Rafraîchit l'écran chaque minute (étape en cours, « dans 20 min ») tant qu'il est affiché. */
function startScheduleTimer() {
  stopScheduleTimer();
  scheduleTimer = setInterval(function () {
    var name = currentViewName();
    if ((name === 'schedule' || name === 'schedule-day') && document.visibilityState === 'visible') refreshView();
  }, 60000);
}
function stopScheduleTimer() {
  clearInterval(scheduleTimer);
  scheduleTimer = null;
}

/* ---------- Vue d'ensemble ---------- */
defineView('schedule', {
  el: 'view-schedule',
  section: 'schedule',
  title: 'Programme',
  enter: renderSchedule,
  exit: stopScheduleTimer,
  actions: function (params) {
    return params.owner ? [] : [{ icon: '+', label: 'Nouvelle étape', onClick: function () { openView('schedule-edit', {}); } }];
  }
});

function renderSchedule(params) {
  var renderId = ++scheduleRenderId;
  var source = scheduleSource(params.owner);
  startScheduleTimer();
  return source.load().then(function (model) {
    if (renderId !== scheduleRenderId) return;
    if (source.title) setViewTitle(source.title);
    var shared = byId('scheduleShared');
    shared.innerHTML = '';
    if (!params.owner && window.renderSharedSchedules) renderSharedSchedules(shared);
    var box = byId('scheduleContent');
    box.innerHTML = '';
    var events = model.events.slice().sort(byEventTime);
    showEmpty(byId('scheduleEmpty'), !events.length, params.owner
      ? 'Rien au programme pour l\'instant.'
      : 'Aucune étape pour l\'instant. Appuie sur + pour ajouter la première : vol, train, hôtel, visite…');
    if (!events.length) return;
    var first = events[0].date;
    var last = events[events.length - 1].date;
    var today = dayKey(Date.now());
    box.appendChild(tripCard(events, first, last, today, params.owner));
    eventsByDay(events).forEach(function (day) {
      var when = day.date === today ? ' is-today' : day.date < today ? ' is-past' : '';
      box.appendChild(h('button', {
        type: 'button', className: 'schedule-day-head' + when,
        onclick: function () { openView('schedule-day', { date: day.date, owner: params.owner }); }
      }, [
        h('span', { text: 'Jour ' + (daysBetween(first, day.date) + 1) + ' · ' + dayTitle(day.date) }),
        h('span', { className: 'row-chevron', text: '›' })
      ]));
      day.events.forEach(function (e) {
        box.appendChild(eventRow(e, model.addresses[e.addressId], when, function () {
          openView('schedule-day', { date: day.date, owner: params.owner, focus: e.id });
        }));
      });
    });
    // Pendant le voyage : la liste s'ouvre sur aujourd'hui.
    var todayHead = box.querySelector('.schedule-day-head.is-today');
    if (todayHead) byId('content').scrollTop = Math.max(0, todayHead.offsetTop - 12);
  });
}

function eventRow(e, address, when, onClick) {
  var files = (e.attachments || []).length;
  return h('div', { className: 'list-row schedule-row' + when, onclick: onClick }, [
    h('span', { className: 'schedule-time', text: e.time || '' }),
    h('span', { className: 'row-icon', text: eventType(e.type).icon }),
    h('div', { className: 'list-row-main' }, [
      h('p', { className: 'list-row-title', text: e.title }),
      address ? h('p', { className: 'list-row-address', text: address.title }) : null,
      files ? h('p', { className: 'list-row-sub', text: '📎 ' + plural(files, 'pièce jointe', 'pièces jointes') }) : null
    ])
  ]);
}

/* En haut : avant le départ, le compte à rebours ; pendant le voyage, l'étape en cours ou la
   suivante, et la journée d'un toucher ; après, un simple rappel. */
function tripCard(events, first, last, today, owner) {
  var total = daysBetween(first, last) + 1;
  var span = dayTitle(first) + (first !== last ? ' → ' + dayTitle(last) : '') + ' · ' + plural(total, 'jour', 'jours').replace(' ', ' ');
  if (today < first) {
    var wait = daysBetween(today, first);
    return h('div', { className: 'card trip-card' }, [
      h('p', { className: 'card-label', text: 'Le voyage' }),
      h('p', { className: 'trip-count', text: wait === 1 ? 'Départ demain !' : 'Départ dans ' + wait + ' jours' }),
      h('p', { className: 'trip-span', text: span })
    ]);
  }
  if (today > last) return h('p', { className: 'hint trip-done', text: 'Voyage terminé · ' + span });
  var st = todayStatus(events.filter(function (e) { return e.date === today; }));
  var line = st.current
    ? (st.current.endTime ? 'En cours : ' : 'Depuis ' + st.current.time + ' : ') + eventType(st.current.type).icon + ' ' + st.current.title
    : null;
  var nextLine = st.next
    ? 'À suivre ' + untilText(minutesOf(st.next.time) - st.now) + ' : ' + st.next.time + ' ' + eventType(st.next.type).icon + ' ' + st.next.title
    : null;
  return h('div', { className: 'card trip-card is-now' }, [
    h('p', { className: 'card-label', text: 'Aujourd\'hui · Jour ' + (daysBetween(first, today) + 1) + ' sur ' + total }),
    line ? h('p', { className: 'trip-next', text: line }) : null,
    nextLine ? h('p', { className: 'trip-next', text: nextLine }) : null,
    !line && !nextLine ? h('p', { className: 'trip-next', text: events.some(function (e) { return e.date === today; }) ? 'Plus rien de prévu aujourd\'hui.' : 'Rien de prévu aujourd\'hui.' }) : null,
    h('div', { className: 'card-actions trip-actions' }, [
      actionButton('📅', 'Voir la journée', function () { openView('schedule-day', { date: today, owner: owner }); })
    ])
  ]);
}

/* ---------- Une journée (« Aujourd'hui ») ---------- */
defineView('schedule-day', {
  el: 'view-schedule-day',
  section: 'schedule',
  title: function (params) { return params.date === dayKey(Date.now()) ? 'Aujourd\'hui' : 'Programme'; },
  enter: renderScheduleDay,
  exit: stopScheduleTimer,
  actions: function (params) {
    return params.owner ? [] : [{ icon: '+', label: 'Nouvelle étape ce jour-là', onClick: function () { openView('schedule-edit', { date: params.date }); } }];
  }
});

function renderScheduleDay(params) {
  var renderId = ++scheduleRenderId;
  var source = scheduleSource(params.owner);
  var shown = (params.owner || '') + '|' + (params.date || dayKey(Date.now()));
  // Autre jour que celui encore affiché : effacé tout de suite (pas l'ancien le temps de la lecture).
  if (byId('scheduleDay').dataset.shown !== shown) byId('scheduleDay').innerHTML = '';
  startScheduleTimer();
  return source.load().then(function (model) {
    if (renderId !== scheduleRenderId) return;
    var all = model.events.slice().sort(byEventTime);
    var today = dayKey(Date.now());
    var date = params.date || today;
    byId('scheduleDay').dataset.shown = shown;
    var events = all.filter(function (e) { return e.date === date; });
    var first = all.length && all[0].date < date ? all[0].date : date;
    var last = all.length && all[all.length - 1].date > date ? all[all.length - 1].date : date;
    var number = daysBetween(first, date) + 1;
    setViewTitle(date === today ? 'Aujourd\'hui' : 'Jour ' + number);
    var box = byId('scheduleDay');
    box.innerHTML = '';
    var go = function (days) {
      return function () { replaceView('schedule-day', { date: shiftDay(date, days), owner: params.owner }); };
    };
    box.appendChild(h('div', { className: 'day-nav' }, [
      h('button', { type: 'button', className: 'icon-btn day-nav-btn', 'aria-label': 'Jour précédent', text: '‹', disabled: date <= first, onclick: go(-1) }),
      h('div', { className: 'day-nav-main' }, [
        h('p', { className: 'day-nav-date', text: dayTitle(date) }),
        h('p', { className: 'day-nav-sub', text: (source.ownerName ? 'Programme de ' + source.ownerName + ' · ' : '') + 'Jour ' + number + ' sur ' + (daysBetween(first, last) + 1) })
      ]),
      h('button', { type: 'button', className: 'icon-btn day-nav-btn', 'aria-label': 'Jour suivant', text: '›', disabled: date >= last, onclick: go(1) })
    ]));
    var weather = dayWeatherLine(date);
    if (weather) box.appendChild(weather);
    if (!events.length) {
      box.appendChild(h('p', { className: 'empty', text: 'Rien de prévu ce jour-là.' }));
      return;
    }
    var st = date === today ? todayStatus(events) : null;
    events.forEach(function (e) { box.appendChild(eventCard(e, model.addresses[e.addressId], st, source)); });
    var focus = params.focus !== undefined ? box.querySelector('[data-event="' + String(params.focus).replace(/"/g, '') + '"]') : null;
    if (focus) byId('content').scrollTop = Math.max(0, focus.offsetTop - 12);
  });
}

/* Météo de ce jour-là dans la ville choisie (rubrique Météo), si elle est connue. */
function dayWeatherLine(date) {
  if (typeof weatherData === 'undefined' || !weatherData || !weatherData.days || !sameCity(weatherData.city, weatherCity)) return null;
  var day = weatherData.days.filter(function (d) { return d.date === date; })[0];
  if (!day) return null;
  var look = weatherLook(day.code, false);
  return h('button', { type: 'button', className: 'day-weather', onclick: function () { goToSection('weather'); } },
    look[0] + ' ' + weatherCity.name + ' : ' + temp(day.max) + ' / ' + temp(day.min) + (day.rain !== null && day.rain !== undefined ? ' · 💧 ' + day.rain + ' %' : ''));
}

function eventCard(e, address, st, source) {
  var type = eventType(e.type);
  var state = st ? st.status[e.id] : null;
  var badge = null;
  if (state === 'now' && e.endTime) badge = 'En cours';
  if (state === 'next') badge = 'À suivre · ' + untilText(minutesOf(e.time) - st.now);
  var card = h('div', { className: 'card event-card' + (state ? ' is-' + state : ''), dataset: { event: String(e.id) } }, [
    h('div', { className: 'event-head' }, [
      h('span', { className: 'event-time', text: eventTimeText(e) }),
      badge ? h('span', { className: 'chip event-badge', text: badge }) : null,
      source.readOnly ? null : h('button', {
        type: 'button', className: 'icon-btn event-edit', 'aria-label': 'Modifier l\'étape', title: 'Modifier', text: '✎',
        onclick: function () { openView('schedule-edit', { id: e.id }); }
      })
    ]),
    h('div', { className: 'event-title-row' }, [
      h('span', { className: 'event-icon', text: type.icon }),
      h('h3', { className: 'event-title', text: e.title })
    ])
  ]);
  if (address) card.appendChild(eventPlace(address, source));
  if (e.notes) {
    var notes = h('div', { className: 'markdown event-notes' });
    showMarkdown(notes, e.notes, source.readOnly ? null : function (index, checked) {
      e.notes = setTaskInMarkdown(e.notes, index, checked);
      e.updatedAt = Date.now();
      dbPut('schedule', e).catch(function (err) {
        console.error(err);
        uiAlert("La modification n'a pas pu être enregistrée.");
      });
    });
    card.appendChild(notes);
  }
  if ((e.attachments || []).length) card.appendChild(source.attachmentList ? source.attachmentList(e.attachments) : renderAttachmentList(e.attachments));
  return card;
}

/* Le lieu d'une étape : itinéraire, adresse pour le taxi, téléphone, fiche du carnet. */
function eventPlace(address, source) {
  var taxi = address.addressJa || address.address;
  return h('div', { className: 'event-place' }, [
    h('p', { className: 'event-place-name', text: categoryOf(address).icon + ' ' + address.title }),
    address.address ? h('p', { className: 'list-row-address', text: address.address }) : null,
    h('div', { className: 'card-actions' }, [
      address.address ? actionButton('🧭', 'Itinéraire', function () { openMaps(address.address); }) : null,
      taxi ? actionButton('🚕', 'Pour le taxi', function () { showTaxiCard(address.title, taxi); }) : null,
      address.phone ? actionButton('📞', 'Appeler', function () { openExternal(phoneUrl(address.phone)); }) : null,
      source.openAddress && (!source.canOpenAddress || source.canOpenAddress(address)) ? actionButton('📇', 'Fiche', function () { source.openAddress(address); }) : null
    ])
  ]);
}

/* ---------- Une étape : nouvelle ou modifiée ---------- */
defineView('schedule-edit', {
  el: 'view-schedule-edit',
  section: 'schedule',
  title: function (params) { return params.id ? 'Modifier l\'étape' : 'Nouvelle étape'; },
  enter: openEventEditor,
  exit: resetEventEditor,
  canLeave: function () { return confirmDiscard(isEventDirty(), 'Abandonner cette étape ?'); },
  actions: function () { return [{ text: 'Enregistrer', label: 'Enregistrer l\'étape', onClick: saveEvent }]; },
  toolbar: true
});

registerTextField(byId('eventTitle'));
registerMarkdownField(byId('eventNotes'));

function eventFormState() {
  if (!eventDraft) return '';
  return JSON.stringify([byId('eventTitle').value.trim(), byId('eventDate').value, byId('eventTime').value, byId('eventEnd').value,
    eventDraft.type, eventDraft.addressId, byId('eventNotes').value.trim()]);
}

function isEventDirty() {
  return eventFormState() !== eventFormSnapshot || !sameItems((editingEvent && editingEvent.attachments) || [], currentEventFiles);
}

function resetEventEditor() {
  eventEditorSession++;
  editingEvent = null;
  eventDraft = null;
  currentEventFiles = [];
  byId('eventAttachments').innerHTML = '';
}

/* Date proposée pour une nouvelle étape : celle de la dernière ajoutée (on prépare souvent le voyage
   dans l'ordre), sinon aujourd'hui. */
function proposedEventDate() {
  return dbGetAll('schedule').then(function (events) {
    var latest = events.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0) || b.id - a.id; })[0];
    return latest ? latest.date : dayKey(Date.now());
  });
}

function openEventEditor(params) {
  resetEventEditor();
  var session = eventEditorSession;
  ['eventTitle', 'eventDate', 'eventTime', 'eventEnd', 'eventNotes'].forEach(function (id) { byId(id).value = ''; });
  return Promise.all([
    params.id ? dbGet('schedule', params.id) : Promise.resolve(null),
    params.addressId ? dbGet('addresses', params.addressId) : Promise.resolve(null),
    params.id || params.date ? Promise.resolve(params.date || null) : proposedEventDate()
  ]).then(function (r) {
    if (session !== eventEditorSession) return;
    var event = r[0];
    if (params.id && !event) {
      uiAlert('Cette étape n\'existe plus.');
      goBack(true);
      return;
    }
    editingEvent = event;
    var place = r[1];
    eventDraft = event
      ? { type: event.type || 'autre', addressId: event.addressId || null }
      : { type: place ? EVENT_TYPE_OF_PLACE[place.category] || 'autre' : 'autre', addressId: place ? place.id : null };
    byId('eventTitle').value = event ? event.title || '' : place ? place.title : '';
    byId('eventDate').value = event ? event.date : r[2];
    byId('eventTime').value = event ? event.time || '' : '';
    byId('eventEnd').value = event ? event.endTime || '' : '';
    byId('eventNotes').value = event ? event.notes || '' : '';
    currentEventFiles = event && event.attachments ? event.attachments.slice() : [];
    renderAttachmentEditor(byId('eventAttachments'), currentEventFiles);
    byId('eventDeleteBtn').hidden = !event;
    renderEventTypes();
    return refreshEventAddressBtn().then(function () {
      if (session !== eventEditorSession) return;
      activeMarkdownField = byId('eventNotes');
      autoGrow(byId('eventNotes'));
      eventFormSnapshot = eventFormState();
      if (!event && !place) byId('eventTitle').focus();
    });
  });
}

function renderEventTypes() {
  var row = byId('eventTypes');
  row.innerHTML = '';
  EVENT_TYPES.forEach(function (t) {
    row.appendChild(h('button', {
      type: 'button', className: 'filter-chip', 'aria-pressed': t.id === eventDraft.type,
      onclick: function () {
        eventDraft.type = t.id;
        renderEventTypes();
      }
    }, t.icon + ' ' + t.label));
  });
}

function refreshEventAddressBtn() {
  var id = eventDraft && eventDraft.addressId;
  return (id ? dbGet('addresses', id) : Promise.resolve(null)).then(function (address) {
    if (id && !address && eventDraft) eventDraft.addressId = null; // lieu supprimé entre-temps
    byId('eventAddressBtn').textContent = address ? categoryOf(address).icon + ' ' + address.title : '📍 Aucun lieu';
  });
}

byId('eventAddressBtn').addEventListener('click', function () {
  if (!eventDraft) return;
  dbGetAll('addresses').then(function (addresses) {
    var items = [{ icon: '🚫', label: 'Aucun lieu', value: null, selected: !eventDraft.addressId }];
    addresses.sort(byTitle).forEach(function (a) {
      items.push({ icon: categoryOf(a).icon, label: a.title, sub: a.address, value: a.id, selected: a.id === eventDraft.addressId });
    });
    if (!addresses.length) items.push({ icon: '💡', label: 'Les lieux viennent du carnet d\'adresses', sub: 'Ajoute d\'abord l\'hôtel, le restaurant… dans « Carnet d\'adresses ».', value: null });
    return pickFromList('Lieu de l\'étape', items, { search: addresses.length > 6 });
  }).then(function (choice) {
    if (!choice || !eventDraft) return;
    eventDraft.addressId = choice.value;
    refreshEventAddressBtn();
  });
});

byId('addEventFilesBtn').addEventListener('click', function () {
  byId('eventFiles').click();
});

byId('eventFiles').addEventListener('change', function (e) {
  var files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  var session = eventEditorSession;
  var list = currentEventFiles;
  addAttachments(files, list, function () {
    if (session === eventEditorSession) renderAttachmentEditor(byId('eventAttachments'), list);
  });
});

/* Un billet déjà rangé dans Documents : copié dans l'étape. */
byId('eventFromDocsBtn').addEventListener('click', function () {
  var session = eventEditorSession;
  var list = currentEventFiles;
  Promise.all([dbGetAll('documents'), dbGetAll('folders')]).then(function (r) {
    if (!r[0].length) return uiAlert('Aucun fichier dans Documents pour l\'instant.');
    var folders = mapById(r[1]);
    var items = r[0].sort(byFileName).map(function (d) {
      var folder = folders[d.folderId];
      return { icon: fileIcon(d.type, d.name), label: d.name, sub: (folder ? folder.name + ' · ' : '') + formatSize(d.size || 0), value: d };
    });
    return pickFromList('Joindre un fichier de Documents', items, { search: items.length > 6 }).then(function (choice) {
      if (!choice || !choice.value) return;
      var doc = choice.value;
      if (doc.size > MAX_ATTACHMENT_SIZE) return uiAlert('Fichier trop volumineux (50 Mo maximum) : ' + doc.name);
      return loadDocument(doc).then(function (full) {
        if (session !== eventEditorSession) return;
        list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: full.name, type: full.type || full.blob.type, size: full.blob.size, blob: full.blob });
        renderAttachmentEditor(byId('eventAttachments'), list);
      });
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert('Le fichier n\'a pas pu être joint.');
  });
});

function saveEvent() {
  if (savingEvent || !eventDraft) return;
  var title = byId('eventTitle').value.trim();
  var date = byId('eventDate').value;
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    uiAlert('Indique au moins le nom de l\'étape et sa date.');
    return;
  }
  var time = byId('eventTime').value;
  var now = Date.now();
  var event = {
    title: title.slice(0, 100),
    date: date,
    time: time || '',
    endTime: time ? byId('eventEnd').value || '' : '',
    type: eventDraft.type,
    addressId: eventDraft.addressId || null,
    notes: byId('eventNotes').value.trim(),
    attachments: currentEventFiles.slice(),
    createdAt: (editingEvent && editingEvent.createdAt) || now,
    updatedAt: now
  };
  if (editingEvent) {
    event.id = editingEvent.id;
    keepSyncMarks(event, editingEvent);
  }
  var isNew = !editingEvent;
  savingEvent = true;
  dbPut('schedule', event).then(function () {
    eventFormSnapshot = eventFormState();
    showToast(isNew ? 'Étape ajoutée au programme' : 'Étape modifiée');
    if (navStack.length > 1) goBack(true);
    else goToSection('schedule');
  }, function (err) {
    console.error(err);
    uiAlert('L\'étape n\'a pas pu être enregistrée.');
  }).then(function () { savingEvent = false; });
}

byId('eventDeleteBtn').addEventListener('click', function () {
  var event = editingEvent;
  if (!event) return;
  uiConfirm('Supprimer « ' + event.title + ' » du programme ?', 'Supprimer', true).then(function (ok) {
    if (!ok) return;
    return dbDelete('schedule', event.id).then(function () {
      leaveAfterDelete('schedule');
      showToast('Étape supprimée');
    });
  }).catch(function (err) {
    console.error(err);
    uiAlert('L\'étape n\'a pas pu être supprimée.');
  });
});

/* Fiche d'une adresse : les étapes du programme qui s'y passent. */
function scheduleRowsForAddress(address, events) {
  var linked = events.filter(function (e) { return String(e.addressId) === String(address.id); }).sort(byEventTime);
  if (!linked.length) return null;
  return [h('p', { className: 'section-title', text: 'Au programme' })].concat(linked.map(function (e) {
    return h('div', { className: 'list-row schedule-row', onclick: function () { openView('schedule-day', { date: e.date, focus: e.id }); } }, [
      h('span', { className: 'row-icon', text: eventType(e.type).icon }),
      h('div', { className: 'list-row-main' }, [
        h('p', { className: 'list-row-title', text: e.title }),
        h('p', { className: 'list-row-sub', text: dayTitle(e.date) + (e.time ? ' · ' + eventTimeText(e) : '') })
      ])
    ]);
  }));
}
