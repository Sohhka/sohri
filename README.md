# SOHRI

Appli pour un voyage au Japon, sur **Android** (APK) et sur **iPhone** (version web installable,
**https://sohhka.github.io/sohri/**) :

- **Convertisseur ¥ ⇄ €** : des yens vers les euros, ou l'inverse (⇅) ; **＋ additionne plusieurs
  prix** (le panier d'une supérette…) et 🧾 note le montant comme dépense. Le **taux du jour**
  (Banque centrale européenne) se met à jour tout seul dès qu'il y a Internet (on peut aussi le
  modifier à la main, par exemple pour celui de sa carte : il reste jusqu'au prochain taux publié),
  et juste en dessous **l'heure au Japon et en France** (24 h, heure d'été comprise, mise à jour en
  direct, sans Internet).
- **Programme** : le voyage **jour par jour** (vol, train, hôtel, visite, repas…), chaque étape avec
  son heure, son lieu du carnet d'adresses, des notes (n° de réservation, quai…) et ses **billets**.
  Avant le départ, le compte à rebours ; pendant le voyage, l'écran **« Aujourd'hui »** : l'étape en
  cours, la suivante (« dans 1 h 20 »), l'itinéraire, l'adresse pour le taxi, les billets d'un
  toucher et la météo du jour.
- **Dépenses** : chaque achat en yens ou en euros, avec une catégorie (repas, transport, shopping,
  hébergement, visites…), un libellé et sa date ; le **total du voyage**, celui **du jour** et
  **par catégorie**, en yens et en euros (chaque dépense au taux de son jour). Export en tableau
  (CSV) pour Excel, Numbers ou Google Sheets.
- **Météo & heure** : l'heure au Japon et en France, la **météo heure par heure** pour les
  prochaines 24 heures (température, risque de pluie) et celle de la **semaine en cours** (du lundi
  au dimanche) dans la ville choisie (Tokyo au départ, liste des villes du Japon ou recherche).
  Gardée sur le téléphone pour être consultable hors connexion, elle se met à jour dès qu'il y a
  Internet, même une minute.
- **Notes** rangées dans des **dossiers** (Tokyo, Réservations…), avec mise en forme (titres, gras,
  listes, **cases à cocher**…), **emojis**, photos, **pièces jointes** (PDF de billets…), liées à une
  adresse. Export d'une note en fichier `.md`.
- **Carnet d'adresses** par catégories (hébergement, restaurant, à visiter…) : itinéraire Google Maps,
  adresse en japonais à **montrer au chauffeur de taxi**, téléphone, site web, pièces jointes, notes liées.
- **Phrases utiles** : une quarantaine de phrases en japonais (politesse, restaurant, transports,
  achats, hôtel, urgences), avec la prononciation ; un toucher l'affiche **en grand, à montrer**.
  Recherche, et numéros d'urgence (110 police, 119 ambulance et pompiers) appelables d'un toucher.
  Sans Internet.
- **Images** : des albums (« Tokyo », « Shibuya »…) pour ranger ses photos, classées par jour de prise de
  vue, avec une **description** et un **lieu** par photo et, une fois partagées, les **commentaires**
  des proches. En plein écran, **Télécharger** met la photo dans la galerie du téléphone (aussi pour
  les photos des proches et celles des notes) ; en mode sélection, **plusieurs photos d'un coup**,
  et **tout un album** d'un proche.
- **Documents** : tous ses fichiers (PDF, images, vidéos, sons, textes…) rangés dans des dossiers
  et **affichés directement dans l'appli**.
- **Partage** (facultatif) : avec un compte, montrer ses **Images** aux proches de son choix, qui
  les voient dans leur appli, même hors connexion une fois reçues, et aussi, **en lecture seule**,
  son **programme**, son **carnet d'adresses**, ses **notes** et ses **documents** ; retrouver
  **toutes ses rubriques** (programme, notes, adresses, dépenses, images, documents) sur tous ses
  appareils. L'écran
  montre l'**espace occupé en ligne** par soi et ses proches, et le menu l'état de la
  synchronisation (✓ à jour, ⟳ en cours, 📴 hors connexion, ⚠️ problème).
- **Paramètres** : thème **clair**, **sombre** ou automatique ; **sauvegarde** complète dans un fichier,
  et restauration (avec la date de la dernière sauvegarde, et un rappel au bout de 7 jours) ;
  **rapport de diagnostic** à envoyer quand quelque chose ne marche pas.

Tout fonctionne hors connexion et les données restent sur le téléphone. Avec Internet, l'appli
demande seulement des informations publiques, sans compte ni rien d'envoyé sur soi : le taux du
jour (Frankfurter, taux de la BCE ; en secours, jsDelivr), la météo de la ville choisie
(Open-Meteo) et, pour l'appli Android, s'il existe une nouvelle version (GitHub, au plus toutes
les 6 heures). Le reste de l'accès à Internet sert, avec un compte, au partage entre proches et à
la synchronisation entre ses appareils.

## Installer l'appli sur Android

1. Copier `dist/Sohri-2.4.apk` sur le téléphone (câble USB, Google Drive, e-mail…), ou le
   télécharger depuis la page [Releases](https://github.com/Sohhka/sohri/releases/latest) du dépôt.
2. L'ouvrir depuis le téléphone. Android demande d'autoriser l'installation d'applis depuis cette
   source (Fichiers, Drive…) : accepter.
3. Si Play Protect signale une appli inconnue, choisir d'installer quand même : c'est normal pour
   une appli qui ne vient pas du Play Store.

Il faut Android 8.0 ou plus récent. Une nouvelle version s'installe **par-dessus** l'ancienne :
notes, adresses, dépenses, images et documents sont conservés. Depuis la version 1.9, l'appli prévient
elle-même (bandeau en bas de l'écran) quand une nouvelle version est publiée sur GitHub, avec son
APK : **Mettre à jour** ouvre directement la page de cette version.

## Installer l'appli sur l'iPhone

1. Ouvrir **https://sohhka.github.io/sohri/** dans **Safari**, avec Internet.
2. Toucher **Partager** (le carré avec une flèche ; selon la version d'iOS, d'abord •••), puis
   **Sur l'écran d'accueil**, puis **Ajouter**.
3. Ouvrir SOHRI depuis sa nouvelle icône, **une première fois avec Internet** : l'appli se copie
   sur l'iPhone. Elle fonctionne ensuite **hors connexion**, en plein écran, comme une vraie appli.

À savoir :

- Les données restent sur l'iPhone, **dans l'appli installée** : elles sont séparées de celles de
  Safari et de celles de l'appli Android. Pour passer de l'un à l'autre : **Créer une sauvegarde**
  d'un côté, **Restaurer une sauvegarde** de l'autre (le fichier `.zip` passe par iCloud Drive,
  Google Drive, AirDrop, e-mail…), ou, avec un compte, **Synchroniser toutes mes rubriques**
  (voir « Toutes mes rubriques sur tous mes appareils »).
- « Partager », « Ouvrir avec une autre appli » et « Enregistrer sous… » passent par la feuille de
  partage de l'iPhone (Enregistrer dans Fichiers, AirDrop, Mail…).
- **Télécharger** une photo (bouton ⬇ en plein écran) : Apple ne laisse pas une appli web écrire
  directement dans Photos ; la feuille de partage s'ouvre, et **Enregistrer l'image** l'y met
  (l'appli l'explique la première fois). Plusieurs photos : **Enregistrer N images**, par paquets
  de 20. Sur Android, les photos vont directement dans la galerie (album « SOHRI »).
- Les mises à jour arrivent toutes seules : quand une nouvelle version est en ligne, un bandeau
  « Mettre à jour » s'affiche dans l'appli (il faut Internet à ce moment-là).
- Supprimer l'icône de l'écran d'accueil efface les données de l'appli : faire une sauvegarde avant.
- La navigation privée de Safari n'enregistre pas les fichiers (photos, documents) : utiliser
  l'appli installée.
- Il faut un iOS récent (16.4 ou plus). La version web marche aussi dans Chrome sur Android ou sur
  un ordinateur.

## Écrire une note

La barre en bas de l'éditeur met en forme sans connaître la syntaxe : 😀 emoji, **B** gras,
*I* italique, ~~S~~ barré, **H** titre, • liste, 1. liste numérotée, ☑ case à cocher, ❝ citation,
code, 🔗 lien, ― séparateur. L'onglet « Aperçu » montre le résultat.

Le texte est enregistré en [markdown](https://www.markdownguide.org/basic-syntax/) : on peut aussi
taper directement `**gras**`, `# Titre`, `- [ ] à faire`… Dans une liste, « Entrée » prépare
l'élément suivant ; « Entrée » sur un élément vide termine la liste. Dans une note affichée, les
cases se cochent d'un simple toucher.

## Documents

Le bouton **+** ajoute un ou plusieurs fichiers (depuis le téléphone, Google Drive…) dans le dossier
ouvert. Toucher un fichier l'affiche dans l'appli :

| Type                                  | Affichage                                                              |
|---------------------------------------|------------------------------------------------------------------------|
| **PDF**                               | pages à faire défiler, zoom à deux doigts, double toucher ou boutons + / − ; texte japonais compris |
| **Images** (JPG, PNG, GIF, WebP…)     | zoom à deux doigts, double toucher ou boutons + / −                    |
| **Vidéos** (MP4, WebM…)               | lecteur intégré, plein écran possible                                  |
| **Sons** (MP3, M4A, WAV, OGG…)        | lecteur intégré                                                        |
| **Textes** (TXT, CSV…) et **Markdown** | texte (encodages japonais reconnus) ou mis en forme                   |
| Autres (Word, Excel, HEIC…)           | bouton « Ouvrir avec une autre appli »                                 |

Le menu ⋮ d'un fichier permet de le partager, de l'ouvrir avec une autre appli, de l'enregistrer
ailleurs, de le renommer, de le déplacer ou de le supprimer. Les pièces jointes des notes et des
adresses s'ouvrent dans la même visionneuse.

## Programme du voyage

**+** ajoute une étape : son nom (« Shinkansen pour Kyoto »), son type (vol, train, transport,
hébergement, repas, visite, activité, shopping…), sa date, son heure et celle de fin
(facultatives), son lieu (une adresse du carnet), des notes (mise en forme, cases à cocher) et des
billets : fichiers du téléphone, ou **📂 Depuis Documents** (une copie). La date proposée est celle
de la dernière étape ajoutée : on prépare souvent le voyage dans l'ordre. Depuis la fiche d'un lieu
(menu ⋮), **Ajouter au programme** remplit déjà le lieu, le nom et le type ; la fiche montre aussi
les étapes qui s'y passent.

La liste montre les jours (« Jour 3 · Jeudi 15 octobre »), avec, en haut, le compte à rebours avant
le départ puis, pendant le voyage, l'étape en cours et la suivante. Toucher un jour ouvre la
journée : une carte par étape, avec pour le lieu **🧭 Itinéraire**, **🚕 Pour le taxi** (adresse en
japonais en grand), **📞 Appeler**, les notes et les billets ; ‹ › passe au jour d'avant ou
d'après. Le jour même (« Aujourd'hui »), l'étape en cours est encadrée, celles passées s'estompent
et la suivante annonce « À suivre · dans 1 h 20 » (mis à jour chaque minute) ; la météo du jour
s'affiche si la ville de la rubrique Météo la connaît. Dates et heures sont celles du téléphone,
qui passe à l'heure du Japon sur place.

Le programme fait partie des sauvegardes et de « Synchroniser toutes mes rubriques », et peut être
partagé avec ses proches (voir plus bas).

## Dépenses

**+** note un achat : montant en yens ou en euros (le choix convertit le montant déjà tapé),
catégorie, libellé facultatif (« Ramen Ichiran »), date et heure (maintenant, au départ). Chaque
dépense garde le taux du jour où elle a été notée : changer de taux plus tard ne modifie pas les
totaux passés. Dans le convertisseur, 🧾 ouvre une dépense déjà remplie avec le montant (ou le
total des prix additionnés avec ＋). Toucher une dépense la modifie ou la supprime ; le menu ⋮
exporte toutes les dépenses en tableau (`SOHRI-depenses-AAAA-MM-JJ.csv`, colonnes séparées par
« ; » et virgule décimale, comme l'attendent les tableurs en français).

Les dépenses font partie des sauvegardes, et de « Synchroniser toutes mes rubriques ».

## Sauvegarder ses données

Paramètres → **Créer une sauvegarde** enregistre tout (programme, notes, adresses, dépenses, images, documents, pièces jointes) dans
un fichier `SOHRI-sauvegarde-AAAA-MM-JJ.zip`, à ranger par exemple sur Google Drive ou iCloud Drive.
**Restaurer une sauvegarde** remplace alors toutes les données de l'appli par celles du fichier. Une
sauvegarde faite sur Android se restaure sur l'iPhone, et inversement, même si le fichier a été
transformé en route : sur l'iPhone, toucher un `.zip` dans l'app Fichiers le décompresse en
dossier, et envoyer ce dossier en refait un zip compressé ; SOHRI le lit aussi. Il faut seulement
le zip entier (pas le fichier `sohri.json` seul, qui ne contient pas les photos).

À faire avant le départ et de temps en temps pendant le voyage : désinstaller l'appli, ou
« Vider le stockage » dans les paramètres Android (sur iPhone : supprimer l'icône), efface tout.
Les Paramètres indiquent la date de la dernière sauvegarde faite sur ce téléphone ; au bout de
7 jours sans sauvegarde, un bandeau le rappelle (**Sauvegarder** la fait tout de suite, × le
repousse de 3 jours). Pas de rappel quand toutes les rubriques sont synchronisées avec un compte.

**Rapport de diagnostic** (Paramètres → Aide) : un texte à envoyer (WhatsApp, e-mail…) à la
personne qui aide quand quelque chose ne marche pas : version de l'appli, téléphone, nombre de
notes, d'adresses…, place occupée, état de la synchronisation et derniers messages d'erreur. Il
ne contient jamais le contenu : ni texte, ni photo, ni adresse e-mail.

## Partager avec ses proches (facultatif)

Sans compte, rien ne change : l'appli reste entièrement hors connexion. Avec un compte (menu
**Partage**), on choisit quelles rubriques montrer, et à qui : les **Images** (albums et photos,
que les proches peuvent commenter), et, en lecture seule, le **programme**, le **carnet
d'adresses**, les **notes** et les **documents** (voir « Programme, adresses, notes et documents »).
Les dépenses ne sont jamais montrées.

1. **Créer un compte** : prénom (ce que voient les proches), adresse e-mail et mot de passe (pour se
   connecter ; l'adresse n'est montrée à personne), et **code d'invitation** : le code d'un proche
   déjà inscrit. Seul le tout premier compte n'en a pas besoin.
2. Chaque compte a un **code** (par exemple `K7F2-9QX4`) : **Inviter** l'envoie par SMS, WhatsApp,
   e-mail… Un proche inscrit avec ce code arrive tout seul dans les contacts ; sinon, **Ajouter un
   contact** avec son code.
3. **Ce que je partage → Images** : cocher les proches qui peuvent voir les albums. Les photos
   partent réduites (1600 pixels) vers le serveur, dans l'ordre, dès qu'il y a Internet ; les
   ajouts, suppressions et changements de nom suivent tout seuls.
4. Chez le proche, en haut de la rubrique **Images**, un bandeau **Mes proches** (façon
   « stories ») montre ceux qui lui partagent leurs photos : leur photo la plus récente en rond,
   avec un anneau de couleur et « 3 nouvelles » s'il y en a depuis sa dernière visite, et 💬 pour
   les nouveaux commentaires. Un appui ouvre leurs albums. Ils sont copiés sur son téléphone et
   restent consultables **hors connexion** ; les nouveautés arrivent quand il ouvre l'appli avec
   Internet. Tout ce qui concerne les photos est dans **Images** ; **Partage** ne sert qu'au
   compte, aux contacts et à choisir qui voit quoi.

Ça marche entre la version web (iPhone) et l'appli Android : le compte est le même partout.

**Mes appareils.** Dès que les Images sont partagées avec au moins un proche (ou que toutes les
rubriques sont synchronisées, voir plus bas), elles sont les mêmes
sur tous les appareils connectés au compte (iPhone, Android, les deux à la fois). Chacun peut
ajouter des photos, écrire une description, déplacer, renommer ou supprimer, et les autres
reprennent ces changements à leur synchronisation. Un appareil qui se connecte pour la première
fois fusionne ses Images avec celles du compte, sans rien effacer : ce qui n'est que sur lui part,
ce qui n'est qu'en ligne arrive. Une photo n'est supprimée partout que si on la supprime sur un des
appareils. Les photos venues d'un autre appareil sont des copies réduites (1600 pixels), comme
celles des proches. Une photo supprimée sur un appareil, mais modifiée sur un autre entre-temps
(description, lieu, album), revient ; un album supprimé revient s'il a été renommé ailleurs, ou si
une photo y a été ajoutée ailleurs (avec elle seule) : rien ne se perd.

### Programme, adresses, notes et documents

Partage → **Ce que je partage** → **Programme**, **Carnet d'adresses**, **Notes** ou **Documents**
→ cocher les proches. Ils les voient **en lecture seule**, en haut des rubriques du même nom dans
leur appli (« De mes proches » : « Programme de Sohhka »…), copiés sur leur téléphone pour être
consultés **même sans connexion** ; ils ne peuvent rien y changer.

- Ces rubriques partent de « Synchroniser toutes mes rubriques » : au premier partage, si elle
  n'est pas activée, l'appli propose de le faire. Tout reste visible de soi seul, sauf ce qu'on
  partage ; les **dépenses** ne sont jamais montrées.
- Le programme emporte le lieu de chaque étape (nom, adresse, adresse en japonais, téléphone) :
  l'itinéraire et la carte pour le taxi marchent chez le proche, même sans lui partager tout le
  carnet d'adresses. Partager aussi le carnet ajoute la fiche complète (description, pièces jointes).
- Les notes et les documents gardent leurs dossiers ; photos, billets et pièces jointes sont
  téléchargés une fois (ceux de plus de 15 Mo, seulement à leur ouverture).
- Les changements (étape modifiée, adresse ajoutée, note supprimée…) arrivent chez le proche à sa
  prochaine synchronisation. Ne plus partager une rubrique la retire de son téléphone ; arrêter
  « Synchroniser toutes mes rubriques » arrête ces partages (pas celui des Images).
- Il faut la version 2.4 chez les deux.

### Toutes mes rubriques sur tous mes appareils

Partage → **Mes appareils** → **Synchroniser toutes mes rubriques** : le programme, les notes (avec
leurs photos et pièces jointes), le carnet d'adresses, les dépenses, les documents, leurs dossiers
et les Images sont alors les mêmes sur tous les appareils connectés au compte. Le réglage vaut pour le compte : on l'active une
fois, sur n'importe quel appareil, et les autres s'y mettent à leur prochaine synchronisation.

- Il faut Internet, et être connecté au même compte. Chaque appareil envoie ses changements et
  reçoit ceux des autres tout seul (à l'ouverture de l'appli, au retour d'Internet, quelques
  secondes après une modification) ; la flèche ⟳ de l'écran Partage le fait tout de suite. Dans
  le menu, à côté de « Partage » : ✓ à jour, ⟳ en cours, 📴 hors connexion (les changements
  partiront au retour d'Internet), ⚠️ problème (avec un point orange sur ☰).
- La première fois, rien n'est effacé : ce que chaque appareil a déjà est réuni. Une même note
  présente des deux côtés (par exemple après une sauvegarde restaurée sur les deux) n'est gardée
  qu'une fois, dans sa version la plus récente.
- Ensuite, un ajout, une modification, un renommage, un déplacement ou une suppression faits sur
  un appareil arrivent sur les autres. Une même note modifiée sur deux appareils avant qu'ils se
  synchronisent : la modification la plus récente l'emporte. Une note supprimée sur un appareil
  mais modifiée sur un autre entre-temps est gardée : rien ne se perd. Deux appareils qui envoient
  en même temps ne s'écrasent pas : le serveur refuse l'envoi de celui qui n'a pas vu le dernier
  changement, qui relit et renvoie aussitôt (pour les Images aussi : la description changée sur
  l'un et le lieu ajouté sur l'autre sont tous deux gardés).
- Les fichiers (photos des notes, pièces jointes, documents) ne partent qu'une fois, même s'ils
  servent à plusieurs endroits. Un fichier de plus de 60 Mo reste seulement sur l'appareil où il
  est (l'écran Partage le signale). Les photos des Images arrivent réduites (1600 pixels) sur les
  autres appareils ; notes, adresses et documents arrivent tels quels.
- Ce qui est en ligne n'est visible que de soi, sauf les rubriques qu'on partage (voir plus haut).
  Les réglages (thème, taux, ville de la météo) restent propres à chaque appareil.
- **Arrêter** (décocher) efface la copie en ligne, sauf les Images si elles sont partagées ;
  chaque appareil garde tout ce qu'il a.
- Tous les appareils du compte doivent avoir la version 2.1 ou plus récente ; le programme est
  synchronisé à partir de la 2.4 (un appareil mis à jour reçoit alors tout ce qui est déjà en
  ligne).

### Descriptions, lieux et commentaires (façon Instagram)

- **Description et lieu** (📍, par exemple « Tokyo, Japon ») : tous deux facultatifs. Quand on
  ajoute une seule photo, sa fiche s'ouvre pour les écrire (« Plus tard » pour passer) ; sinon, dans
  la visionneuse, le bouton en bas de la photo ouvre sa fiche (« ✏️ Ajouter une description »). Le
  lieu s'affiche au-dessus de la description ; le toucher l'ouvre dans Google Maps. Ça marche aussi
  sans compte ; si les Images sont partagées, les proches les voient sous la photo.
- **Commentaires** : sur une photo partagée, tous ceux qui la voient peuvent commenter (bouton
  « 💬 Commenter » sous la photo). **Répondre** prépare « @Prénom ». Chacun supprime ses propres
  commentaires ; le propriétaire des photos peut supprimer n'importe lequel des leurs.
- **Nouveautés** : point rouge sur ☰ et pastille « 💬 » sur Images dans le menu (mes photos et
  celles des proches), liste **Nouveaux commentaires** tout en haut de la rubrique Images (quand
  il y en a), pastille sur le proche dans le bandeau, sur la couverture de l'album et sur la
  photo, et un message quand l'appli en reçoit. (Pas de notification quand l'appli est fermée.)
- **Plusieurs appareils** : les commentaires de mes photos se lisent et s'écrivent sur chacun de mes
  appareils.
- **Hors connexion** : un commentaire écrit sans réseau part tout seul au retour d'Internet
  (« ⏳ envoi au retour d'Internet ») ; les commentaires reçus restent lisibles sans réseau.
- Supprimer une photo efface aussi ses commentaires ; arrêter le partage des Images efface les
  photos **et** les commentaires du serveur (seulement les commentaires si toutes les rubriques
  sont synchronisées : les photos restent pour mes appareils).

À savoir :

- Seules les rubriques partagées (ou synchronisées entre mes appareils) quittent le téléphone.
  Arrêter tous les partages d'une rubrique efface ses photos du serveur (chaque appareil garde les
  siennes, et celles déjà reçues des autres) ; **Supprimer mon compte** efface tout ce qui est en
  ligne (les données du téléphone restent).
- Serveur : Firebase (Google), formule gratuite, sans carte bancaire : 1 Go pour tout le monde
  (photos partagées et rubriques synchronisées), soit environ 3 000 photos partagées. Au-delà, les
  nouveaux envois sont refusés (aucune facture possible). L'écran Partage montre l'**espace en
  ligne** occupé (« Toi et tes proches : environ 250 Mo sur 1 Go »), avec la part de chacun :
  chaque compte le mesure une fois par jour (ou « Mesurer maintenant ») ; un avertissement
  s'affiche à partir de 80 %.
- **Se déconnecter** (bouton en bas de l'écran Partage) retire du téléphone ce que les proches y
  avaient partagé et ce qui vient des autres appareils du compte (photos, notes…) ; tout revient à
  la reconnexion. Ce qui a été ajouté sur ce téléphone y reste, comme ce qui y a été modifié sans
  avoir encore pu partir.
- Les appareils du compte doivent avoir la version 1.7 ou plus récente : les anciennes versions
  n'envoient plus rien (elles ne connaissaient qu'un seul appareil d'envoi).

## Organisation du dossier

```
Sohri/
├── www/                     L'appli elle-même (HTML, CSS, JavaScript) : c'est ici qu'on la modifie
│   ├── index.html           toutes les vues
│   ├── css/style.css        styles, thèmes clair et sombre
│   ├── manifest.webmanifest version web : nom, icônes, plein écran
│   ├── sw.js                version web : copie hors connexion et mises à jour (service worker)
│   ├── icons/               icônes de la version web (écran d'accueil de l'iPhone...)
│   └── js/
│       ├── diagnostic.js    derniers messages d'erreur, pour le rapport de diagnostic (chargé en premier)
│       ├── db.js            stockage local (IndexedDB)
│       ├── ui.js            boîtes de dialogue, menus du bas, visionneuse photo, carte taxi
│       ├── router.js        navigation entre les vues (bouton ←, retour d'Android)
│       ├── emoji.js         sélecteur d'emojis
│       ├── markdown.js      affichage mis en forme et barre de mise en forme
│       ├── files.js         photos, pièces jointes, envoi de fichiers à Android ou à la
│       │                    feuille de partage de l'iPhone
│       ├── docviewer.js     visionneuse de documents (PDF, image, vidéo, son, texte)
│       ├── folders.js       dossiers (notes, documents) et albums
│       ├── converter.js     convertisseur ¥ ⇄ € (taux du jour, addition de prix) et heures du
│       │                    Japon et de la France
│       ├── expenses.js      Dépenses : totaux, catégories, export CSV
│       ├── weather.js       Météo & heure : heure par heure et semaine (Open-Meteo)
│       ├── notes.js         notes
│       ├── addresses.js     carnet d'adresses
│       ├── schedule.js      Programme du voyage : jours, étapes, écran « Aujourd'hui »
│       ├── phrases.js       Phrases utiles (japonais, en grand) et numéros d'urgence
│       ├── gallery.js       Images : albums et photos
│       ├── documents.js     Documents : fichiers et dossiers
│       ├── backup.js        sauvegarde et restauration (.zip)
│       ├── settings.js      Paramètres (rappel de sauvegarde, rapport de diagnostic)
│       ├── cloud.js         partage : comptes, contacts, envoi et réception, espace en ligne
│       │                    (API de Firebase)
│       ├── sync.js          toutes mes rubriques sur tous mes appareils (programme, notes,
│       │                    adresses, dépenses, documents)
│       ├── sharing.js       partage : écrans (compte, contacts, mes appareils, espace en ligne),
│       │                    témoin de synchronisation dans le menu
│       ├── shared-items.js  programme, adresses, notes et documents de mes proches (lecture
│       │                    seule, gardés hors connexion)
│       ├── comments.js      fiche d'une photo : description et commentaires
│       ├── cloud-config.js  projet Firebase (local, jamais dans le dépôt : voir plus bas)
│       ├── app.js           menu, bouton retour, version web (hors connexion, mises à jour,
│       │                    clavier de l'iPhone), démarrage
│       └── vendor/          bibliothèques : marked (markdown, licence MIT),
│                            pdf.js de Mozilla (PDF, licence Apache 2.0)
├── android/                 Projet Android qui emballe www/ dans une appli
│   ├── app/src/main/java/com/sohri/app/MainActivity.java
│   ├── app/src/main/res/    icône, couleurs, nom de l'appli
│   ├── app/build.gradle.kts numéro de version, SDK, dépendances
│   └── keystore/            clé de signature : À CONSERVER (voir plus bas), jamais sur GitHub
├── firebase/                partage : règles de sécurité de la base (firestore.rules), réglages
│                            de l'émulateur pour les essais (firebase.json)
├── tests/                   tests automatiques (voir « Tests » et tests/README.md)
├── tools/build-web.js       prépare la version web dans _site/ (liste des fichiers hors connexion)
├── .github/workflows/       mise en ligne automatique de la version web (GitHub Pages)
├── dist/                    APK générés
├── build-apk.bat            double-clic : construit l'APK
└── build-apk.ps1            script appelé par build-apk.bat
```

## Modifier l'appli

1. Modifier les fichiers de `www/`. Pour un essai sur PC : `node tools/build-web.js`, puis
   `npx serve _site` et ouvrir l'adresse indiquée dans Chrome (les fonctions propres à Android,
   comme le bouton retour, n'y sont pas).
2. **iPhone** : envoyer les modifications sur GitHub (`git commit`, puis `git push`). GitHub met la
   version web à jour tout seul en une minute environ (onglet « Actions » du dépôt) ; l'iPhone
   propose ensuite « Mettre à jour ».
3. **Android** : augmenter `versionCode` (et `versionName`) dans `android/app/build.gradle.kts`,
   double-cliquer `build-apk.bat` (le nouvel APK arrive dans `dist/`) et l'installer par-dessus
   l'ancien.

Le nom affiché sous l'icône se trouve dans `android/app/src/main/res/values/strings.xml`. Avec un
téléphone branché en USB (débogage USB activé), `build-apk.ps1 -Install` construit et installe
directement.

## Tests

Le dossier `tests/` vérifie l'appli entière dans de vrais navigateurs : Chrome (avec une appli
Android simulée) et le moteur de Safari (iPhone), plus les règles du serveur sur l'émulateur
Firebase, lancé et arrêté tout seul. Une fois installé (`cd tests`, `npm install`, puis
`npm run setup`) :

```
cd tests
npm test            (tous les tests)
node run.js 13 15   (seulement certains)
```

Le détail (installation, liste des tests, captures d'écran produites) est dans `tests/README.md`.
À lancer avant chaque nouvelle version.

## ⚠ La clé de signature

`android/keystore/` contient la clé qui signe l'APK (`sohri-release.jks`, mots de passe dans
`keystore.properties`). Android n'accepte une mise à jour que si elle est signée avec la même clé.
Si elle est perdue, il faudra désinstaller l'appli pour installer une nouvelle version, et donc
perdre toutes les données (sauf sauvegarde).

Ce dossier est dans OneDrive, donc sauvegardé. Ne pas le supprimer et ne pas le partager : il est
exclu du dépôt GitHub (`.gitignore`), qui est public.

## Compiler sur un autre PC

`build-apk.ps1` trouve tout seul :

- un **JDK 17 ou plus récent** (ici Microsoft OpenJDK 21, installé avec Visual Studio) ;
- le **SDK Android** avec `platforms;android-36` et `build-tools;36.0.0` (ici celui de Visual
  Studio, dans `C:\Program Files (x86)\Android\android-sdk`). Sur un autre PC, le plus simple est
  d'installer Android Studio.

Gradle se télécharge tout seul au premier lancement (dans `%USERPROFILE%\.gradle`). Comme le
projet est dans OneDrive, les fichiers de compilation temporaires sont placés dans
`%LOCALAPPDATA%\Sohri`, hors synchronisation. On peut supprimer ce dossier sans risque.

## Fonctionnement technique

`MainActivity` affiche `www/` dans une WebView, servi localement à l'adresse
`https://appassets.androidplatform.net/` (`WebViewAssetLoader`). Les données sont dans IndexedDB
(magasins `notes`, `addresses`, `expenses`, `schedule` pour le programme, `settings`, `folders`
pour les dossiers et les albums, `photos`, `documents` pour la description des fichiers et
`documentFiles` pour leur contenu ; pour le partage, hors sauvegardes : `cloud`, `sharedAlbums`,
`sharedPhotos`, `sharedComments`, et `sharedItems` / `sharedFiles` pour les rubriques reçues des
proches et leurs fichiers).

Les images (photos, miniatures, pièces jointes) y sont des `Blob`. Safari a un défaut : une image
lue dans la base puis réenregistrée telle quelle (description modifiée, photo reçue en grand
ajoutée à sa fiche…) peut devenir illisible à la lecture suivante, pendant quelques secondes. On
voit alors un carré bleu « ? » à la place de la vignette. `dbPut` enregistre donc toujours des
copies en mémoire des images (`detachBlobs`, `db.js`). Par précaution, une image qui ne s'affiche
pas est relue dans la base, ou téléchargée de nouveau, au lieu de montrer l'icône d'image cassée
(`healingImage`, `ui.js`).

L'appli Android ajoute ce qu'une WebView ne fait pas seule :

| Côté Android                               | Côté page (`window.AndroidBridge` et fonctions globales)                  |
|--------------------------------------------|---------------------------------------------------------------------------|
| sélecteur de photos, sélecteur de fichiers | `<input type="file">`                                                     |
| ouverture de liens (Maps, site, téléphone) | `openExternal(url)`                                                       |
| ouvrir / partager / « enregistrer sous » / photo dans la galerie (album SOHRI) | `fileBegin(nom, type)`, `fileAppend(id, base64)`, `fileFinish(id, action)` (action : `open`, `share`, `save`, `gallery`) |
| presse-papiers                             | `copyText(texte)`                                                         |
| envoi d'un texte (invitation au partage)   | `shareText(texte)`                                                        |
| thème choisi et thème du téléphone         | `getThemePreference()`, `setThemePreference()`, `isSystemDark()` ; `onSystemThemeChanged(sombre)` |
| barres système et clavier                  | `getSafeAreaInsets()` ; `setSafeAreaInsets(haut, droite, bas, gauche)` → variables CSS `--safe-*` |
| vidéo en plein écran                       | bouton ⛶ du lecteur vidéo (`onShowCustomView`)                            |
| bouton retour                              | `handleBackButton()` (true = géré par la page)                            |
| version                                    | `getAppVersion()`                                                         |

### Version web (iPhone)

Les mêmes fichiers `www/` sont publiés sur GitHub Pages par `.github/workflows/pages.yml` à chaque
`git push` qui les modifie. Avant la mise en ligne, `tools/build-web.js` copie `www/` dans `_site/`
et écrit dans `sw.js` la liste des fichiers et un numéro de version tiré de leur contenu.

Sans `window.AndroidBridge`, la page s'adapte (classe `is-web` sur `<html>`) :

- `sw.js` (service worker) copie tous les fichiers de l'appli au premier lancement, puis les sert
  depuis cette copie : l'appli démarre et affiche les PDF sans connexion. Quand le numéro de
  version change, la nouvelle copie se prépare en arrière-plan et un bandeau propose de recharger ;
- les fichiers à ouvrir, partager ou enregistrer passent par la feuille de partage du système
  (`navigator.share`) ; si la préparation a été trop longue, l'iPhone exige un nouveau toucher :
  une boîte « … est prêt » le demande. Sur ordinateur : nouvel onglet ou téléchargement ;
- le clavier de l'iPhone recouvre la page au lieu de la réduire : l'appli suit la partie visible
  de l'écran (`visualViewport` → variables CSS `--app-height`, `--app-top`) ;
- appli installée sur l'écran d'accueil (classe `ios-standalone`) : la barre d'état est
  transparente, une bande foncée la garde lisible ;
- le thème choisi est gardé dans `localStorage`.

### Partage (Firebase)

`cloud.js` utilise directement l'API web de Firebase (Authentication pour les comptes, Firestore
pour les données), sans bibliothèque. En ligne, chacun a son espace `users/{id}` (nom, code,
contacts, et ses albums partagés : `albums`, `photos` avec la miniature, la description et le lieu,
`photoParts` pour la photo en morceaux de moins de 1 Mo, `comments` pour les commentaires de ses
photos, écrits par lui ou ses proches) ; `grants/{propriétaire}_{proche}` liste les rubriques qu'un
membre montre à un proche. Les suppressions laissent une trace datée : chaque téléphone ne demande
que ce qui a changé depuis sa dernière visite. Les commentaires écrits hors connexion attendent dans
le magasin `sharedComments` (`pending`) jusqu'au retour du réseau.

Avec « Synchroniser toutes mes rubriques » (champ `syncAll` du profil), `sync.js` ajoute, visibles
du seul propriétaire (sauf les rubriques qu'il partage) : `items` (une note, une adresse, une
dépense, une étape du programme, un dossier ou un document, décrit en JSON,
avec les empreintes de ses fichiers ; identifiant tiré de sa date de création, le même sur tous
les appareils), `blobs` (un fichier, nommé par son empreinte SHA-256 : un contenu identique n'est
envoyé qu'une fois) et `blobParts` (ses morceaux de moins de 1 Mo). Chaque appareil garde, dans
le magasin `cloud`, l'empreinte de chaque élément au dernier échange : ce qui n'a changé qu'ici
part, ce qui n'a changé qu'ailleurs arrive, et, changé des deux côtés, le plus récent l'emporte.
Une fois par jour, les fichiers en ligne dont plus aucun élément n'a besoin sont effacés.

Les envois (rubriques comme Images) sont **conditionnels** : chaque écriture porte la version du
document au dernier échange (`currentDocument.updateTime`, ou « n'existe pas encore » pour un
ajout). Si un autre appareil l'a changé entre-temps, le serveur refuse l'envoi
(`FAILED_PRECONDITION`) ; la synchronisation relit alors les changements et renvoie aussitôt.
Une fois par jour, chaque compte additionne la taille de ce qu'il a en ligne et l'inscrit dans
son profil (`usageBytes`, `usageAt`), lisible par ses proches : c'est l'« espace en ligne » de
l'écran Partage.

Partage du programme, des adresses, des notes et des documents : le document `grants/…` liste
aussi `schedule`, `addresses`, `notes` ou `documents`. Le proche lit alors, dans `items`, les
éléments de ces types (requête par type : `kind == 'event'`…, les dossiers allant avec les notes
et les documents), et chaque fichier un par un par son empreinte (`blobs`, `blobParts` : jamais
leur liste). `shared-items.js` liste les dates de modification, télécharge ce qui a changé et
retire ce qui n'est plus partagé. Une étape du programme porte une copie de son lieu (`place` :
nom, adresse, adresse en japonais, téléphone), recalculée à chaque envoi.

**Qui peut faire quoi** est décidé par le serveur, dans `firebase/firestore.rules` : chacun n'écrit
que chez lui, ne lit que ce qu'on lui a partagé, et l'inscription demande le code d'un membre.
Pour les installer après une modification (une fois connecté avec `npx firebase-tools login`) :

```
npx firebase-tools deploy --only firestore --config firebase/firebase.json --project <identifiant du projet>
```

(`--only firestore` installe aussi `firebase/firestore.indexes.json`, qui évite d'indexer le
contenu des photos, des fichiers et des éléments synchronisés.)

**Configuration** : `www/js/cloud-config.js` (`window.SOHRI_CLOUD = { apiKey, projectId }`) est
exclu du dépôt. En local, il sert à construire l'APK ; pour le site, GitHub l'écrit à partir du
secret `SOHRI_CLOUD_CONFIG` du dépôt (`{"apiKey": "...", "projectId": "..."}`). Cette clé n'est pas
un secret au sens strict (elle est visible dans toute appli web Firebase, et dans l'APK) : elle
identifie le projet, et ce sont les règles ci-dessus qui protègent les données. Sans ce fichier, la
rubrique Partage est simplement masquée.

**Essais** sans toucher au vrai projet : l'émulateur Firebase (il faut Java 21, par exemple celui
installé avec Android Studio) : `npx firebase-tools emulators:start --only auth,firestore --project
demo-sohri --config firebase/firebase.json`, puis, dans la page,
`window.SOHRI_CLOUD = { apiKey: 'demo', projectId: 'demo-sohri', emulator: { auth:
'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } }` avant le chargement des scripts.
