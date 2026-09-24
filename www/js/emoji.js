/* ---------- Emojis ----------
   Sélecteur intégré (le clavier du téléphone en propose aussi) : une sélection par catégorie,
   plus les derniers emojis utilisés. */
var EMOJI_CATEGORIES = [
  { icon: '😀', label: 'Visages et gestes', emojis:
    '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 😜 🤪 😎 🤩 🥳 😏 😌 😴 🤤 😪 😮 😲 😳 ' +
    '🥺 😢 😭 😤 😠 😡 🤯 😱 😨 🤔 🤫 🤭 🙄 😬 🤗 🤒 🤕 🤢 🤧 🥵 🥶 👍 👎 👌 ✌️ 🤞 🤟 🤙 👋 👏 ' +
    '🙌 🙏 💪 👀 🙋 🙇 🤷 💁 🙆 🙅' },
  { icon: '✈️', label: 'Voyage et lieux', emojis:
    '✈️ 🛫 🛬 🚄 🚅 🚆 🚇 🚉 🚈 🚝 🚞 🚌 🚍 🚕 🚖 🚗 🚲 🛴 🛵 ⛴️ 🚢 ⛵ 🚁 🗺️ 🧭 🧳 🎒 🛂 🎫 🎟️ ' +
    '🏨 🏩 🏠 🏢 🏬 🏪 🏦 🏥 🏯 🏰 ⛩️ 🗼 🗾 🗻 🌋 🏔️ ⛰️ 🏕️ 🏖️ 🏝️ 🌆 🌃 🌉 🎡 🎢 ♨️ 🎌 🎏 🎐 🎎 ' +
    '🏮 🎑 🚏 🚦 ⛽ 🅿️ 🚻 🚾' },
  { icon: '🍣', label: 'Nourriture et boissons', emojis:
    '🍣 🍱 🍙 🍘 🍚 🍛 🍜 🍝 🍢 🍡 🍥 🍤 🥟 🥠 🥡 🍲 🥘 🍳 🥞 🍞 🥐 🥨 🧀 🍖 🍗 🥩 🍔 🍟 🍕 🌭 ' +
    '🥪 🌮 🌯 🥗 🍿 🥫 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🥧 🍫 🍬 🍭 🍮 🍯 🍓 🍒 🍑 🍈 🍉 🍊 🍋 🍌 🍍 🥭 ' +
    '🍎 🍏 🍐 🥝 🍇 🥥 🍅 🥑 🍆 🥕 🌽 🌶️ 🥒 🥦 🍄 🥜 🌰 🍵 ☕ 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🥢 🍴' },
  { icon: '🌸', label: 'Nature et météo', emojis:
    '🌸 💮 🏵️ 🌹 🌺 🌻 🌼 🌷 🌱 🌿 ☘️ 🍀 🎋 🎍 🍁 🍂 🍃 🌾 🌵 🌴 🌳 🌲 🐱 🐶 🦊 🐻 🐼 🐨 🐯 🦁 ' +
    '🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🐟 🐠 🐡 🦈 🐙 🦀 🦐 🦑 🐢 🦋 🐝 🐞 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ ' +
    '❄️ ☃️ ⛄ 🌬️ 🌈 ☔ 💧 🌊 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌏' },
  { icon: '🎒', label: 'Objets et activités', emojis:
    '💴 💶 💳 💰 🧾 📱 💻 🔌 🔋 📷 📸 🎥 🎧 ⌚ ⏰ 🗓️ 📅 📝 📒 📓 📔 📖 📚 ✏️ 🖊️ 📌 📍 📎 ✂️ 🔑 ' +
    '🗝️ 🔒 🔓 🛍️ 🎁 👘 👗 👕 👖 🧥 👟 🧦 🧣 🧤 🧢 👒 👓 🕶️ ☂️ 🌂 💊 💉 🧴 🧼 🎮 🎲 🎨 🎤 🎸 🏆 ' +
    '🎯 🎳 ⚽ 🏀 ⚾ 🎾 🏓 🎿 🏂 🏄 🏊 🚴 🧗 🧘' },
  { icon: '❤️', label: 'Symboles', emojis:
    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💯 ✅ ☑️ ✔️ ❌ ❎ ⭕ 🚫 ⛔ ⚠️ ❗ ❓ ‼️ ⁉️ 💤 💬 💭 🔔 🔕 ' +
    '🎵 🎶 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↩️ 🔄 🔁 ▶️ ⏸️ ⏹️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🔶 🔷 ' +
    '🆗 🆕 🆓 🆒 🆙 🈁 🈶 🈚 🈸 🈺 🈷️ 🉐 🉑 🔝 🔜 ℹ️ 🇯🇵 🇫🇷' }
];
var RECENT_EMOJIS_KEY = 'sohri.recentEmojis';

function recentEmojis() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_EMOJIS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function rememberEmoji(emoji) {
  var list = recentEmojis().filter(function (e) { return e !== emoji; });
  list.unshift(emoji);
  try {
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(list.slice(0, 24)));
  } catch (e) { /* stockage indisponible : tant pis pour les récents */ }
}

/* Ouvre le sélecteur en bas de l'écran ; onPick(emoji) est appelé au choix. */
function openEmojiPicker(onPick) {
  var categories = EMOJI_CATEGORIES.slice();
  var recent = recentEmojis();
  if (recent.length) categories.unshift({ icon: '🕘', label: 'Récents', emojis: recent.join(' ') });

  var grid = h('div', { className: 'emoji-grid', role: 'listbox' });
  var tabs = h('div', { className: 'emoji-tabs', role: 'tablist' });

  function showCategory(index) {
    grid.innerHTML = '';
    categories[index].emojis.split(/\s+/).forEach(function (emoji) {
      grid.appendChild(h('button', { type: 'button', className: 'emoji-cell', dataset: { emoji: emoji }, text: emoji }));
    });
    grid.scrollTop = 0;
    for (var i = 0; i < tabs.children.length; i++) tabs.children[i].setAttribute('aria-selected', String(i === index));
  }

  categories.forEach(function (category, index) {
    tabs.appendChild(h('button', {
      type: 'button', className: 'emoji-tab', role: 'tab', title: category.label, 'aria-label': category.label,
      text: category.icon, onclick: function () { showCategory(index); }
    }));
  });
  grid.addEventListener('click', function (e) {
    var emoji = e.target.dataset && e.target.dataset.emoji;
    if (!emoji) return;
    rememberEmoji(emoji);
    closeSheet();
    onPick(emoji);
  });

  openSheet(h('div', { className: 'emoji-picker' }, [tabs, grid]));
  showCategory(0);
}
