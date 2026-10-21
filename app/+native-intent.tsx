// Les liens spéciaux (partage depuis un autre app) ne sont pas des écrans :
// on les redirige vers l'accueil, expo-share-intent s'occupe du reste.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('dataUrl=')) return '/';
  return path;
}
