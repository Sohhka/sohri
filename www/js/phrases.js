/* ---------- Phrases utiles en japonais ----------
   Hors connexion : en français, en japonais et prononcées à la française (rōmaji). Un toucher les
   affiche en grand, noir sur blanc, pour les montrer (comme la carte du taxi, ui.js). */
var PHRASE_GROUPS = [
  { icon: '🙏', title: 'Politesse', phrases: [
    ['Bonjour', 'こんにちは', 'Konnichiwa'],
    ['Merci beaucoup', 'ありがとうございます', 'Arigatō gozaimasu'],
    ['Excusez-moi (pour appeler, ou pardon)', 'すみません', 'Sumimasen'],
    ['Je ne parle pas japonais', '日本語が話せません', 'Nihongo ga hanasemasen'],
    ['Parlez-vous anglais ?', '英語を話せますか？', 'Eigo o hanasemasu ka ?'],
    ['Pouvez-vous l\'écrire, s\'il vous plaît ?', '書いてもらえますか？', 'Kaite moraemasu ka ?']
  ] },
  { icon: '🍜', title: 'Au restaurant', phrases: [
    ['Nous sommes deux', '二人です', 'Futari desu'],
    ['Le menu, s\'il vous plaît', 'メニューをお願いします', 'Menyū o onegai shimasu'],
    ['Ceci, s\'il vous plaît (en montrant)', 'これをお願いします', 'Kore o onegai shimasu'],
    ['De l\'eau, s\'il vous plaît', 'お水をお願いします', 'O-mizu o onegai shimasu'],
    ['L\'addition, s\'il vous plaît', 'お会計をお願いします', 'O-kaikei o onegai shimasu'],
    ['Je ne peux pas manger de viande', '肉が食べられません', 'Niku ga taberaremasen'],
    ['Je ne peux pas manger de poisson ni de fruits de mer', '魚介類が食べられません', 'Gyokairui ga taberaremasen'],
    ['Je suis allergique aux crustacés', '甲殻類のアレルギーがあります', 'Kōkakurui no arerugī ga arimasu'],
    ['Je suis allergique aux arachides', 'ピーナッツのアレルギーがあります', 'Pīnattsu no arerugī ga arimasu'],
    ['C\'est délicieux !', 'おいしいです！', 'Oishii desu !'],
    ['Merci pour le repas (en partant)', 'ごちそうさまでした', 'Gochisōsama deshita']
  ] },
  { icon: '🚆', title: 'Se déplacer', phrases: [
    ['Où sont les toilettes ?', 'トイレはどこですか？', 'Toire wa doko desu ka ?'],
    ['Où est la gare ?', '駅はどこですか？', 'Eki wa doko desu ka ?'],
    ['Ce train va-t-il ici ? (en montrant le nom)', 'この電車はここに行きますか？', 'Kono densha wa koko ni ikimasu ka ?'],
    ['Un billet jusqu\'ici, s\'il vous plaît (en montrant)', 'ここまでの切符をお願いします', 'Koko made no kippu o onegai shimasu'],
    ['À cette adresse, s\'il vous plaît (taxi)', 'この住所までお願いします', 'Kono jūsho made onegai shimasu'],
    ['Je suis perdu(e)', '道に迷いました', 'Michi ni mayoimashita'],
    ['Pouvez-vous me montrer sur la carte ?', '地図で教えてもらえますか？', 'Chizu de oshiete moraemasu ka ?']
  ] },
  { icon: '🛍️', title: 'Achats', phrases: [
    ['Combien ça coûte ?', 'いくらですか？', 'Ikura desu ka ?'],
    ['Je peux payer par carte ?', 'カードで払えますか？', 'Kādo de haraemasu ka ?'],
    ['La détaxe est-elle possible ?', '免税できますか？', 'Menzei dekimasu ka ?'],
    ['Je regarde seulement, merci', '見ているだけです', 'Mite iru dake desu'],
    ['Un sac, s\'il vous plaît', '袋をお願いします', 'Fukuro o onegai shimasu']
  ] },
  { icon: '🏨', title: 'À l\'hôtel', phrases: [
    ['J\'ai une réservation', '予約しています', 'Yoyaku shite imasu'],
    ['Pouvez-vous garder nos bagages ?', '荷物を預かってもらえますか？', 'Nimotsu o azukatte moraemasu ka ?'],
    ['Quel est le mot de passe du Wi-Fi ?', 'Wi-Fiのパスワードは何ですか？', 'Waifai no pasuwādo wa nan desu ka ?']
  ] },
  { icon: '🚑', title: 'Urgences', phrases: [
    ['Au secours !', '助けて！', 'Tasukete !'],
    ['Appelez une ambulance, s\'il vous plaît', '救急車を呼んでください', 'Kyūkyūsha o yonde kudasai'],
    ['Appelez la police, s\'il vous plaît', '警察を呼んでください', 'Keisatsu o yonde kudasai'],
    ['Je ne me sens pas bien', '気分が悪いです', 'Kibun ga warui desu'],
    ['Où est l\'hôpital le plus proche ?', '一番近い病院はどこですか？', 'Ichiban chikai byōin wa doko desu ka ?'],
    ['J\'ai perdu mon passeport', 'パスポートをなくしました', 'Pasupōto o nakushimashita']
  ] }
];
// Numéros d'urgence au Japon (gratuits, depuis n'importe quel téléphone).
var EMERGENCY_NUMBERS = [['110', '🚓 Police'], ['119', '🚑 Ambulance, pompiers']];
var phrasesSearchTimer = null;

