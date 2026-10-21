# Minute

Enregistre une réunion, la transcrit (Groq Whisper), la résume (Groq, modèle `openai/gpt-oss-120b`) et sauvegarde le tout, sans rien copier ni envoyer à la main.

Historique des décisions, patterns et erreurs corrigées : voir [`JOURNAL.md`](JOURNAL.md) (mis à jour à chaque modification).

## Où est quoi

| Dossier | Rôle |
|---|---|
| `core/` | TypeScript pur (aucun import React Native) : client Groq, file d'attente, découpage du texte (`chunking`) et de l'audio (`audioSplit`), repères de temps (`timestamps`), recherche et questions (`search`, `ask`), prompts. Réutilisable dans une appli Mac. |
| `services/` | Modules Expo : SQLite, enregistreur, pipeline, import, découpage de fichiers (`splitAudio`), export audio, questions à l'IA, notifications, récupération des orphelins. |
| `app/` | Écrans (Expo Router) : accueil (avec recherche), détail, questions à l'IA (`ask`), réglages, et les routes `record` / `stop` des raccourcis. |
| `components/`, `hooks/`, `theme/` | Boutons, liste, couleurs clair/sombre. |
| `tests/` | Tests de `core/` : `npm test`. |

Réglages à modifier dans `core/config.ts` : noms des modèles, `ROTATION_MINUTES` (60 par défaut, mettez `2` pour tester), limite de 24 Mo (`MAX_FILE_MB`), taille des morceaux découpés (`SPLIT_TARGET_MB`), limite d'import (`MAX_IMPORT_MB`), taille des tranches de résumé (`CHUNK_TOKENS`).

## Dépendances (toutes expliquées)

Celles que vous avez demandées : `expo-audio`, `expo-sqlite`, `expo-file-system`, `expo-secure-store`, `expo-notifications`, `expo-document-picker`, `expo-haptics`, `expo-linking`, `expo-share-intent`.

Ajoutées, avec la raison :
- `expo-clipboard` : indispensable pour le bouton « Copier en Markdown ».
- `expo-asset` : `expo-audio` exige qu'il soit installé directement (vérifié par `expo-doctor`).
- `expo-router`, `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `react-native-screens`, `react-native-safe-area-context` : le socle d'Expo Router.

## Étapes pas à pas

### 1. Créer la clé Groq
1. Allez sur https://console.groq.com et créez un compte (gratuit).
2. Menu **API Keys** → **Create API Key** → donnez un nom → copiez la clé (`gsk_...`). Elle ne s'affiche qu'une fois.
3. Vous la collerez dans l'appli, écran **Réglages**.

### 2. Installer les outils (une seule fois)
1. **Node.js** : téléchargez la version LTS sur https://nodejs.org et installez-la. Vérifiez dans le Terminal : `node -v`.
2. **Xcode** : installez-le depuis l'App Store (plusieurs Go, comptez du temps). Ouvrez-le une fois et acceptez la licence, puis dans le Terminal :
   ```
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```
3. **CocoaPods** (nécessaire pour compiler) :
   ```
   brew install cocoapods
   ```
4. Dans Xcode : menu **Xcode → Settings → Accounts → +** → ajoutez votre **Apple ID**.

### 3. Préparer le projet
Le projet est déjà créé et ses dépendances installées. Dans le Terminal (gardez les guillemets, le chemin contient des espaces) :
```
cd "/Users/kamfal/Desktop/TOOL PERSO /rdv notes app/MiniGranola"
npm install
```

**Changez l'identifiant de l'appli** : ouvrez `app.json` et remplacez `com.CHANGEZMOI.minigranola` par quelque chose d'unique, par exemple `com.kamfal.minigranola` (minuscules, sans espace). Avec un Apple ID gratuit, un identifiant déjà pris par quelqu'un d'autre est refusé.

### 4. Brancher l'iPhone et activer le Mode développeur
1. Branchez l'iPhone au Mac avec un câble, déverrouillez-le, touchez **Se fier** si demandé.
2. Sur l'iPhone : **Réglages → Confidentialité et sécurité → Mode développeur** → activez-le → l'iPhone redémarre → confirmez. (Si l'option n'apparaît pas, faites d'abord l'étape 5 une fois : elle apparaît après une première tentative d'installation.)

### 5. Générer le projet natif et choisir votre Apple ID
```
npx expo prebuild --platform ios --clean
open ios/MiniGranola.xcworkspace
```
Dans Xcode :
1. Colonne de gauche, cliquez sur **MiniGranola** (icône bleue) → cible **MiniGranola** → onglet **Signing & Capabilities**.
2. Cochez **Automatically manage signing**, choisissez votre **Team** (votre Apple ID, « Personal Team »).
3. Faites la même chose pour la cible **ShareExtension** (menu des cibles à gauche de l'éditeur). C'est elle qui ajoute MiniGranola au menu Partager.
4. Si Xcode refuse la capacité **App Groups** avec un compte gratuit : voir « Problèmes possibles » plus bas.

### 6. Lancer l'appli sur l'iPhone
```
npx expo run:ios --device
```
Choisissez votre iPhone dans la liste. La première compilation est longue (10 à 20 minutes). L'appli s'installe et s'ouvre.

### 7. Faire confiance au profil (première fois)
Si l'iPhone dit « Développeur d'entreprise non approuvé » : **Réglages → Général → VPN et gestion de l'appareil** → touchez votre Apple ID → **Faire confiance**. Relancez l'appli.

### 8. Premier essai
1. Ouvrez Minute → **Réglages** → collez la clé Groq → **Enregistrer**.
2. Écran d'accueil → bouton rouge → acceptez le micro → parlez 30 secondes → bouton carré pour arrêter.
3. La réunion apparaît avec le statut « Transcription… » puis « Synthèse… » puis « Terminé » ; une notification vous prévient. Vous pouvez verrouiller l'iPhone ou quitter l'appli pendant ce temps.

Avec un Apple ID gratuit, l'appli expire au bout de **7 jours** : rebranchez l'iPhone et relancez `npx expo run:ios --device` pour la réinstaller (vos données restent).

## Raccourcis iOS et bouton Action

L'appli répond à `minigranola://record` et `minigranola://stop`.

