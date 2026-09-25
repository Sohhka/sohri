/* ---------- Navigation entre les vues ----------
   Chaque vue est déclarée avec defineView(nom, {
     el:       id de la <section> à afficher,
     section:  rubrique du menu mise en évidence (texte, ou fonction(params)),
     title:    titre (texte, ou fonction(params)),
     enter:    fonction(params) appelée à l'affichage (peut renvoyer une promesse),
     exit:     fonction(params) appelée quand la vue est fermée (libérer la mémoire...),
     canLeave: fonction(params) → promesse de booléen, pour confirmer avant de perdre une saisie,
     actions:  fonction(params) → boutons de la barre du haut { icon | text, label, onClick },
     toolbar:  true (ou fonction) pour afficher la barre de mise en forme en bas,
     commentBar: fonction(params) → true pour afficher la barre d'écriture d'un commentaire
   }).
   Les vues ouvertes forment une pile : ← (ou le bouton retour d'Android) revient à la précédente. */
var VIEWS = {};
var navStack = [];

function defineView(name, def) {
  VIEWS[name] = def;
}

function currentEntry() {
  return navStack[navStack.length - 1];
}

function currentViewName() {
  var entry = currentEntry();
  return entry ? entry.name : null;
}

function setViewTitle(text) {
  byId('viewTitle').textContent = text;
}

function renderTopActions() {
  var entry = currentEntry();
  var def = VIEWS[entry.name];
  var container = byId('topActions');
  container.innerHTML = '';
  (def.actions ? def.actions(entry.params) : []).forEach(function (action) {
    container.appendChild(h('button', {
      type: 'button',
      className: action.text ? 'top-text-btn' : 'icon-btn',
      'aria-label': action.label,
      title: action.label,
      text: action.text || action.icon,
      onclick: action.onClick
    }));
  });
}

/* Barres du bas (mise en forme, sélection de photos) : la zone de contenu s'arrête au-dessus. */
function updateBottomBars() {
  var entry = currentEntry();
  var def = entry && VIEWS[entry.name];
  var toolbar = !!(def && (typeof def.toolbar === 'function' ? def.toolbar(entry.params) : def.toolbar));
  var commentBar = !!(def && def.commentBar && def.commentBar(entry.params));
  byId('mdToolbar').hidden = !toolbar;
  byId('commentBar').hidden = !commentBar;
  byId('app').classList.toggle('has-bottom-bar', toolbar || commentBar || !byId('selectionBar').hidden);
}

function showCurrentView(restoreScroll) {
  var entry = currentEntry();
  var def = VIEWS[entry.name];
  var sections = document.querySelectorAll('.view');
  for (var i = 0; i < sections.length; i++) sections[i].hidden = sections[i].id !== def.el;

  var nested = navStack.length > 1;
  byId('navBtn').textContent = nested ? '←' : '☰';
  byId('navBtn').setAttribute('aria-label', nested ? 'Retour' : 'Menu');
  byId('navBtn').classList.toggle('is-back', nested);
  setViewTitle(typeof def.title === 'function' ? def.title(entry.params) : (def.title || ''));
  renderTopActions();
  var section = typeof def.section === 'function' ? def.section(entry.params) : def.section;
  var items = document.querySelectorAll('.drawer-item');
  for (var j = 0; j < items.length; j++) {
    if (items[j].dataset.section === section) items[j].setAttribute('aria-current', 'page');
    else items[j].removeAttribute('aria-current');
  }
  updateBottomBars();

  var content = byId('content');
  content.scrollTop = 0;
  var ready = def.enter ? def.enter(entry.params) : null;
  if (restoreScroll) {
    Promise.resolve(ready).then(function () {
      if (currentEntry() === entry) content.scrollTop = entry.scroll || 0;
    });
  }
}

function exitEntry(entry) {
  var def = VIEWS[entry.name];
  if (def.exit) def.exit(entry.params);
}

function openView(name, params) {
  var top = currentEntry();
  if (top) top.scroll = byId('content').scrollTop;
  navStack.push({ name: name, params: params || {} });
  showCurrentView(false);
}

/* Réaffiche la vue courante après une modification, en gardant la position de défilement
   (pas pour un formulaire : sa saisie serait perdue). */
function refreshView() {
  var entry = currentEntry();
  entry.scroll = byId('content').scrollTop;
  showCurrentView(true);
}

/* Remplace la vue courante (ex. une nouvelle note enregistrée s'affiche à la place de l'éditeur). */
function replaceView(name, params) {
  exitEntry(navStack.pop());
  navStack.push({ name: name, params: params || {} });
  showCurrentView(false);
}

function canLeaveCurrent() {
  var entry = currentEntry();
  var def = entry && VIEWS[entry.name];
  return def && def.canLeave ? def.canLeave(entry.params) : Promise.resolve(true);
}

/* Revient à la vue précédente, après confirmation si une saisie serait perdue (sauf force). */
function goBack(force) {
  if (navStack.length < 2) return Promise.resolve(false);
  var entry = currentEntry();
  return (force ? Promise.resolve(true) : canLeaveCurrent()).then(function (ok) {
    if (!ok || currentEntry() !== entry) return false;
    exitEntry(navStack.pop());
    showCurrentView(true);
    return true;
  });
}

/* Après une suppression : retour à la vue précédente (ou à la rubrique). */
function leaveAfterDelete(section) {
  if (navStack.length > 1) goBack(true);
  else goToSection(section);
}

/* Rubrique choisie dans le menu : la pile repart de zéro. */
function goToSection(name) {
  return canLeaveCurrent().then(function (ok) {
    if (!ok) return false;
    while (navStack.length) exitEntry(navStack.pop());
    navStack.push({ name: name, params: {} });
    showCurrentView(false);
    return true;
  });
}