defineView('phrases', {
  el: 'view-phrases',
  section: 'phrases',
  title: 'Phrases utiles',
  enter: renderPhrases
});

function renderPhrases() {
  var query = normalizeText(byId('phrasesSearch').value.trim());
  var box = byId('phrasesContent');
  box.innerHTML = '';
  var shown = 0;
  PHRASE_GROUPS.forEach(function (group) {
    var phrases = group.phrases.filter(function (p) {
      return !query || normalizeText(p[0] + ' ' + p[2]).indexOf(query) >= 0 || p[1].indexOf(query) >= 0;
    });
    if (!phrases.length) return;
    shown += phrases.length;
    box.appendChild(h('h2', { className: 'section-title', text: group.icon + ' ' + group.title }));
    box.appendChild(h('div', { className: 'list' }, phrases.map(function (p) {
      return h('button', { type: 'button', className: 'list-row phrase-row', onclick: function () { showPhraseCard(p); } }, [
        h('span', { className: 'list-row-main' }, [
          h('span', { className: 'list-row-title', text: p[0] }),
          h('span', { className: 'phrase-ja', lang: 'ja', text: p[1] }),
          h('span', { className: 'list-row-sub', text: p[2] })
        ]),
        h('span', { className: 'row-chevron', 'aria-hidden': 'true', text: '⤢' })
      ]);
    })));
    if (group.title === 'Urgences') {
      box.appendChild(h('div', { className: 'card emergency-card' }, [
        h('p', { className: 'card-label', text: 'Numéros d\'urgence au Japon' }),
        h('div', { className: 'card-actions' }, EMERGENCY_NUMBERS.map(function (n) {
          return actionButton('📞', n[0] + ' · ' + n[1], function () { openExternal('tel:' + n[0]); });
        }))
      ]));
    }
  });
  if (!shown) box.appendChild(h('p', { className: 'empty', text: 'Aucune phrase ne correspond à ta recherche.' }));
}

byId('phrasesSearch').addEventListener('input', function () {
  clearTimeout(phrasesSearchTimer);
  phrasesSearchTimer = setTimeout(function () {
    if (currentViewName() === 'phrases') renderPhrases();
  }, 150);
});

function showPhraseCard(phrase) {
  byId('phraseJa').textContent = phrase[1];
  byId('phraseRomaji').textContent = phrase[2];
  byId('phraseFr').textContent = '« ' + phrase[0] + ' »';
  byId('phraseCard').hidden = false;
}

function closePhraseCard() {
  byId('phraseCard').hidden = true;
}

function isPhraseCardOpen() {
  return !byId('phraseCard').hidden;
}

byId('phraseCloseBtn').addEventListener('click', closePhraseCard);