1. Ouvrez l'app **Raccourcis** → **+** (nouveau raccourci).
2. **Ajouter une action** → cherchez **Ouvrir des URL** (« Open URLs ») → saisissez `minigranola://record` → nommez le raccourci « Enregistrer ».
3. Recommencez avec `minigranola://stop` → « Arrêter ».
4. **Réglages → Bouton Action → Raccourci** → choisissez « Enregistrer » (ou « Arrêter »).
   Astuce : un seul raccourci avec l'action **Choisir dans le menu** (Enregistrer / Arrêter) permet d'utiliser le bouton pour les deux.

Limite d'iOS : le raccourci ouvre l'appli au premier plan puis démarre l'enregistrement ; iPhone verrouillé, il faudra d'abord le déverrouiller.

## Ce que contient une synthèse

- **Résumé** de 5 lignes maximum, puis **Prochaines actions** : cases à cocher, regroupées par responsable (« À attribuer » en dernier), avec échéance et minute.
- **Fil conducteur** : l'idée centrale de la réunion, avec les minutes où on y revient.
- **Sujets** détaillés en deux groupes, « Autour du fil conducteur » et « Sujets secondaires », chacun avec sa minute. Un toucher sur une minute ouvre la transcription à cet endroit (ligne surlignée).
- **Décisions**. Les anciennes réunions gardent leur ancien format : refaire une synthèse pour obtenir les nouveautés.
- La transcription est horodatée (`[12:03] texte…`, une ligne toutes les 30 s environ).

## Rechercher et interroger

- Barre de recherche sur l'accueil (titres, résumés, transcriptions, sans tenir compte des accents).
- **Poser une question à l'IA** : sur toutes les réunions ou sur une seule. Recherche par mots-clés (pas d'embeddings), environ 5 à 6 000 tokens par question ; l'historique n'est pas conservé.
- Le titre d'une réunion se renomme en le touchant ; un titre renommé n'est plus écrasé par la synthèse.

## Exporter l'audio d'origine

Sur une réunion : bouton **Exporter** (menu : Copier en Markdown, Partager le texte, Exporter l'audio) ou section **Audio original** (un bouton par fichier). La feuille de partage d'iOS s'ouvre : **Enregistrer dans Fichiers**, AirDrop, Mail, Messages...
- Une réunion de plus de 60 minutes est découpée en parties (un fichier chacune) : chaque partie s'exporte séparément, Minute ne sait pas les fusionner.
- Avec le build Xcode (pas dans Expo Go), tous les audios sont aussi visibles dans l'app **Fichiers > Sur mon iPhone > Minute**.

## Importer un enregistrement d'appel

- **Importer un audio** (écran d'accueil) : choisissez un fichier m4a, mp3, wav ou mp4.
- **Menu Partager** : dans Notes, Fichiers ou Dictaphone, ouvrez l'audio → **Partager** → **Minute**. Le traitement démarre seul.
- Au-delà de **24 Mo**, le fichier est découpé automatiquement en morceaux (m4a, mp3, wav) puis recollé ; au-delà de **150 Mo**, il est refusé.

## Tester sérieusement (liste de contrôle)

1. `ROTATION_MINUTES = 2` dans `core/config.ts`, relancez, enregistrez 7 minutes : 4 segments, une seule réunion, textes dans l'ordre.
2. Verrouillez l'écran pendant l'enregistrement : le chrono doit continuer, le point orange du micro reste visible.
3. Appel entrant pendant un enregistrement : le segment est sauvegardé, la reprise se fait après l'appel.
4. Fermez l'appli de force en plein enregistrement, rouvrez-la : les segments déjà faits sont retrouvés et traités.
5. Mode avion pendant la fin d'une réunion, puis réseau rétabli : le traitement reprend tout seul.
6. Clé incorrecte : message « Clé Groq refusée », bouton **Réessayer** après correction.

## Problèmes possibles

- **Le menu Partager (ShareExtension) ne se signe pas avec l'Apple ID gratuit** (erreur sur App Groups) : retirez-le temporairement en supprimant le bloc `expo-share-intent` de `plugins` dans `app.json`, puis relancez l'étape 5. L'import par bouton continue de marcher.
- **`expo-share-intent` 8 vise officiellement Expo SDK 57**, et ce projet est en SDK 58. Il s'installe et se configure correctement (vérifié), mais je n'ai pas pu le tester sur un iPhone.
- **Limites gratuites de Groq** : environ 12 000 tokens par minute. L'appli attend entre les morceaux d'une longue réunion et respecte l'en-tête `retry-after`. Si la limite quotidienne est atteinte, un message l'indique : réessayez plus tard avec le bouton **Réessayer**.
- **Rotation** : entre deux segments (toutes les 60 minutes), une fraction de seconde d'audio peut manquer.
- **Consentement** : enregistrer une conversation sans prévenir les participants est interdit dans de nombreux pays. Le rappel est activé par défaut dans les Réglages.
