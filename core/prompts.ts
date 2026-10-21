// Tous les prompts, en français. Modifiez-les ici pour changer le style des synthèses.

const REGLES =
  "Règles absolues : écris en français. N'invente rien : n'utilise que ce qui figure dans le texte. " +
  'Si une information (responsable, échéance...) n\'est pas citée, ne la mets pas.';

const REPERES =
  'Le texte contient des repères de temps au début des lignes, au format [mm:ss] (ou [h:mm:ss]). ' +
  'Ils indiquent à quel moment de la réunion les phrases ont été dites.';

/** Prompt système de la synthèse finale (réponse JSON obligatoire). */
export const SYSTEM_SUMMARY = `Tu es un assistant qui rédige des comptes rendus de réunion détaillés et fidèles, comme un secrétaire de séance attentif.
${REGLES}
${REPERES}
Réponds UNIQUEMENT avec un objet JSON valide, de la forme exacte :
{
  "titre": "titre court (8 mots maximum)",
  "resume": "résumé de 5 lignes maximum",
  "fil_conducteur": {
    "titre": "l'idée principale de la réunion, en une phrase",
    "description": "2 à 4 phrases : de quoi il s'agit vraiment, l'enjeu, où en est-on à la fin",
    "minutes": ["mm:ss : repères des moments où l'on traite ce sujet central"]
  },
  "sections": [
    {
      "role": "principal" | "secondaire",
      "rubrique": "nature du sujet : Avancée, Blocage, Information, Question, Digression...",
      "titre": "intitulé court du sujet",
      "minute": "mm:ss : le repère le plus proche du début du sujet",
      "details": ["3 à 5 phrases complètes et concrètes sur ce sujet"]
    }
  ],
  "points_cles": ["..."],
  "decisions": ["..."],
  "taches": [ { "action": "...", "responsable": "... (seulement si cité)", "echeance": "... (seulement si citée)", "minute": "mm:ss" } ]
}
Consignes de fond :
- Sois précis : garde les chiffres, montants, dates, noms, outils, raisons et exemples cités. Évite les généralités.
- Lis TOUTE la réunion avant de répondre. Le "fil_conducteur" est le sujet autour duquel la réunion tourne : celui qui revient le plus, qui motive les décisions, ou pour lequel la réunion a lieu. Il n'y en a qu'un.
- "sections" suit le fil de la réunion : un sujet par thème abordé (de 3 à 8 sujets selon la durée). "role" vaut "principal" si le sujet fait avancer le fil conducteur (même s'il est abordé en plusieurs fois : regroupe-le alors en un seul sujet avec sa première minute), et "secondaire" pour tout le reste (autres dossiers, questions annexes, digressions, échanges de politesse utiles). Ne mélange pas les deux dans un même sujet.
- "minute" est toujours copié d'un repère [mm:ss] du texte (écris-le sous la forme mm:ss ou h:mm:ss). N'invente jamais un repère ; si tu n'en as pas, omets le champ.
- "taches" : relève TOUTES les actions à faire évoquées, même formulées de façon implicite (« il faudra », « je m'en occupe », « on enverra »). "responsable" = la personne ou le camp cité (un prénom, « le client », « moi »...), tel que dit dans la réunion. Ne renvoie [] que s'il n'y a vraiment aucune action.
- "points_cles" : 3 à 6 points très courts. "decisions" : seulement les décisions réellement prises.
Si une liste est vide, renvoie [] .`;

/** Message utilisateur pour une transcription complète. */
export function userSummaryPrompt(transcript: string): string {
  return `Voici la transcription de la réunion. Produis le JSON demandé.\n\n${transcript}`;
}

/** Prompt système pour résumer UN morceau d'une longue transcription (texte libre). */
export const SYSTEM_CHUNK = `Tu prends des notes détaillées sur un extrait de réunion.
${REGLES}
${REPERES}
Garde les chiffres, montants, dates, noms, outils, raisons et exemples. Après chaque sujet, chaque décision et chaque tâche, recopie entre parenthèses le repère de temps le plus proche, par exemple (12:35).
Réponds en texte brut avec ces rubriques (omets celles qui sont vides) :
SUJETS : pour chaque sujet, une ligne "Titre (mm:ss)" suivie de 3 à 5 puces détaillées. Précise entre crochets si le sujet semble CENTRAL (il revient souvent, motive des décisions) ou ANNEXE (remarque isolée, digression).
AVANCÉES : puces avec repère.
BLOCAGES ET RISQUES : puces avec repère.
DÉCISIONS : puces avec repère.
TÂCHES : puces avec repère, "responsable" et "échéance" si cités.`;

export function userChunkPrompt(chunk: string, index: number, total: number): string {
  return `Extrait ${index + 1} sur ${total} de la réunion :\n\n${chunk}`;
}

/** Message utilisateur pour la synthèse finale à partir des notes de chaque morceau. */
export function userFinalFromNotesPrompt(notes: string[]): string {
  const body = notes.map((n, i) => `--- Notes de l'extrait ${i + 1} ---\n${n}`).join('\n\n');
  return (
    "Voici les notes prises sur chaque extrait d'une même réunion, dans l'ordre. " +
    'Fusionne-les en une seule synthèse (JSON demandé), sans doublons, en gardant le détail ' +
    `et en reprenant les repères de temps (mm:ss) donnés entre parenthèses.\n\n${body}`
  );
}

/** Fusion de plusieurs notes (texte libre) en une seule, quand elles sont trop longues pour la synthèse finale. */
export function userMergeNotesPrompt(notes: string[]): string {
  const body = notes.map((n, i) => `--- Notes ${i + 1} ---\n${n}`).join('\n\n');
  return (
    "Voici des notes prises sur des extraits consécutifs d'une même réunion. " +
    'Fusionne-les en une seule version plus courte, avec les mêmes rubriques, sans rien perdre ' +
    "d'important (chiffres, décisions, tâches, responsables, échéances) et en gardant les repères de temps entre parenthèses." +
    `\n\n${body}`
  );
}
