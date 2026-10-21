# Journal de Minute

Ce fichier est mis à jour à chaque modification : décisions prises, patterns utilisés, erreurs corrigées.
Les entrées les plus récentes sont en haut de chaque section d'historique.

## Décisions

| Sujet | Décision | Raison |
|---|---|---|
| Aperçu | Expo Go (QR code) plutôt que build Xcode | Xcode non configuré sur le Mac (sudo requis) ; plus rapide à essayer. |
| SDK | Expo SDK 57 (retour depuis 58) | L'Expo Go de l'App Store ne supportait pas le SDK 58. `expo-share-intent` 8 vise aussi le 57. |
| Nom | « Minute », nom affiché seulement | On garde le schéma `minigranola://`, le slug et le bundle id pour ne pas casser les Raccourcis iOS. |
| Modèle de synthèse | `openai/gpt-oss-120b` | `llama-3.3-70b-versatile` répondait 404 sur ce compte. Limites : 8 000 tokens/min, 200 000/jour. |
| Transcription | `whisper-large-v3-turbo`, format `verbose_json` | Donne le début de chaque phrase, base des minutes. |
| Résumé long | Tranches de 4 000 tokens → notes → fusion par paquets → JSON final | Tient dans la limite de 8 000 tokens/min ; pause entre les appels. |
| Recherche / questions | Mots-clés sans accents, pas d'embeddings | Aucune dépendance ni service de plus ; suffisant pour quelques centaines de réunions. |
| Gros fichiers importés | Découpage automatique au-delà de 24 Mo (morceaux de 20 Mo), refus au-delà de 150 Mo | Limite de 25 Mo de Groq ; 150 Mo ≈ quota Whisper du jour. Pas de ffmpeg (exclu au départ). |
| Minutes | Texte horodaté `[mm:ss]` ; la synthèse copie les repères, ne les invente pas | Permet de retrouver le passage exact. |
| Synthèse | Fil conducteur + sujets « principal » / « secondaire » ; tâches toujours visibles, par responsable | Demandes de l'utilisateur (inspiration Fireflies). |
| Design | Papier #F4F6F8, encre #14213D, bleu stylo #2B3FE0 ; rouge seulement pour l'enregistrement et le danger | Éviter la palette crème/orange générique. Zones tactiles ≥ 56, espacement 4/8. |
| Hors périmètre pour l'instant | Live Activity (écran verrouillé), build Xcode réel | Nécessitent un build de développement ; non demandés. |
| Documentation | Ce journal et `LISEZMOI.md` sont mis à jour à chaque modification | Demande de l'utilisateur. |

## Patterns utilisés

