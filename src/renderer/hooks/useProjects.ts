import { myProjectsAtom, useFolders } from './useFolders'

export { myProjectsAtom }

/** Compatibility adapter: Project-shaped (Folder fields) view over scopes. */
export function useProjects() {
  const { folders, addFolder, updateFolder, removeFolder } = useFolders()
  return {
    projects: folders,
    addProject: addFolder,
    updateProject: updateFolder,
    removeProject: removeFolder,
  }
}
