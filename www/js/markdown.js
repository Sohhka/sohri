/* ---------- Markdown : affichage ----------
   Les notes et descriptions s'écrivent en markdown (**gras**, listes, - [ ] cases à cocher...),
   affiché grâce à la bibliothèque marked (js/vendor). */
var SAFE_LINK = /^(https?:|mailto:|tel:|geo:)/i;
var TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?= +\S)/;
var FENCE_LINE = /^[ \t]*(```|~~~)/;
var mdTaskCount = 0;

function safeHref(href) {
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(href)) href = 'https://' + href; // « www.exemple.jp » tapé sans https://
  if (!SAFE_LINK.test(href)) return null;
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
}

var markdown = new marked.Marked({
  gfm: true,
  breaks: true, // un retour à la ligne tapé = un retour à la ligne affiché
  renderer: {
    // Le HTML tapé dans une note s'affiche tel quel, il n'est jamais interprété.
    html: function (token) {
      return token.block ? '<p>' + escapeHTML(token.text) + '</p>' : escapeHTML(token.text);
    },
    link: function (token) {
      var text = token.autolink ? escapeHTML(token.text) : this.parser.parseInline(token.tokens);
      var href = safeHref(token.href);
      return href ? '<a href="' + escapeHTML(href) + '">' + text + '</a>' : text;
    },
    // Pas d'images distantes (l'appli fonctionne sans connexion) : un lien à la place.
    image: function (token) {
      var label = '🖼️ ' + escapeHTML(token.text || token.href);
      var href = safeHref(token.href);
      return href ? '<a href="' + escapeHTML(href) + '">' + label + '</a>' : label;
    },
    listitem: function (item) {
      return '<li' + (item.task ? ' class="task-item"' : '') + '>' + this.parser.parse(item.tokens) + '</li>\n';
    },
    // Cases numérotées dans l'ordre du texte, pour retrouver la ligne à cocher (setTaskInMarkdown).
    checkbox: function (token) {
      return '<input type="checkbox" class="task-box" data-task="' + (mdTaskCount++) + '"' + (token.checked ? ' checked' : '') + '> ';
    }
  }
});

function renderMarkdown(src) {
  mdTaskCount = 0;
  return markdown.parse(src || '')
    .replace(/<table>/g, '<div class="md-table"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/* Affiche du markdown dans container ; avec onToggleTask(index, coché), les cases sont cliquables. */
function showMarkdown(container, src, onToggleTask) {
  container.innerHTML = renderMarkdown(src);
  var boxes = container.querySelectorAll('.task-box');
  for (var i = 0; i < boxes.length; i++) boxes[i].disabled = !onToggleTask;
  container.onchange = onToggleTask ? function (e) {
    if (e.target.classList.contains('task-box')) onToggleTask(parseInt(e.target.dataset.task, 10), e.target.checked);
  } : null;
}

/* Coche ou décoche la n-ième case du texte (même ordre que l'affichage, blocs de code exclus). */
function setTaskInMarkdown(src, index, checked) {
  var lines = src.split('\n');
  var count = 0;
  var fence = null;
  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].match(FENCE_LINE);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    var m = lines[i].match(TASK_LINE);
    if (!m) continue;
    if (count === index) {
      lines[i] = m[1] + (checked ? '[x]' : '[ ]') + lines[i].slice(m[0].length);
      return lines.join('\n');
    }
    count++;
  }
  return src;
}

/* Aperçu en texte brut, pour les listes. */
function markdownExcerpt(src, maxLength) {
  var text = (src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\][ \t]+/gm, '☑ ')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]+/gm, '☐ ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
}

/* Les liens d'un texte affiché s'ouvrent dans l'appli adaptée (navigateur, téléphone...). */
document.addEventListener('click', function (e) {
  var link = e.target.closest && e.target.closest('.markdown a[href]');
  if (!link) return;
  e.preventDefault();
  openExternal(link.getAttribute('href'));
});

/* ---------- Markdown : saisie et barre de mise en forme ---------- */
var activeMarkdownField = null; // zone visée par la barre de mise en forme
var activeTextField = null;     // dernier champ utilisé, pour y insérer un emoji
var LIST_ITEM = /^([ \t]*)((?:[-*+] \[[ xX]\] )|(?:[-*+] )|(?:(\d{1,9})([.)]) )|(?:> ))/;
var ANY_LIST_PREFIX = /^([ \t]*)(?:[-*+] \[[ xX]\] |[-*+] |\d{1,9}[.)] )/;
var LINE_FORMATS = {
  bullet: { test: /^([ \t]*)[-*+] (?!\[[ xX]\] )/, prefix: function () { return '- '; } },
  number: { test: /^([ \t]*)\d{1,9}[.)] /, prefix: function (i) { return (i + 1) + '. '; } },
  task: { test: /^([ \t]*)[-*+] \[[ xX]\] /, prefix: function () { return '- [ ] '; } },
  quote: { test: /^([ \t]*)> ?/, prefix: function () { return '> '; } }
};

function registerTextField(field) {
  field.addEventListener('focus', function () { activeTextField = field; });
}

function registerMarkdownField(field) {
  registerTextField(field);
  field.addEventListener('focus', function () { activeMarkdownField = field; });
  field.addEventListener('input', function (e) {
    continueList(field, e);
    autoGrow(field);
  });
}

/* La zone de texte grandit avec son contenu : c'est la page qui défile, pas la zone. */
function autoGrow(field) {
  if (field.hidden || !field.offsetParent) return;
  var content = byId('content');
  var scroll = content.scrollTop;
  field.style.height = 'auto';
  field.style.height = (field.scrollHeight + field.offsetHeight - field.clientHeight) + 'px';
  content.scrollTop = scroll;
}

function notifyInput(field) {
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertAtCursor(field, text) {
  field.focus();
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
  notifyInput(field);
}

/* Entrée à la fin d'un élément de liste : le suivant est préparé (« - », « - [ ] », « 2. »...).
   Entrée sur un élément vide : la liste se termine. */
function continueList(field, e) {
  var newLine = e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph' ||
    (e.inputType === 'insertText' && e.data === '\n');
  if (!newLine) return;
  var pos = field.selectionStart;
  var value = field.value;
  if (pos !== field.selectionEnd || value[pos - 1] !== '\n') return;
  var prevStart = value.lastIndexOf('\n', pos - 2) + 1;
  var prevLine = value.slice(prevStart, pos - 1);
  var m = prevLine.match(LIST_ITEM);
  if (!m) return;
  if (prevLine.length === m[0].length) {
    field.setRangeText('\n', prevStart, pos, 'end'); // ligne vide : fin de la liste
  } else {
    var marker = m[3] ? (parseInt(m[3], 10) + 1) + m[4] + ' ' : m[2].replace(/\[[xX]\]/, '[ ]');
    field.setRangeText(m[1] + marker, pos, pos, 'end');
  }
}

/* Entoure la sélection (ou un texte d'exemple sélectionné) ; la retire si elle y est déjà. */
function wrapSelection(field, before, after, placeholder) {
  var start = field.selectionStart;
  var end = field.selectionEnd;
  var value = field.value;
  var selected = value.slice(start, end);
  if (selected && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    field.setRangeText(selected, start - before.length, end + after.length, 'select');
  } else if (selected.length > before.length + after.length && selected.indexOf(before) === 0 &&
             selected.slice(-after.length) === after) {
    field.setRangeText(selected.slice(before.length, selected.length - after.length), start, end, 'select');
  } else {
    var text = selected || placeholder;
    field.setRangeText(before + text + after, start, end, 'end');
    field.setSelectionRange(start + before.length, start + before.length + text.length);
  }
  notifyInput(field);
}

/* Lignes sélectionnées (ou ligne du curseur) : { start, end, lines }. */
function selectedLines(field) {
  var value = field.value;
  var start = value.lastIndexOf('\n', field.selectionStart - 1) + 1;
  var end = value.indexOf('\n', field.selectionEnd);
  if (end < 0) end = value.length;
  return { start: start, end: end, lines: value.slice(start, end).split('\n') };
}

/* Liste à puces, numérotée, à cocher ou citation : ajoutée aux lignes, ou retirée si déjà là. */
function toggleLineFormat(field, kind) {
  var format = LINE_FORMATS[kind];
  var block = selectedLines(field);
  var filled = block.lines.filter(function (line) { return line.trim(); });
  var remove = filled.length > 0 && filled.every(function (line) { return format.test.test(line); });
  var n = 0;
  var result = block.lines.map(function (line) {
    if (remove) return line.replace(format.test, '$1');
    if (!line.trim() && block.lines.length > 1) return line;
    var indent = line.match(/^[ \t]*/)[0];
    var rest = kind === 'quote' ? line.slice(indent.length) : line.replace(ANY_LIST_PREFIX, '$1').slice(indent.length);
    return indent + format.prefix(n++) + rest;
  });
  field.setRangeText(result.join('\n'), block.start, block.end, 'end');
  notifyInput(field);
}

/* Titre : aucun → # → ## → ### → aucun, sur la ligne du curseur. */
function cycleHeading(field) {
  var block = selectedLines(field);
  var line = block.lines[0];
  var m = line.match(/^(#{1,6}) /);
  var level = m ? m[1].length : 0;
  var text = m ? line.slice(m[0].length) : line;
  var prefix = level >= 3 ? '' : new Array(level + 2).join('#') + ' ';
  field.setRangeText(prefix + text, block.start, block.start + line.length, 'end');
  notifyInput(field);
}

function insertCode(field) {
  var selected = field.value.slice(field.selectionStart, field.selectionEnd);
  if (selected.indexOf('\n') >= 0) wrapSelection(field, '```\n', '\n```', '');
  else wrapSelection(field, '`', '`', 'code');
}

/* Lien : sur une adresse sélectionnée, on ajoute un texte à remplacer ; sinon le texte sélectionné
   (ou « lien ») devient cliquable et le curseur attend l'adresse entre les parenthèses. */
function insertLink(field) {
  var start = field.selectionStart;
  var end = field.selectionEnd;
  var selected = field.value.slice(start, end);
  if (/^(https?:\/\/|www\.)\S+$/.test(selected)) {
    field.setRangeText('[texte](' + selected + ')', start, end, 'end');
    field.setSelectionRange(start + 1, start + 6); // « texte » sélectionné, prêt à être remplacé
  } else {
    var label = selected || 'lien';
    field.setRangeText('[' + label + ']()', start, end, 'end');
    var urlPos = start + label.length + 3;
    field.setSelectionRange(urlPos, urlPos);
  }
  notifyInput(field);
}

/* Séparateur : précédé d'une ligne vide, sinon « --- » ferait du texte au-dessus un titre. */
function insertRule(field) {
  var start = field.selectionStart;
  var value = field.value;
  var prefix = '';
  if (start > 0 && value[start - 1] !== '\n') prefix = '\n\n';
  else if (start > 1 && value[start - 2] !== '\n') prefix = '\n';
  field.setRangeText(prefix + '---\n\n', start, field.selectionEnd, 'end');
  notifyInput(field);
}

function applyMarkdownAction(action) {
  if (action === 'emoji') {
    var target = activeTextField && activeTextField.offsetParent ? activeTextField : activeMarkdownField;
    if (target) openEmojiPicker(function (emoji) { insertAtCursor(target, emoji); });
    return;
  }
  var field = activeMarkdownField;
  if (!field || !field.offsetParent) return;
  if (document.activeElement !== field) field.focus();
  if (action === 'bold') wrapSelection(field, '**', '**', 'texte en gras');
  else if (action === 'italic') wrapSelection(field, '_', '_', 'texte en italique');
  else if (action === 'strike') wrapSelection(field, '~~', '~~', 'texte barré');
  else if (action === 'heading') cycleHeading(field);
  else if (action === 'code') insertCode(field);
  else if (action === 'link') insertLink(field);
  else if (action === 'rule') insertRule(field);
  else if (LINE_FORMATS[action]) toggleLineFormat(field, action);
}

/* Toucher un bouton de la barre ne doit pas retirer le curseur de la zone de texte (le clavier resterait fermé). */
byId('mdToolbar').addEventListener('mousedown', function (e) {
  if (e.target.closest('button')) e.preventDefault();
});
byId('mdToolbar').addEventListener('click', function (e) {
  var button = e.target.closest('button[data-md]');
  if (button) applyMarkdownAction(button.dataset.md);
});