- **`core/` pur** : aucun import React Native ; tout ce qui touche Expo est dans `services/`. Les dépendances externes sont injectées (`fetchFn`, `chat`, `JobStore`, `Reader`) pour tester sans téléphone.
- **File d'attente persistante** (SQLite) : jobs `transcribe` → `summarize` → `webhook`, 3 essais, `retry-after` respecté ; la synthèse attend que toutes les transcriptions soient finies.
- **Plan puis exécution** pour le découpage audio : `core/audioSplit.ts` calcule un plan (`Piece[]` de `Part`), `services/splitAudio.ts` lit et écrit par blocs de 4 Mo (jamais 20 Mo en mémoire).
- **Rétrocompatibilité des données** : champs ajoutés optionnels (`sections?`, `fil_conducteur?`, `minute?`, `role?`) ; migration SQLite par `PRAGMA table_info` + `ALTER TABLE` ; l'écran retombe sur l'ancien affichage si le champ manque.
- **Lecture tolérante du JSON du modèle** (`parseSummary`) : blocs ```json retirés, champs manquants ignorés, minutes lues sous plusieurs formes.
- **Jetons de design** (`theme/colors.ts`) : aucune couleur en dur dans les composants, variantes claire/sombre.
- **Une seule action principale par écran**, état vide avec message et action, jamais la couleur seule pour porter un sens.
- **Tests** : `npm test` (`tests/core.test.mts`, 19 tests) couvre `core/` ; l'interface n'est vérifiée que par `tsc`, `expo-doctor` et `expo export`.

## Erreurs corrigées

| Erreur | Cause | Correction |
|---|---|---|
| `create-expo-app` refuse « rdv notes app » | Nom de dossier avec espaces | Sous-dossier `MiniGranola`. |
| Conflit de dépendances npm (`expo-share-intent`) | Version visant un autre SDK | `.npmrc legacy-peer-deps=true`, `overrides`, réinstallation propre (expo-doctor 21/21). |
| Tests qui échouent (`await` au premier niveau) | Mode CommonJS | Fichier renommé `tests/core.test.mts`. |
| « Project is incompatible with this version of Expo Go » | SDK 58 trop récent | Passage au SDK 57. |
| « array of styles to a child of `<Slot>` » | Style en tableau sur un `Pressable` dans `Link asChild` | `StyleSheet.flatten`. |
| « Pas de connexion internet » alors qu'il y a du Wi-Fi | Le message masquait la vraie cause | Détail technique ajouté au message ; cause réelle : `Unsupported FormDataPart implementation`. |
| `Unsupported FormDataPart implementation` | Le `fetch` d'Expo refuse `{uri, name, type}` | Envoi d'un `Blob` via `new File(uri)` (expo-file-system). |
| Groq 404 sur `llama-3.3-70b-versatile` | Modèle indisponible sur ce compte | `openai/gpt-oss-120b`, tailles de tranches et débit ajustés. |
| Notes trop longues pour la synthèse finale | Limite de requête après le changement de modèle | Fusion des notes par paquets. |
| Test d'extrait décalé d'un caractère | Le code garde 9 caractères de contexte, le test en attendait 10 | Test corrigé. |
| Import refusé au-delà de 24 Mo | Aucune découpe possible sans ffmpeg | Découpage maison en TypeScript (m4a, mp3, wav). |
| Bloc des tâches absent de la synthèse | Il n'apparaissait que si le modèle renvoyait des tâches, et le prompt détaillé n'en renvoyait plus | Bloc toujours affiché, prompt qui exige toutes les actions, regroupement par responsable. |
| Test de valeur par défaut en échec | Valeur par défaut de la rubrique passée de « Sujets principaux » à « Sujet » | Test mis à jour. |

## Historique des modifications (du plus récent au plus ancien)

- **Fil conducteur** : idée centrale, sujets principaux/secondaires, regroupement des sujets abordés en plusieurs fois (`core/types.ts`, `summarize.ts`, `prompts.ts`, `markdown.ts`, écran détail).
- **Prochaines actions** réintégrées et regroupées par responsable.
- **Résumé détaillé et minutes** : `core/timestamps.ts`, `TimeTag`, saut vers la transcription, transcription en lignes horodatées.
- **Import de gros fichiers** : `core/audioSplit.ts`, `services/splitAudio.ts`, `MAX_IMPORT_MB`, `SPLIT_TARGET_MB`.
- **Questions à l'IA** : `core/ask.ts`, `services/ask.ts`, `app/ask.tsx`.
- **Renommage et recherche**, correction des tailles de tranches.
- **Design « Minute »**, export de l'audio d'origine.
- **Mise en route** : pipeline complet, aperçu Expo Go, premiers correctifs.

## Reste à faire / à vérifier sur iPhone

- Build réel via Xcode (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, Apple ID, mode développeur), puis test du menu Partager, de l'enregistrement écran verrouillé et des raccourcis `minigranola://`.
- Valider sur une vraie réunion : qualité des minutes, du fil conducteur et des tâches.
- Valider le découpage audio sur des fichiers réels (m4a surtout) : il n'est testé que sur des fichiers synthétiques.
- Live Activity (écran verrouillé) : non commencé.
